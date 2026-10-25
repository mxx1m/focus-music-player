// Tone generator: binaural and isochronic tones, computed live with Web Audio.
// voice -> level (tone slider) -> fade (start, stop and session fades) -> speakers

export const BANDS = [
  { name: 'Delta', lo: 0.5, hi: 4, preset: 2, note: 'Deep rest' },
  { name: 'Theta', lo: 4, hi: 8, preset: 6, note: 'Meditative' },
  { name: 'Alpha', lo: 8, hi: 12, preset: 10, note: 'Relaxed focus' },
  { name: 'Low beta', lo: 12, hi: 15, preset: 14, note: 'Calm focus' },
  { name: 'Beta', lo: 15, hi: 30, preset: 18, note: 'Active focus' },
  { name: 'Gamma', lo: 30, hi: 40, preset: 40, note: 'High alert' }
];
export function bandFor(f) {
  for (const b of BANDS) if (f < b.hi) return b;
  return BANDS[BANDS.length - 1];
}
export const MODES = { off: 'Off', binaural: 'Binaural', isochronic: 'Isochronic' };
export const DEFAULT_CARRIER = 150;

// Hearing safety
export const TONE_MAX = 0.25;   // tone peak at slider 100: -12 dB below full scale
export const FADE_IN = 2;       // seconds, every time the tone starts
export const FADE_OUT = 0.3;    // seconds, on pause
export function toneAmp(v) { const x = Math.min(100, Math.max(0, v)) / 100; return TONE_MAX * x * x; }
// A-weighting (IEC 61672): how strongly the ear, and hearing-damage limits, count each frequency.
export function aWeight(f) {
  const f2 = f * f;
  const ra = (148693636 * f2 * f2) / ((f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148693636));
  return 20 * Math.log10(ra) + 2.0;
}
const A_REF = aWeight(DEFAULT_CARRIER);
// Higher carriers count more, so they are turned down to keep the same weighted level as 150 Hz. Never boosted.
export function carrierComp(f) { return Math.pow(10, Math.min(0, A_REF - aWeight(f)) / 20); }

// Isochronic envelopes, p = position within one pulse cycle (0..1).
// Smooth: loudness follows a sine, rising and falling continuously (sine amplitude modulation).
export function envSmooth(p) { return 0.5 - 0.5 * Math.cos(2 * Math.PI * p); }
// Sharp: on for half of each cycle with raised-cosine edges so pulses don't click, silent for the other half.
export function envSharp(p) {
  const R = 0.12;
  if (p < R) return 0.5 - 0.5 * Math.cos(Math.PI * p / R);
  if (p < 0.5 - R) return 1;
  if (p < 0.5) return 0.5 - 0.5 * Math.cos(Math.PI * (0.5 - p) / R);
  return 0;
}
export function envFor(shape) { return shape === 'sharp' ? envSharp : envSmooth; }

/**
 * hooks.params()          -> { mode, beat, carrier, pulse, level }
 * hooks.onSystemPause()   the system suspended the engine (lock screen, Control Center, media keys)
 * hooks.onSystemPlay()    the system resumed it
 * hooks.toast(msg)
 */
export function createToneEngine(hooks) {
  let ac = null, levelNode = null, fadeNode = null, voice = null, on = false, suspendTimer = 0;
  let expect = null; // the state our own resume() or suspend() is about to produce
  const waves = {};

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // "playback" keeps the tone audible with the silent switch on and while the iPhone is locked.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try { ac = new AC(); } catch (e) { return null; }
    levelNode = ac.createGain();
    levelNode.gain.value = toneAmp(hooks.params().level);
    fadeNode = ac.createGain();
    fadeNode.gain.value = 0;
    levelNode.connect(fadeNode);
    fadeNode.connect(ac.destination);
    ac.onstatechange = onState;
    return ac;
  }
  function onState() {
    const s = ac.state;
    if (expect === s) { expect = null; return; } // our own resume or suspend
    if (s === 'suspended' && on) hooks.onSystemPause();
    else if (s === 'running' && !on) hooks.onSystemPlay();
    // 'interrupted' (a call, Siri): the player element reports its own pause; the tone resumes when allowed
  }
  function hold(param, t) {
    if (param.cancelAndHoldAtTime) { try { param.cancelAndHoldAtTime(t); return; } catch (e) {} }
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
  function glide(param, value, tc) { const t = ac.currentTime; hold(param, t); param.setTargetAtTime(value, t, tc); }
  function rampTo(param, value, secs) { const t = ac.currentTime; hold(param, t); param.linearRampToValueAtTime(value, t + Math.max(0.02, secs)); }

  // One cycle of the pulse envelope as a Fourier series, so an oscillator can produce it at any rate.
  function envWave(shape) {
    if (waves[shape]) return waves[shape];
    const N = 2048, H = 96, xs = new Float32Array(N), envf = envFor(shape);
    let mean = 0;
    for (let n = 0; n < N; n++) { xs[n] = envf(n / N); mean += xs[n]; }
    mean /= N;
    const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) {
      let a = 0, b = 0;
      for (let n = 0; n < N; n++) { const x = xs[n] - mean, ang = 2 * Math.PI * k * n / N; a += x * Math.cos(ang); b += x * Math.sin(ang); }
      re[k] = 2 * a / N; im[k] = 2 * b / N;
    }
    return (waves[shape] = { wave: ac.createPeriodicWave(re, im, { disableNormalization: true }), mean });
  }
  function build() {
    const p = hooks.params(), t = ac.currentTime;
    const n = { mode: p.mode, pulse: p.pulse, out: ac.createGain(), oscs: [] };
    n.out.gain.setValueAtTime(0, t);
    n.out.connect(levelNode);
    if (p.mode === 'binaural') {
      n.l = ac.createOscillator(); n.r = ac.createOscillator();
      n.l.frequency.value = p.carrier - p.beat / 2;
      n.r.frequency.value = p.carrier + p.beat / 2;
      const m = ac.createChannelMerger(2);
      n.l.connect(m, 0, 0); n.r.connect(m, 0, 1); m.connect(n.out);
      n.oscs = [n.l, n.r];
    } else {
      // carrier x envelope: the envelope oscillator drives a gain that rests at the envelope's average
      const w = envWave(p.pulse);
      n.car = ac.createOscillator(); n.car.frequency.value = p.carrier;
      n.am = ac.createGain(); n.am.gain.value = w.mean;
      n.lfo = ac.createOscillator(); n.lfo.setPeriodicWave(w.wave); n.lfo.frequency.value = p.beat;
      n.lfo.connect(n.am.gain); n.car.connect(n.am); n.am.connect(n.out);
      n.oscs = [n.car, n.lfo];
    }
    n.oscs.forEach(o => o.start(t));
    n.out.gain.setTargetAtTime(carrierComp(p.carrier), t, 0.025);
    const old = voice; voice = n;
    if (old) dispose(old, 0.025); // short crossfade between settings
  }
  function dispose(n, tc) {
    const t = ac.currentTime;
    glide(n.out.gain, 0, tc);
    n.oscs.forEach(o => { try { o.stop(t + tc * 10); } catch (e) {} });
    setTimeout(() => { try { n.out.disconnect(); } catch (e) {} }, (tc * 10 + 0.3) * 1000);
  }

  return {
    isOn: () => on,
    /** Start (or keep) the tone. closingIn: seconds left in a session's closing fade, if one is running. */
    start(closingIn) {
      const p = hooks.params();
      if (p.mode === 'off') { this.stop(); return true; }
      const c = ensure();
      if (!c) { hooks.toast('This browser can’t generate tones.'); return false; }
      clearTimeout(suspendTimer);
      if (c.state !== 'running') { expect = 'running'; try { const r = c.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
      if (!voice) build(); else this.retune();
      if (!on) {
        on = true;
        if (closingIn != null) rampTo(fadeNode.gain, 0, closingIn);
        else rampTo(fadeNode.gain, 1, FADE_IN); // fade in from silence
      }
      return true;
    },
    stop(secs) {
      if (!ac) return;
      const d = secs == null ? FADE_OUT : secs;
      on = false;
      rampTo(fadeNode.gain, 0, d);
      if (voice) {
        const v = voice; voice = null;
        v.oscs.forEach(o => { try { o.stop(ac.currentTime + d + 0.05); } catch (e) {} });
        setTimeout(() => { try { v.out.disconnect(); } catch (e) {} }, (d + 0.4) * 1000);
      }
      // Suspend once silent: a suspended engine stops competing with the player for system controls.
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => {
        if (!on && ac.state === 'running') { expect = 'suspended'; try { const r = ac.suspend(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
      }, (d + 0.25) * 1000);
    },
    retune() {
      if (!voice || !ac) return;
      const p = hooks.params();
      if (voice.mode !== p.mode || (p.mode === 'isochronic' && voice.pulse !== p.pulse)) { build(); return; }
      const t = ac.currentTime, tc = 0.04;
      if (voice.mode === 'binaural') {
        voice.l.frequency.setTargetAtTime(p.carrier - p.beat / 2, t, tc);
        voice.r.frequency.setTargetAtTime(p.carrier + p.beat / 2, t, tc);
      } else {
        voice.car.frequency.setTargetAtTime(p.carrier, t, tc);
        voice.lfo.frequency.setTargetAtTime(p.beat, t, tc);
      }
      voice.out.gain.setTargetAtTime(carrierComp(p.carrier), t, tc);
    },
    setLevel(v) { if (ac) glide(levelNode.gain, toneAmp(v), 0.03); },
    /** Ramp the fade stage (used for a session's closing fade and to cancel it). */
    fadeTo(value, secs) { if (ac && on) rampTo(fadeNode.gain, value, secs); },
    /** After a call or Siri, Safari may leave the engine interrupted; pick it back up. */
    resumeIfNeeded() { if (on && ac && ac.state !== 'running') { try { ac.resume(); } catch (e) {} } }
  };
}
