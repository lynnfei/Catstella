(function (root) {
  const expressions = new Set(["proud", "shy", "angry"]);
  const priority = { dialogue: 1, touch: 2, system: 2, preview: 3 };
  const expressionTime = 3200;
  const napTime = 180000;
  const rapidTouchWindow = 1250;

  class HeadPatDialogue {
    constructor(now = () => performance.now()) {
      this.now = now;
      this.taps = 0;
      this.lastSpoken = -Infinity;
      this.previousCategory = null;
    }

    next(counts, available) {
      const {total,today} = counts || {};
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(today) || today < 1 || total < today) return null;
      this.taps = Math.min(4,this.taps + 1);
      const now = this.now();
      if (!available || now - this.lastSpoken < 20_000) return null;
      const milestone = total === 50 || total >= 100 && total % 100 === 0;
      if (!milestone && this.taps < (this.previousCategory ? 4 : 3)) return null;
      const category = milestone || this.previousCategory === "petDaily" ? "petReflection" : "petDaily";
      this.previousCategory = category;
      this.lastSpoken = now;
      this.taps = 0;
      return {category,fields:{count:total,today}};
    }
  }

  class PetBehavior {
    static wakeTime = 280;
    static tapSlop = 10;
    static tapLimit = 700;

    static isTap(durationMs, distancePx = 0) {
      return Number.isFinite(durationMs)
        && durationMs >= 0
        && durationMs <= PetBehavior.tapLimit
        && Number.isFinite(distancePx)
        && distancePx <= PetBehavior.tapSlop;
    }

    constructor(paint, { now = Date.now, random = Math.random } = {}) {
      this.paint = paint;
      this.now = now;
      this.random = random;
      this.context = {};
      this.rest = "awake";
      this.blink = false;
      this.recentTouches = [];
      this.lastAngry = -Infinity;
    }

    emit() {
      this.paint({ expression: this.expression?.kind, rest: this.rest, blink: this.blink || this.rest === "sleeping" });
    }

    sync(context) {
      const old = this.context;
      if (Object.keys(context).every(key => context[key] === old[key])) return;
      this.context = context;
      if (!context.visible || !context.expressions) {
        this.recentTouches = [];
        this.gentleTouch = null;
        if (this.expression?.source !== "preview") this.clearExpression();
      }
      if (!context.rest && this.rest === "sleeping" && !this.napPreviewTimer) this.wake(false);
      if (context.rest !== old.rest) this.scheduleNap();
      if (context.idle !== old.idle || context.visible !== old.visible) this.scheduleBlink();
    }

    scheduleBlink() {
      clearTimeout(this.blinkTimer);
      const wasBlinking = this.blink;
      this.blink = false;
      if (wasBlinking) this.emit();
      if (!this.context.visible || !this.context.idle || this.expression || this.rest !== "awake") return;
      this.blinkTimer = setTimeout(() => {
        this.blink = true;
        this.emit();
        this.blinkTimer = setTimeout(() => this.scheduleBlink(), 140);
      }, 4200 + this.random() * 3000);
    }

    scheduleNap() {
      clearTimeout(this.napTimer);
      if (!this.context.rest || this.rest !== "awake") return;
      this.napTimer = setTimeout(() => this.sleep(), napTime);
    }

    sleep() {
      clearTimeout(this.napTimer);
      clearTimeout(this.wakeTimer);
      this.recentTouches = [];
      this.gentleTouch = null;
      this.rest = "sleeping";
      this.clearExpression();
      this.scheduleBlink();
      this.emit();
    }

    previewNap() {
      clearTimeout(this.napPreviewTimer);
      this.napPreviewTimer = setTimeout(() => this.wake(true), expressionTime);
      this.sleep();
    }

    activity(wake = false) {
      if (this.rest === "sleeping") return wake ? this.wake(true) : false;
      this.scheduleNap();
      return false;
    }

    wake(bounce) {
      if (this.rest !== "sleeping") return false;
      clearTimeout(this.napPreviewTimer);
      this.napPreviewTimer = null;
      this.rest = bounce ? "waking" : "awake";
      this.emit();
      if (bounce) {
        this.wakeTimer = setTimeout(() => {
          this.rest = "awake";
          this.emit();
          this.scheduleBlink();
          this.scheduleNap();
        }, PetBehavior.wakeTime);
      } else {
        this.scheduleBlink();
        this.scheduleNap();
      }
      return true;
    }

    show(kind, source) {
      if (!expressions.has(kind) || !priority[source]) return false;
      if (source !== "preview" && (!this.context.visible || !this.context.expressions || this.rest !== "awake")) return false;
      if (this.expression && priority[this.expression.source] > priority[source]) return false;
      this.wake(false);
      this.activity();
      clearTimeout(this.expressionTimer);
      if (source === "preview") {
        this.recentTouches = [];
        this.gentleTouch = null;
      }
      this.expression = { kind, source };
      this.scheduleBlink();
      this.emit();
      this.expressionTimer = setTimeout(() => this.clearExpression(), expressionTime);
      return true;
    }

    clearExpression() {
      if (!this.expression) return;
      clearTimeout(this.expressionTimer);
      this.expression = null;
      this.emit();
      this.scheduleBlink();
    }

    tap() {
      if (!this.context.visible || !this.context.expressions || this.rest !== "awake" || this.expression?.source === "preview") return null;
      const now = this.now();
      this.activity();
      while (this.recentTouches.length && now - this.recentTouches[0] > rapidTouchWindow) this.recentTouches.shift();
      if (this.recentTouches.length >= 3) this.recentTouches.shift();
      this.recentTouches.push(now);
      if (this.recentTouches.length >= 3) {
        this.gentleTouch = null;
        if (now - this.lastAngry >= expressionTime && this.show("angry", "touch")) {
          this.lastAngry = now;
          this.recentTouches = [];
          return "angry";
        }
        return null;
      }

      const gentle = this.gentleTouch;
      if (!gentle || now - gentle.last > 1800) {
        this.gentleTouch = { start: now, last: now };
      } else {
        gentle.last = now;
        if (now - gentle.start >= 2600) {
          gentle.start = now;
          if (this.expression?.kind !== "angry" && this.random() < .45 && this.show("shy", "touch")) return "shy";
        }
      }
      if (!this.expression && this.random() < .35 && this.show("proud", "touch")) return "proud";
      return null;
    }

    dispose() {
      for (const timer of [this.blinkTimer, this.napTimer, this.napPreviewTimer, this.wakeTimer, this.expressionTimer]) clearTimeout(timer);
    }
  }

  if (typeof module === "object" && module.exports) module.exports = { PetBehavior, HeadPatDialogue };
  else {
    root.CatstellaPetBehavior = PetBehavior;
    root.CatstellaHeadPatDialogue = HeadPatDialogue;
  }
})(typeof window === "object" ? window : globalThis);
