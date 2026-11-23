const faceReady = `(() => {
 const face = document.querySelector('.agy-face');
 if (!face) return false;
 const bounds = face.getBoundingClientRect();
 if (bounds.width < 20 || bounds.height < 20) return false;
 for (let node = face; node; node = node.parentElement) {
  const style = getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
 }
 return [...face.querySelectorAll('img')].some(img =>
  img.complete && img.naturalWidth > 0 && Number(getComputedStyle(img).opacity) > 0);
})()`;

const stale = Symbol('stale visual probe');

function hasVisiblePixels(frame) {
 const pixels = frame.toBitmap();
 let opaque = 0;
 for (let i = 3; i < pixels.length; i += 4) {
  if (pixels[i] > 32 && ++opaque >= 500) return true;
 }
 return false;
}

class VisualWatchdog {
 constructor({window, eligible, recover, now = () => performance.now(), timeout = 4000}) {
  Object.assign(this, {window, eligible, recover, now, timeout});
  this.operations = new WeakMap();
  this.epoch = 0;
  this.failures = 0;
  this.nextAt = 0;
  this.cooldownUntil = 0;
 }

 reset() {
  this.epoch++;
  this.active?.abort();
  this.active = null;
  this.observed = null;
  this.failures = 0;
  this.nextAt = this.now() + 5000;
 }

 read(target, stage, start, signal) {
  let operations = this.operations.get(target);
  if (!operations) this.operations.set(target, operations = new Map());
  let operation = operations.get(stage);
  if (!operation) {
   operation = {epoch: this.epoch};
   operations.set(stage, operation);
   const complete = result => {
    operations.delete(stage);
    operation.notify?.(result);
   };
   // Electron cannot cancel either native request. Keep one request per stage
   // and one temporary waiter, even across timeouts or repeated hide/show.
   const request = async () => start();
   request().then(
    value => complete({value}),
    () => complete({failure: stage + '-error'})
   );
  }
  const epoch = this.epoch;
  return new Promise(resolve => {
   const finish = result => {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    operation.notify = null;
    resolve(result);
   };
   const cancel = () => finish(stale);
   const timer = setTimeout(() => finish({failure: stage + '-timeout'}), this.timeout);
   timer.unref();
   signal.addEventListener('abort', cancel, {once: true});
   operation.notify = result => finish(operation.epoch === epoch ? result : stale);
  });
 }

 async tick(interval) {
  const target = this.window();
  if (!this.eligible(target)) {
   if (this.observed) this.reset();
   return;
  }
  if (this.observed && this.observed !== target) this.reset();
  if (this.active || this.now() < Math.max(this.nextAt, this.cooldownUntil)) return;
  this.observed = target;
  const probe = new AbortController();
  this.active = probe;
  const current = () => !probe.signal.aborted && this.window() === target && this.eligible(target);
  let failure;
  try {
   const layout = await this.read(target, 'layout', () => target.webContents.executeJavaScript(faceReady), probe.signal);
   if (!current() || layout === stale) return;
   failure = layout.failure || (!layout.value && 'invalid-character-layout');
   if (!failure) {
    const capture = await this.read(target, 'capture', () =>
     target.webContents.capturePage(undefined, {stayHidden: true}), probe.signal);
    if (!current() || capture === stale) return;
    failure = capture.failure || (!hasVisiblePixels(capture.value) && 'blank-surface');
   }
  } catch {
   failure = 'visual-sample-error';
  } finally {
   if (this.active === probe) this.active = null;
   if (!current()) {
    if (this.observed === target && !probe.signal.aborted) this.reset();
   } else if (failure) {
    this.nextAt = this.now() + 30000;
    if (++this.failures >= 2) {
     this.cooldownUntil = this.now() + 60000;
     this.reset();
     this.recover(target, failure);
    }
   } else {
    this.failures = 0;
    this.nextAt = this.now() + interval;
   }
  }
 }
}

module.exports = {VisualWatchdog};
