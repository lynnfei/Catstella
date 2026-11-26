(function (root) {
  class AmbientChatter {
    constructor({ allowed, speak, delay = () => (12 + Math.random() * 13) * 60_000 }) {
      Object.assign(this, { allowed, speak, delay, enabled: false, revision: 0 });
    }
    configure(enabled) {
      if (this.enabled === enabled) return;
      this.enabled = enabled;
      this.reset();
    }
    reset(wait) {
      clearTimeout(this.timer);
      const revision = ++this.revision;
      if (!this.enabled) return;
      this.timer = setTimeout(async () => {
        let allowed = false;
        try { allowed = await this.allowed(); } catch {}
        if (revision !== this.revision) return;
        if (allowed) this.speak();
        this.reset(allowed ? undefined : 60_000);
      }, wait ?? this.delay());
    }
  }
  const lines = [
    '星星也会休息，本喵刚刚替它值了会儿班。',
    '今天的星光够亮了，剩下的明天再攒。',
    '小小伸个懒腰，尾巴也要算上。',
    '本喵悄悄记下了一个愿望：晚饭多一条鱼。',
    '路过一颗小行星，顺手给它起名叫糯米。',
    '刚整理了猫耳朵，灵感的接收信号满格。'
  ];
  AmbientChatter.pickLine = previous => {
    const pool = lines.filter(line => line !== previous);
    return pool[Math.floor(Math.random() * pool.length)];
  };
  if (typeof module === 'object' && module.exports) module.exports = AmbientChatter;
  else root.CatstellaChatter = AmbientChatter;
})(typeof window === "object" ? window : globalThis);
