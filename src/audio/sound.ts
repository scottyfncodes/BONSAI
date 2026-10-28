/**
 * Original, synthesised sound effects – no audio files. Everything is built
 * from filtered noise and sine partials so it stays tiny and tweakable.
 */
type Nav = Navigator & { audioSession?: { type: string }; vibrate?: (p: number | number[]) => boolean };

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambientGain: GainNode | null = null;
  private ambientTimer = 0;
  private ambientStop: (() => void) | null = null;
  private lastPlayed = new Map<string, number>();
  muted = false;
  volume = 0.8;
  ambient = true;
  haptics = true;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        const nav = navigator as Nav;
        // Respect the iPhone silent switch and mix with other audio.
        if (nav.audioSession) nav.audioSession.type = 'ambient';
      } catch {
        /* not supported */
      }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      for (let i = 0; i < len; i++) {
        // Slightly pink noise: softer, more natural than white.
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965;
        d[i] = (b0 + b1 + w * 0.1848) * 0.35;
      }
      if (this.ambient) this.startAmbient();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setAmbient(on: boolean): void {
    this.ambient = on;
    if (on) this.startAmbient();
    else this.stopAmbient();
  }

  /** Pause everything while the app is hidden. */
  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private ready(key: string, gapMs = 30): AudioContext | null {
    if (!this.ctx || !this.master || this.muted) return null;
    const now = performance.now();
    if ((this.lastPlayed.get(key) ?? 0) > now - gapMs) return null;
    this.lastPlayed.set(key, now);
    return this.ctx;
  }

  private noiseBurst(ctx: AudioContext, opts: { t: number; dur: number; freq: number; q: number; gain: number; type?: BiquadFilterType; sweepTo?: number }): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, opts.t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, opts.t + opts.dur);
    f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, opts.t);
    g.gain.exponentialRampToValueAtTime(opts.gain, opts.t + Math.min(0.01, opts.dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, opts.t + opts.dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(opts.t, Math.random() * 1.5, opts.dur + 0.05);
  }

  private tone(ctx: AudioContext, opts: { t: number; freq: number; dur: number; gain: number; type?: OscillatorType; glide?: number }): void {
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, opts.t);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(opts.glide, opts.t + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, opts.t);
    g.gain.exponentialRampToValueAtTime(opts.gain, opts.t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, opts.t + opts.dur);
    o.connect(g).connect(this.master!);
    o.start(opts.t);
    o.stop(opts.t + opts.dur + 0.05);
  }

  /** The crisp two-blade snip of bonsai shears. `size` 0..1 = branch thickness. */
  snip(size = 0.3): void {
    const ctx = this.ready('snip', 60);
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    // Blades meeting: a bright, very short click with a metallic ring.
    this.noiseBurst(ctx, { t, dur: 0.035, freq: 5200, q: 2.5, gain: 0.55 });
    this.tone(ctx, { t, freq: 3150 + Math.random() * 200, dur: 0.09, gain: 0.05 });
    this.tone(ctx, { t, freq: 4700, dur: 0.05, gain: 0.03 });
    // Wood giving way – lower and longer for thicker branches.
    this.noiseBurst(ctx, { t: t + 0.012, dur: 0.05 + size * 0.08, freq: 1400 - size * 700, q: 1.2, gain: 0.3 + size * 0.35 });
    if (size > 0.5) this.tone(ctx, { t: t + 0.01, freq: 140, dur: 0.12, gain: 0.12, glide: 90 });
  }

  /** Soft foliage movement. */
  rustle(amount = 0.5): void {
    const ctx = this.ready('rustle', 120);
    if (!ctx) return;
    const t = ctx.currentTime + 0.03;
    const n = 2 + Math.round(amount * 3);
    for (let i = 0; i < n; i++) {
      this.noiseBurst(ctx, { t: t + i * 0.05 + Math.random() * 0.03, dur: 0.12 + Math.random() * 0.12, freq: 3000 + Math.random() * 2500, q: 0.8, gain: 0.08 + amount * 0.08 });
    }
  }

  /** Wood under strain. */
  creak(): void {
    const ctx = this.ready('creak', 260);
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, { t, dur: 0.22, freq: 420, q: 9, gain: 0.22, sweepTo: 260 });
    this.tone(ctx, { t, freq: 180, dur: 0.18, gain: 0.04, type: 'triangle', glide: 140 });
  }

  /** Gentle tick while bending. */
  bendTick(): void {
    const ctx = this.ready('bend', 90);
    if (!ctx) return;
    this.noiseBurst(ctx, { t: ctx.currentTime, dur: 0.03, freq: 900 + Math.random() * 400, q: 4, gain: 0.07 });
  }

  /** Wire wrapping around a branch. */
  wire(): void {
    const ctx = this.ready('wire', 100);
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      this.noiseBurst(ctx, { t: t + i * 0.06, dur: 0.05, freq: 2400 + i * 300, q: 6, gain: 0.12 });
      this.tone(ctx, { t: t + i * 0.06, freq: 1850 + i * 140, dur: 0.12, gain: 0.025 });
    }
  }

  /** Wire coming off. */
  unwire(): void {
    const ctx = this.ready('unwire', 100);
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, { t, dur: 0.25, freq: 2200, q: 3, gain: 0.12, sweepTo: 4200 });
  }

  /** A shape accepted / an action confirmed. */
  confirm(): void {
    const ctx = this.ready('confirm', 150);
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(ctx, { t, freq: 659.3, dur: 0.5, gain: 0.07 });
    this.tone(ctx, { t: t + 0.09, freq: 987.8, dur: 0.6, gain: 0.05 });
  }

  /** Very soft selection tick. */
  tap(): void {
    const ctx = this.ready('tap', 40);
    if (!ctx) return;
    this.tone(ctx, { t: ctx.currentTime, freq: 1320, dur: 0.06, gain: 0.03 });
  }

  /** Reward fanfare: a rising pentatonic phrase. */
  reward(stars = 1): void {
    const ctx = this.ready('reward', 400);
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    const n = 3 + stars;
    for (let i = 0; i < n; i++) this.tone(ctx, { t: t + i * 0.11, freq: notes[i % notes.length]!, dur: 0.7, gain: 0.06 });
  }

  /** Time passing: a breath of wind and leaves. */
  growth(): void {
    const ctx = this.ready('growth', 300);
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, { t, dur: 0.9, freq: 600, q: 0.7, gain: 0.12, type: 'lowpass', sweepTo: 1800 });
    this.rustle(0.4);
  }

  private startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.ambientGain) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.06, ctx.currentTime, 2);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.ambientGain = g;
    const bird = () => {
      if (!this.ambientGain || !this.ctx || this.muted) return;
      const c = this.ctx;
      const t0 = c.currentTime;
      const base = 2400 + Math.random() * 1600;
      const chirps = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < chirps; i++) {
        this.tone(c, { t: t0 + i * 0.13, freq: base, dur: 0.09, gain: 0.012, glide: base * (1.15 + Math.random() * 0.2) });
      }
    };
    const schedule = () => {
      this.ambientTimer = window.setTimeout(() => {
        bird();
        schedule();
      }, 9000 + Math.random() * 16000);
    };
    schedule();
    this.ambientStop = () => {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      window.setTimeout(() => {
        src.stop();
        lfo.stop();
      }, 1500);
    };
  }

  private stopAmbient(): void {
    window.clearTimeout(this.ambientTimer);
    this.ambientStop?.();
    this.ambientStop = null;
    this.ambientGain = null;
  }

  /** Subtle haptic tick, only where the platform supports it. */
  haptic(pattern: number | number[] = 8): void {
    if (!this.haptics) return;
    const nav = navigator as Nav;
    try {
      nav.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }
}

export const sound = new SoundEngine();
