// Short UI sounds: decode once, start from memory inside the input handler.
(() => {
  class InteractionAudio {
    constructor(getURL) {
      this.getURL = getURL;
      this.enabled = false;
      this.visible = true;
      this.buffers = new Map();
      this.elements = new Map();
      this.sequence = 0;
    }

    configure(enabled) {
      this.enabled = !!enabled;
      if (this.enabled) {
        void this.prepare();
      }
      else {
        this.stop();
        this.suspend();
      }
    }

    prepare() {
      if (this.preparing) return this.preparing;
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return Promise.resolve();
        this.context = new Context({ latencyHint: 'interactive' });
        this.gain = this.context.createGain();
        this.gain.gain.value = 0.45;
        this.gain.connect(this.context.destination);
        this.preparing = Promise.all(['press', 'release'].map(async type => {
          const response = await fetch(this.url(type));
          if (!response.ok) throw Error('Audio unavailable');
          const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(type, buffer);
        })).catch(() => {});
      } catch (_) { this.preparing = Promise.resolve(); }
      return this.preparing;
    }

    url(type) { return this.getURL(`assets/audio/interaction-${type}.wav`); }

    stop() {
      ++this.sequence;
      clearTimeout(this.pendingTimer);
      if (this.current) {
        this.current.onended = null;
        try { this.current.stop(); } catch (_) {}
        this.current.disconnect();
        this.current = null;
      }
      this.element?.pause();
      this.element = null;
    }

    suspend() {
      if (this.context?.state === 'running') void this.context.suspend().catch(() => {});
    }

    setVisible(visible) {
      this.visible = !!visible;
      if (!this.visible) {
        this.stop();
        this.suspend();
      } else this.unlock();
    }

    unlock() {
      if (!this.enabled || !this.visible) return;
      if (this.context && !this.resuming && !['running', 'closed'].includes(this.context.state)) {
        try {
          this.resuming = this.context.resume().then(() => {
            if (!this.enabled || !this.visible) this.suspend();
          }).catch(() => {}).finally(() => { this.resuming = null; });
        } catch (_) {}
      }
    }

    play(type = 'press') {
      if (!this.enabled || !this.visible) return;
      type = type === 'release' ? 'release' : 'press';
      this.stop();
      const sequence = this.sequence;
      const buffer = this.buffers.get(type);
      const start = () => {
        try {
          const source = this.context.createBufferSource();
          source.buffer = buffer;
          source.connect(this.gain);
          source.onended = () => {
            source.disconnect();
            if (this.current === source) this.current = null;
          };
          this.current = source;
          source.start();
        } catch (_) { this.fallback(type); }
      };
      if (buffer && this.context.state !== 'closed') {
        // Queue during the input event; do not defer playback to device-resume completion.
        start();
        this.unlock();
        if (this.context.state !== 'running') {
          this.pendingTimer = setTimeout(() => {
            if (this.sequence === sequence && this.context.state !== 'running') this.stop();
          }, 1000);
        }
      } else {
        // Early clicks / unavailable Web Audio keep the original media fallback.
        this.fallback(type);
      }
    }

    fallback(type) {
      try {
        if (!this.elements.has(type)) {
          const audio = new Audio(this.url(type));
          audio.preload = 'auto';
          audio.volume = 0.45;
          this.elements.set(type, audio);
        }
        this.element = this.elements.get(type);
        this.element.currentTime = 0;
        void this.element.play().catch(() => {});
      } catch (_) {}
    }
  }
  // Firefox content-script globalThis and window are distinct objects.
  window.CatstellaInteractionAudio = InteractionAudio;
})();
