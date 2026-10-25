// Focus Player: focus music with binaural or isochronic tones, and podcasts.
// One audio element plays one thing at a time; the Focus and Podcasts tabs take turns owning it.
import { BANDS, bandFor, MODES, DEFAULT_CARRIER, TONE_MAX, envFor, createToneEngine } from './tone.js';
import * as db from './db.js';
import { beginDrag } from './reorder.js';

/* ---------- helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const LS = 'focusplayer.';
const store = {
  get(k, d) { try { const v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} }
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => { v = Number(v); return isFinite(v) ? v : d; };
const fmtHz = v => Number.isInteger(v) ? String(v) : v.toFixed(1);
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
function fmtLeft(s) {
  if (!isFinite(s) || s <= 0) return '0 s left';
  return s >= 60 ? Math.ceil(s / 60) + ' min left' : Math.ceil(s) + ' s left';
}
function fmtSize(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cleanName = n => n.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
const gain = v => { const x = clamp(v, 0, 100) / 100; return x * x; }; // volume slider taper (Mac)
function setFill(input) {
  const min = num(input.min, 0), max = num(input.max, 100), v = num(input.value, 0);
  input.style.setProperty('--p', ((v - min) / (max - min || 1) * 100) + '%');
}
function svgUse(id, cls) {
  const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), u = document.createElementNS(ns, 'use');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  u.setAttribute('href', '#' + id);
  s.appendChild(u);
  return s;
}
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function shuffled(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------- constants ---------- */
const UNGROUPED = { music: 'ungrouped:music', podcast: 'ungrouped:podcast' };
const SPEEDS = [0.8, 1, 1.2, 1.5, 1.75, 2];
const END_FADE = 10;            // seconds of fade at the end of a focus or sleep timer
const SKIP_BACK = 15, SKIP_FWD = 30;
const END_MODES = ['group', 'continue', 'track'];
const END_LABEL = { group: 'At the end of the group: loop the group', continue: 'At the end of the group: continue to the next group', track: 'Loop this track' };
const END_TOAST = { group: 'Loop the group', continue: 'Continue to the next group', track: 'Loop this track' };
const ARTWORK = [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }];
// iPhone and iPad ignore the volume of audio elements; only the side buttons change it.
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
const canSetVolume = !isIOS;
const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

/* ---------- settings ---------- */
function initialToneLevel() {
  const v = store.get('toneLevel', null);
  if (v !== null) return clamp(Math.round(num(v, 59)), 0, 100);
  const old = store.get('volTone', null); // earliest versions peaked at 0.7; convert so the tone sounds the same
  if (old !== null) return Math.min(100, Math.round(clamp(num(old, 35), 0, 100) * Math.sqrt(0.7 / TONE_MAX)));
  return 59;
}
const oldRepeat = store.get('repeat', null);
const savedTab = store.get('tab', 'focus');
const S = {
  mode: MODES[store.get('mode', 'isochronic')] ? store.get('mode', 'isochronic') : 'isochronic',
  beat: Math.round(clamp(num(store.get('beat', 10), 10), 0.5, 40) * 2) / 2,
  carrier: Math.round(clamp(num(store.get('carrier', DEFAULT_CARRIER), DEFAULT_CARRIER), 80, 500)),
  pulse: store.get('pulse', 'smooth') === 'sharp' ? 'sharp' : 'smooth',
  toneLevel: initialToneLevel(),
  volMusic: clamp(num(store.get('volMusic', 80), 80), 0, 100),
  volPod: clamp(num(store.get('volPod', 90), 90), 0, 100),
  musicOn: store.get('musicOn', true) !== false,
  shuffle: !!store.get('shuffle', false),
  endMode: END_MODES.includes(store.get('endMode', null)) ? store.get('endMode') : (oldRepeat === 'one' ? 'track' : 'group'),
  focusId: store.get('currentId', null),
  podId: store.get('podId', null),
  speed: SPEEDS.includes(num(store.get('speed', 1), 1)) ? num(store.get('speed', 1), 1) : 1,
  tab: savedTab === 'library' || savedTab === 'podcasts' ? savedTab : 'focus',
  libSection: store.get('libSection', 'music') === 'podcast' ? 'podcast' : 'music'
};
store.set('toneLevel', S.toneLevel);
store.set('endMode', S.endMode);
const collapsed = new Set(store.get('collapsed', []));

/* ---------- elements ---------- */
const E = {
  el: $('#player'), body: document.body,
  // focus
  focusPick: $('#focus-pick'), npTitle: $('#np-title'), npSub: $('#np-sub'), npEmpty: $('#np-empty'), source: $('#source'),
  seek: $('#seek'), tCur: $('#t-cur'), tDur: $('#t-dur'),
  play: $('#btn-play'), prev: $('#btn-prev'), next: $('#btn-next'), shuffle: $('#btn-shuffle'), end: $('#btn-end'), endBadge: $('#end-badge'),
  volMusic: $('#vol-music'), outMusic: $('#out-music'), rowMusic: $('#row-music'), volTone: $('#vol-tone'), outTone: $('#out-tone'),
  // tone
  mode: $('#mode'), bands: $('#bands'), beat: $('#beat'), carrier: $('#carrier'), outBeat: $('#out-beat'), outCarrier: $('#out-carrier'),
  carrierReset: $('#carrier-reset'), beatBig: $('#beat-big'), beatLbl: $('#beat-lbl'), carrierOut: $('#carrier-out'),
  modeHint: $('#mode-hint'), scope: $('#scope'), scopeCap: $('#scope-cap'), pulse: $('#pulse'), optPulse: $('#opt-pulse'),
  // podcasts
  podGroup: $('#pod-group'), podPick: $('#pod-pick'), podTitle: $('#pod-title'), podSub: $('#pod-sub'), podEmpty: $('#pod-empty'), podPlayed: $('#pod-played'),
  podSeek: $('#pod-seek'), podCur: $('#pod-cur'), podLeft: $('#pod-left'), podPlay: $('#pod-play'), podBack: $('#pod-back'), podFwd: $('#pod-fwd'),
  speed: $('#speed'), speedRead: $('#speed-read'), podMixer: $('#pod-mixer'), volPod: $('#vol-pod'), outPod: $('#out-pod'),
  // library
  lib: $('#lib'), libMeta: $('#lib-meta'), libEdit: $('#lib-edit'), libAdd: $('#lib-add'), libSection: $('#lib-section'), editTools: $('#edit-tools'),
  newLabel: $('#new-label'), drop: $('#drop'), status: $('#status'), filter: $('#filter'), groups: $('#groups'),
  libEmpty: $('#lib-empty'), libEmptyTitle: $('#lib-empty-title'), libEmptyText: $('#lib-empty-text'), libEmptyAdd: $('#lib-empty-add'), libFoot: $('#lib-foot'),
  selbar: $('#selbar'), selCount: $('#sel-count'), selLabel: $('#sel-label'), selMove: $('#sel-move'), selPlayed: $('#sel-played'), selDelete: $('#sel-delete'),
  // shell
  dock: $('#dock'), views: { focus: $('#view-focus'), podcasts: $('#view-podcasts'), library: $('#view-library') },
  mini: $('#mini'), miniOpen: $('#mini-open'), miniTitle: $('#mini-title'), miniSub: $('#mini-sub'), miniPlay: $('#mini-play'), miniNext: $('#mini-next'), miniFwd: $('#mini-fwd'),
  picker: $('#picker'), pickerTitle: $('#picker-title'), pickerFilter: $('#picker-filter'), pickerBody: $('#picker-body'), pickerDone: $('#picker-done'),
  labelDlg: $('#label-dlg'), labelTitle: $('#label-title'), labelList: $('#label-list'), labelForm: $('#label-form'), labelName: $('#label-name'), labelCreate: $('#label-create'), labelCancel: $('#label-cancel'),
  toast: $('#toast'), file: $('#file-input')
};
const el = E.el;
el.preservesPitch = true;
try { el.webkitPreservesPitch = true; } catch (e) {}

let toastTimer = 0;
function toast(msg) {
  E.toast.textContent = msg;
  E.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { E.toast.hidden = true; }, 3800);
}
function showStatus(text, problems) {
  E.status.replaceChildren(h('div', '', text));
  if (problems && problems.length) {
    const ul = h('ul');
    problems.forEach(p => ul.appendChild(h('li', '', p)));
    E.status.appendChild(ul);
  }
  E.status.hidden = false;
}

/* ---------- library model ---------- */
const lib = { items: new Map(), labels: new Map(), urls: new Map() };
let dbFailed = false;
const byOrder = (a, b) => (a.order - b.order) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const labelsOf = section => [...lib.labels.values()].filter(l => l.section === section).sort(byOrder);
const itemsIn = labelId => [...lib.items.values()].filter(i => i.labelId === labelId).sort(byOrder);
const itemsOf = section => [...lib.items.values()].filter(i => i.section === section);
function groupsOf(section, showEmpty) {
  return labelsOf(section).map(l => ({ label: l, items: itemsIn(l.id) }))
    .filter(g => showEmpty === 'all' || g.items.length || (showEmpty && !g.label.builtin));
}
function labelName(id) { const l = lib.labels.get(id); return l ? l.name : 'Ungrouped'; }
function nextOrder(labelId) { const its = itemsIn(labelId); return its.length ? its[its.length - 1].order + 1 : 0; }
function saveFailed() { toast('Couldn’t save that change. Reload the app and try again.'); }
function save(items) { items = [].concat(items).filter(Boolean); if (items.length && !dbFailed) db.putItems(items).catch(saveFailed); }
function saveLabels(labels) { labels = [].concat(labels).filter(Boolean); if (labels.length && !dbFailed) db.putLabels(labels).catch(saveFailed); }

/* ---------- the player element ----------
   One element carries everything the system controls: a focus track, a silent loop for tone-only, or an episode.
   The lock screen, Control Center, media keys and headphones therefore always have one player to talk to. */
let owner = store.get('owner', 'focus') === 'podcast' ? 'podcast' : 'focus'; // which tab the player belongs to
let playing = false;
let loaded = { kind: 'none', id: null };   // 'track' | 'silence' | 'episode' | 'none'
let switching = false;                      // true while the source is swapped during playback
let pendingSeek = 0;                        // where to jump once the new source is ready
let focusResume = null;                     // { id, at }: where a focus track continues after tone-only or a podcast
let silentUrl = null;

function silentSrc() {
  if (silentUrl) return silentUrl;
  const sr = 8000, n = sr * 30, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 8-bit silence
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}
function setSrc(url, kind, id, opts) {
  switching = !el.paused;
  el.loop = !!opts.loop;
  el.defaultPlaybackRate = opts.rate || 1;
  el.src = url;
  el.playbackRate = opts.rate || 1;
  loaded = { kind, id };
  pendingSeek = opts.seek || 0;
}
function leaveCurrent() {
  if (loaded.kind === 'track') focusResume = { id: loaded.id, at: el.ended ? 0 : (el.currentTime || 0) };
  else if (loaded.kind === 'episode') savePodPosition(true);
}
function loadTrack(id) {
  const url = lib.urls.get(id);
  if (!url) return false;
  if (!(loaded.kind === 'track' && loaded.id === id)) leaveCurrent();
  const at = focusResume && focusResume.id === id ? focusResume.at : 0;
  focusResume = null;
  setSrc(url, 'track', id, { loop: shouldLoopTrack(), seek: at });
  renderFocusSeek();
  return true;
}
function loadSilence() {
  if (loaded.kind === 'silence') return;
  leaveCurrent();
  setSrc(silentSrc(), 'silence', null, { loop: true });
}
function loadEpisode(id) {
  const it = lib.items.get(id), url = lib.urls.get(id);
  if (!it || !url) return false;
  leaveCurrent();
  let at = it.played ? 0 : (it.position || 0);
  if (it.duration && at >= it.duration - 1) at = 0;
  setSrc(url, 'episode', id, { rate: S.speed, seek: at });
  return true;
}
function unload() {
  el.pause();
  el.removeAttribute('src');
  try { el.load(); } catch (e) {}
  loaded = { kind: 'none', id: null };
}
function safePlay() {
  try {
    const p = el.play();
    if (p && p.then) p.then(() => { switching = false; }, err => {
      switching = false;
      if (!err) return;
      if (err.name === 'NotAllowedError') { pauseAll(); toast('Tap play to start audio.'); }
      else if (err.name === 'NotSupportedError' && loaded.kind !== 'silence') toast('This file can’t be played in this browser.');
    });
    else switching = false;
  } catch (e) { switching = false; }
}
function applyVolume() {
  if (!canSetVolume) return;
  if (loaded.kind === 'track') el.volume = gain(S.volMusic) * ftimer.factor();
  else if (loaded.kind === 'episode') el.volume = gain(S.volPod) * stimer.factor();
  else el.volume = 1;
}

/* ---------- tone engine ---------- */
const tone = createToneEngine({
  params: () => ({ mode: S.mode, beat: S.beat, carrier: S.carrier, pulse: S.pulse, level: S.toneLevel }),
  onSystemPause: () => { if (owner === 'focus' && playing) pauseFocus(0.05); },
  onSystemPlay: () => { if (owner === 'focus' && !playing) playFocus(); },
  toast
});

/* ---------- ownership: one thing plays at a time ---------- */
function claim(next) {
  if (owner === next) return;
  if (owner === 'podcast') { if (playing) pausePodcast(); else savePodPosition(true); }
  else if (playing) pauseFocus();
  owner = next;
  store.set('owner', next);
}
function playAll() { if (owner === 'podcast') playPodcast(); else playFocus(); }
function pauseAll(fade) { if (owner === 'podcast') pausePodcast(); else pauseFocus(fade); }
function togglePlay() { if (playing) pauseAll(); else playAll(); }

/* ---------- focus session ---------- */
const fq = { seq: null, seqGroup: null }; // shuffled order of the current group
function focusTrack() { const it = lib.items.get(S.focusId); return it && it.section === 'music' ? it : null; }
function musicActive() { return S.musicOn && !!focusTrack(); }
function firstMusicId() { for (const l of labelsOf('music')) { const its = itemsIn(l.id); if (its.length) return its[0].id; } return null; }
function groupSeq(labelId) {
  const ids = itemsIn(labelId).map(i => i.id);
  if (!S.shuffle) return ids;
  const same = fq.seqGroup === labelId && fq.seq && fq.seq.length === ids.length && ids.every(id => fq.seq.includes(id));
  if (!same) {
    const rest = shuffled(ids.filter(id => id !== S.focusId));
    fq.seq = ids.includes(S.focusId) ? [S.focusId].concat(rest) : rest;
    fq.seqGroup = labelId;
  }
  return fq.seq;
}
// The track before or after the current one, following the end-of-group setting.
function neighbor(dir) {
  const cur = focusTrack();
  if (!cur) return firstMusicId();
  const seq = groupSeq(cur.labelId), i = seq.indexOf(cur.id), j = i + dir;
  if (i >= 0 && j >= 0 && j < seq.length) return seq[j];
  if (S.endMode === 'continue') {
    const gs = labelsOf('music').filter(l => itemsIn(l.id).length), gi = gs.findIndex(l => l.id === cur.labelId);
    if (gs.length > 1 && gi >= 0) {
      const ng = gs[(gi + (dir > 0 ? 1 : gs.length - 1)) % gs.length];
      const ids = itemsIn(ng.id).map(x => x.id), nseq = S.shuffle ? shuffled(ids) : ids;
      return dir > 0 ? nseq[0] : nseq[nseq.length - 1];
    }
  }
  return dir > 0 ? seq[0] : seq[seq.length - 1];
}
function shouldLoopTrack() { return S.endMode === 'track' || neighbor(1) === S.focusId; }
function refreshLoop() { if (loaded.kind === 'track') el.loop = shouldLoopTrack(); }

function setTrack(id) {
  if (!lib.urls.get(id)) return false;
  S.focusId = id;
  store.set('currentId', id);
  if (focusResume && focusResume.id !== id) focusResume = null;
  if (owner === 'focus' && S.musicOn) loadTrack(id);
  renderFocus(); renderLibrarySoon(); renderMini(); updateMediaSession();
  return true;
}
function playFocus() {
  claim('focus');
  if (S.musicOn && !focusTrack()) { const f = firstMusicId(); if (f) setTrack(f); }
  const music = musicActive(), withTone = S.mode !== 'off';
  if (!music && !withTone) {
    toast(S.musicOn ? (itemsOf('music').length ? 'Pick a track, or turn on a tone.' : 'Add music in the Library, or turn on a tone.') : 'Turn on Binaural or Isochronic to play the tone on its own.');
    return;
  }
  playing = true;
  if (withTone) tone.start(ftimer.fading ? ftimer.remaining : null); // the tone starts first, so the player is the newest source
  if (music) { if (!(loaded.kind === 'track' && loaded.id === S.focusId)) loadTrack(S.focusId); }
  else loadSilence();
  applyVolume();
  safePlay();
  ftimer.resume();
  renderPlayState(); renderFocus(); startScope(); updateMediaSession();
}
function pauseFocus(fade) {
  playing = false;
  if (!el.paused) el.pause();
  tone.stop(fade);
  ftimer.pause();
  if (loaded.kind === 'track') focusResume = { id: loaded.id, at: el.currentTime || 0 };
  applyVolume();
  renderPlayState(); renderFocus(); renderLibrarySoon(); updateMediaSession();
}
function nextTrack() {
  if (!musicActive()) return;
  const id = neighbor(1);
  if (!id) return;
  setTrack(id);
  if (owner === 'focus' && playing) safePlay();
}
function prevTrack() {
  if (!musicActive()) return;
  if (owner === 'focus' && loaded.kind === 'track' && el.currentTime > 3) { el.currentTime = 0; updatePosition(); return; }
  const id = neighbor(-1);
  if (!id) return;
  setTrack(id);
  if (owner === 'focus' && playing) safePlay();
}
function setMusicOn(on) {
  if (S.musicOn === on) return;
  S.musicOn = on;
  store.set('musicOn', on);
  if (owner === 'focus') {
    if (on) {
      if (!focusTrack()) { const f = firstMusicId(); if (f) setTrack(f); }
      else if (!(loaded.kind === 'track' && loaded.id === S.focusId)) loadTrack(S.focusId);
      if (playing) { if (musicActive()) { applyVolume(); safePlay(); } else if (S.mode === 'off') pauseFocus(); }
    } else {
      if (S.mode !== 'off' || loaded.kind === 'track') loadSilence();
      if (playing) { if (S.mode === 'off') pauseFocus(); else safePlay(); }
    }
  }
  renderFocus(); renderMini(); renderLibrarySoon(); updateMediaSession();
}
function playMusicItem(id) {
  if (owner === 'focus' && playing && S.musicOn && id === S.focusId) { pauseFocus(); return; }
  claim('focus');
  if (!S.musicOn) { S.musicOn = true; store.set('musicOn', true); }
  if (id !== S.focusId || !(loaded.kind === 'track' && loaded.id === id)) setTrack(id);
  playFocus();
}

/* ---------- podcast session ---------- */
function podItem() { const it = lib.items.get(S.podId); return it && it.section === 'podcast' ? it : null; }
let lastPosSave = 0;
function savePodPosition(force) {
  if (loaded.kind !== 'episode' || pendingSeek) return;
  const it = lib.items.get(loaded.id);
  if (!it || el.ended) return;
  it.position = el.currentTime || 0;
  const now = Date.now();
  if (!force && now - lastPosSave < 5000) return;
  lastPosSave = now;
  save(it);
}
function playPodcast(id) {
  if (id && id !== S.podId) { savePodPosition(true); S.podId = id; store.set('podId', id); }
  const it = podItem();
  if (!it) { openPicker('podcast'); return; }
  claim('podcast');
  if (it.played) { // a finished episode starts again from the beginning
    it.played = false; it.position = 0; save(it);
    if (loaded.kind === 'episode' && loaded.id === it.id) { try { el.currentTime = 0; } catch (e) {} }
  }
  if (!(loaded.kind === 'episode' && loaded.id === it.id)) loadEpisode(it.id);
  playing = true;
  applyVolume();
  safePlay();
  stimer.resume();
  renderPlayState(); renderPodcast(); renderLibrarySoon(); updateMediaSession();
}
function pausePodcast() {
  playing = false;
  if (!el.paused) el.pause();
  savePodPosition(true);
  stimer.pause();
  applyVolume();
  renderPlayState(); renderPodcast(); renderLibrarySoon(); updateMediaSession();
}
function playPodItem(id) {
  if (owner === 'podcast' && playing && id === S.podId) { pausePodcast(); return; }
  playPodcast(id);
}
function skip(sec) {
  const it = podItem();
  if (!it) return;
  if (loaded.kind === 'episode' && loaded.id === it.id && !pendingSeek) {
    const d = isFinite(el.duration) ? el.duration : (it.duration || Infinity);
    el.currentTime = clamp((el.currentTime || 0) + sec, 0, Math.max(0, d - 0.25));
    savePodPosition(true);
    updatePosition();
  } else {
    it.position = clamp((it.position || 0) + sec, 0, Math.max(0, (it.duration || 0) - 1));
    if (loaded.kind === 'episode' && loaded.id === it.id) pendingSeek = it.position;
    save(it);
  }
  renderPodcast();
}
function seekPodcast(t) {
  const it = podItem();
  if (!it) return;
  if (loaded.kind === 'episode' && loaded.id === it.id && !pendingSeek) { el.currentTime = t; savePodPosition(true); updatePosition(); }
  else { it.position = t; save(it); }
  renderPodcast();
}
function setSpeed(v) {
  S.speed = v; store.set('speed', v);
  if (loaded.kind === 'episode') { el.defaultPlaybackRate = v; el.playbackRate = v; updatePosition(); }
  renderPodcast();
}
function setPlayed(ids, flag) {
  const changed = [];
  ids.forEach(id => {
    const it = lib.items.get(id);
    if (!it || it.section !== 'podcast') return;
    it.played = flag;
    if (flag) it.position = 0;
    if (loaded.kind === 'episode' && loaded.id === id && flag && !playing) pendingSeek = 0;
    changed.push(it);
  });
  save(changed);
  renderPodcast(); renderLibrarySoon(); if (E.picker.open) renderPicker();
}

/* ---------- keeping the element and the app in step ----------
   The system can pause or resume the element or the tone engine directly (lock screen, Control Center,
   media keys, headphones, calls). Whatever it touches, the app applies to the whole session. */
el.addEventListener('pause', () => { if (!playing || switching || el.ended) return; pauseAll(); });
el.addEventListener('play', () => { if (playing) return; playAll(); });
el.addEventListener('playing', () => { switching = false; });
el.addEventListener('ended', () => {
  if (loaded.kind === 'track') {
    const id = neighbor(1);
    if (id && id !== S.focusId) { setTrack(id); safePlay(); }
    else if (id) { el.currentTime = 0; safePlay(); }
    else if (S.mode === 'off') pauseFocus();
    else { loadSilence(); safePlay(); }
  } else if (loaded.kind === 'episode') {
    // Podcasts play one episode at a time: stop, and mark it played.
    const it = lib.items.get(loaded.id);
    if (it) { it.played = true; it.position = 0; save(it); }
    playing = false;
    stimer.set(0);
    applyVolume();
    renderPlayState(); renderPodcast(); renderLibrarySoon(); updateMediaSession();
    if (E.picker.open) renderPicker();
  }
});
el.addEventListener('loadedmetadata', () => {
  const d = el.duration;
  if (pendingSeek && isFinite(d) && pendingSeek < d) { try { el.currentTime = pendingSeek; } catch (e) {} }
  pendingSeek = 0;
  if (loaded.id && isFinite(d) && d > 0) {
    const it = lib.items.get(loaded.id);
    if (it && Math.abs((it.duration || 0) - d) > 0.5) { it.duration = d; save(it); renderLibrarySoon(); }
  }
  if (loaded.kind === 'episode') { el.playbackRate = S.speed; renderPodcast(); }
  else renderFocusSeek();
  updatePosition();
});
let seekingF = false, seekingP = false;
el.addEventListener('timeupdate', () => {
  if (loaded.kind === 'episode') {
    stimer.tick();
    savePodPosition(false);
    if (!seekingP) renderPodSeek();
  } else {
    ftimer.tick();
    if (!seekingF && loaded.kind === 'track') renderFocusSeek();
  }
});
el.addEventListener('seeked', updatePosition);
el.addEventListener('ratechange', () => { if (loaded.kind === 'episode' && el.playbackRate !== S.speed) el.playbackRate = S.speed; });
el.addEventListener('error', () => { if (loaded.kind === 'track' || loaded.kind === 'episode') toast('This file can’t be played in this browser.'); });

/* ---------- timers (focus timer, sleep timer) ----------
   Count down while their session plays, pause with it, and fade out over the last 10 seconds. */
function makeTimer(root, cfg) {
  const R = { read: $('[data-read]', root), fill: $('[data-fill]', root), len: $('[data-len]', root), note: $('[data-note]', root) };
  let min = num(store.get(cfg.key, 0), 0);
  if (!cfg.choices.includes(min)) min = 0;
  const t = { min, remaining: min * 60, running: false, last: 0, iv: 0, fading: false, done: false, shown: -1 };
  const api = {
    get fading() { return t.fading; },
    get remaining() { return t.remaining; },
    factor() { return t.fading ? clamp(t.remaining / END_FADE, 0, 1) : 1; },
    resume() {
      if (!t.min || t.running) return;
      if (t.done || t.remaining <= 0) { t.done = false; t.remaining = t.min * 60; }
      t.running = true;
      t.last = performance.now();
      if (!t.iv) t.iv = setInterval(api.tick, 250);
      api.render();
    },
    pause() {
      if (t.running) api.tick();
      t.running = false;
      clearInterval(t.iv); t.iv = 0;
      t.fading = false; // the pause fade takes over; the closing fade restarts on resume
      api.render();
    },
    tick() {
      if (!t.running) return;
      const now = performance.now();
      t.remaining -= (now - t.last) / 1000;
      t.last = now;
      if (t.remaining <= END_FADE && !t.fading) { t.fading = true; if (cfg.onFadeStart) cfg.onFadeStart(Math.max(0.05, t.remaining)); }
      if (t.fading && cfg.onFadeTick) cfg.onFadeTick();
      if (t.remaining <= 0) {
        t.running = false; t.fading = false; t.remaining = 0;
        clearInterval(t.iv); t.iv = 0;
        if (cfg.resetAfterDone) { t.min = 0; store.set(cfg.key, 0); t.done = false; } else t.done = true;
        cfg.onDone();
        api.render();
        return;
      }
      if (Math.ceil(t.remaining) !== t.shown) api.render();
    },
    set(m) {
      const wasFading = t.fading;
      clearInterval(t.iv); t.iv = 0;
      t.min = m; store.set(cfg.key, m);
      t.running = false; t.fading = false; t.done = false; t.remaining = m * 60;
      if (wasFading && cfg.onFadeCancel) cfg.onFadeCancel();
      if (cfg.isActive()) api.resume();
      api.render();
    },
    render() {
      const total = t.min * 60, rem = Math.max(0, t.remaining);
      t.shown = Math.ceil(rem);
      $$('button', R.len).forEach(b => b.setAttribute('aria-checked', String(num(b.dataset.min, 0) === t.min)));
      root.classList.toggle('is-off', !t.min);
      root.classList.toggle('is-running', t.running);
      if (!t.min) { R.read.textContent = 'Off'; R.fill.style.width = '0%'; R.note.textContent = cfg.noteOff; return; }
      R.read.textContent = t.done ? 'Done' : fmtTime(Math.ceil(rem));
      R.fill.style.width = (t.done ? 100 : (1 - rem / total) * 100) + '%';
      let note;
      if (t.done) note = cfg.noteDone;
      else if (t.running) note = cfg.noteRunning(new Date(Date.now() + rem * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      else if (rem < total) note = 'Paused with playback.';
      else note = cfg.noteIdle;
      R.note.textContent = note;
    }
  };
  R.len.addEventListener('click', e => { const b = e.target.closest('button[data-min]'); if (b) api.set(num(b.dataset.min, 0)); });
  return api;
}
const ftimer = makeTimer($('#ftimer'), {
  key: 'timerMin', choices: [0, 25, 50, 90],
  isActive: () => owner === 'focus' && playing,
  onFadeStart: secs => tone.fadeTo(0, secs),
  onFadeTick: applyVolume,
  onFadeCancel: () => { tone.fadeTo(1, 0.6); applyVolume(); },
  onDone: () => { pauseFocus(0.05); toast('Focus session complete.'); },
  noteOff: 'Plays until you stop it.',
  noteIdle: 'Starts with playback and fades out over the last 10 seconds.',
  noteRunning: at => 'Ends at ' + at + ', fading out over the last 10 seconds.',
  noteDone: 'Session complete. Press play to start another.'
});
const stimer = makeTimer($('#stimer'), {
  key: 'sleepMin', choices: [0, 15, 30, 45, 60], resetAfterDone: true,
  isActive: () => owner === 'podcast' && playing,
  onFadeTick: applyVolume,
  onFadeCancel: applyVolume,
  onDone: () => { pausePodcast(); toast('Sleep timer ended.'); },
  noteOff: 'Episodes always stop at their end.',
  noteIdle: 'Starts with playback.',
  noteRunning: at => 'Stops at ' + at + (canSetVolume ? ', fading out over the last 10 seconds.' : '.'),
  noteDone: ''
});

/* ---------- scope ---------- */
const sctx = E.scope.getContext('2d');
let scopeW = 0, scopeH = 0, dpr = 1, phase = 0, lastT = 0, rafId = 0, colors = {};
const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  colors = { trace: cs.getPropertyValue('--trace').trim() || '#F2A541', trace2: cs.getPropertyValue('--trace-2').trim() || '#5CC6DA', grid: cs.getPropertyValue('--screen-grid').trim() || 'rgba(255,255,255,.08)', dim: cs.getPropertyValue('--screen-dim').trim() || '#7F889A' };
}
function sizeScope() {
  const r = E.scope.getBoundingClientRect();
  if (!r.width) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  scopeW = Math.round(r.width); scopeH = Math.round(r.height);
  E.scope.width = scopeW * dpr; E.scope.height = scopeH * dpr;
  drawScope();
}
function drawScope() {
  if (!scopeW) return;
  const c = sctx, W = 1, mid = scopeH / 2, A = scopeH * 0.4, f = S.beat;
  let x, t, e, y;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, scopeW, scopeH);
  c.strokeStyle = colors.grid; c.lineWidth = 1; c.beginPath();
  for (let i = 1; i < 10; i++) { x = Math.round(i * scopeW / 10) + 0.5; c.moveTo(x, 0); c.lineTo(x, scopeH); }
  c.moveTo(0, Math.round(mid) + 0.5); c.lineTo(scopeW, Math.round(mid) + 0.5);
  c.stroke();
  if (S.mode === 'off') { c.strokeStyle = colors.dim; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, mid); c.lineTo(scopeW, mid); c.stroke(); return; }
  const ys = new Float32Array(scopeW + 1), env = envFor(S.pulse);
  for (x = 0; x <= scopeW; x++) {
    t = x / scopeW * W + phase;
    ys[x] = S.mode === 'isochronic' ? env((f * t) % 1) : Math.abs(Math.cos(Math.PI * f * t));
  }
  const top = colors.trace, bottom = S.mode === 'binaural' ? colors.trace2 : colors.trace;
  c.globalAlpha = 0.2;
  c.fillStyle = top; c.beginPath(); c.moveTo(0, mid);
  for (x = 0; x <= scopeW; x++) c.lineTo(x, mid - ys[x] * A);
  c.lineTo(scopeW, mid); c.closePath(); c.fill();
  c.fillStyle = bottom; c.beginPath(); c.moveTo(0, mid);
  for (x = 0; x <= scopeW; x++) c.lineTo(x, mid + ys[x] * A);
  c.lineTo(scopeW, mid); c.closePath(); c.fill();
  c.globalAlpha = 1;
  if (S.mode === 'isochronic' && scopeW / (S.carrier * W) >= 2.5) { // the carrier itself, where its cycles are wide enough to see
    c.strokeStyle = top; c.globalAlpha = 0.55; c.lineWidth = 1; c.beginPath();
    for (x = 0; x <= scopeW; x += 0.5) {
      t = x / scopeW * W + phase; e = env((f * t) % 1);
      y = mid - Math.sin(2 * Math.PI * S.carrier * t) * e * A;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke(); c.globalAlpha = 1;
  }
  c.lineWidth = 1.6; c.lineJoin = 'round';
  c.strokeStyle = top; c.beginPath();
  for (x = 0; x <= scopeW; x++) { y = mid - ys[x] * A; if (x === 0) c.moveTo(x, y); else c.lineTo(x, y); }
  c.stroke();
  c.strokeStyle = bottom; c.beginPath();
  for (x = 0; x <= scopeW; x++) { y = mid + ys[x] * A; if (x === 0) c.moveTo(x, y); else c.lineTo(x, y); }
  c.stroke();
}
function scopeLive() { return owner === 'focus' && playing && S.tab === 'focus' && !reduceMotion.matches && !document.hidden; }
function startScope() {
  if (rafId) return;
  if (!scopeLive()) { drawScope(); return; }
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
}
function frame(now) {
  rafId = 0;
  if (!scopeLive()) { drawScope(); return; }
  phase = (phase + (now - lastT) / 1000) % 3600;
  lastT = now;
  drawScope();
  rafId = requestAnimationFrame(frame);
}

/* ---------- rendering: focus ---------- */
function toneSummary() {
  if (S.mode === 'off') return 'Tone off';
  if (S.toneLevel === 0) return 'Tone muted';
  return MODES[S.mode] + ' · ' + fmtHz(S.beat) + ' Hz ' + bandFor(S.beat).name.toLowerCase();
}
function renderPlayState() {
  const fp = owner === 'focus' && playing, pp = owner === 'podcast' && playing;
  [[E.play, fp], [E.podPlay, pp], [E.miniPlay, playing]].forEach(([b, on]) => {
    $('.i-play', b).toggleAttribute('hidden', on);
    $('.i-pause', b).toggleAttribute('hidden', !on);
    b.setAttribute('aria-label', on ? 'Pause' : 'Play');
  });
  E.body.classList.toggle('is-playing', playing);
  renderMini();
}
function renderFocus() {
  const t = focusTrack(), hasMusic = itemsOf('music').length > 0, toneOnly = !S.musicOn;
  E.body.classList.toggle('tone-only', toneOnly);
  E.npTitle.textContent = toneOnly ? 'Tone only' : (t ? t.name : (hasMusic ? 'Pick a track' : 'No music yet'));
  E.npSub.textContent = (!toneOnly && t) ? labelName(t.labelId) + ' · ' + toneSummary() : toneSummary();
  E.npEmpty.hidden = toneOnly || hasMusic;
  $$('button', E.source).forEach(b => b.setAttribute('aria-checked', String((b.dataset.source === 'tone') === toneOnly)));
  const off = toneOnly || !hasMusic;
  E.prev.disabled = E.next.disabled = E.shuffle.disabled = E.end.disabled = off;
  E.volMusic.disabled = toneOnly;
  E.shuffle.setAttribute('aria-pressed', String(S.shuffle));
  E.shuffle.setAttribute('aria-label', S.shuffle ? 'Shuffle within the group: on' : 'Shuffle within the group: off');
  E.end.setAttribute('aria-label', END_LABEL[S.endMode]);
  E.end.title = END_LABEL[S.endMode];
  $('.e-repeat', E.end).toggleAttribute('hidden', S.endMode === 'continue');
  $('.e-continue', E.end).toggleAttribute('hidden', S.endMode !== 'continue');
  E.endBadge.hidden = S.endMode !== 'track';
  renderFocusSeek();
}
function renderFocusSeek() {
  const t = focusTrack(), live = loaded.kind === 'track' && t && loaded.id === t.id;
  let cur = 0, dur = t ? t.duration || 0 : 0;
  if (live) { cur = el.currentTime || pendingSeek || 0; if (isFinite(el.duration) && el.duration > 0) dur = el.duration; }
  else if (t && focusResume && focusResume.id === t.id) cur = focusResume.at;
  E.seek.disabled = !live;
  E.tCur.textContent = fmtTime(cur);
  E.tDur.textContent = fmtTime(dur);
  E.seek.value = dur ? Math.round(cur / dur * 1000) : 0;
  setFill(E.seek);
}
function renderVolumes() {
  E.volMusic.value = S.volMusic; E.volTone.value = S.toneLevel; E.volPod.value = S.volPod;
  E.outMusic.textContent = Math.round(S.volMusic); E.outTone.textContent = Math.round(S.toneLevel); E.outPod.textContent = Math.round(S.volPod);
  [E.volMusic, E.volTone, E.volPod].forEach(setFill);
  E.rowMusic.hidden = !canSetVolume;
  E.podMixer.hidden = !canSetVolume;
  $$('.ios-only').forEach(n => { n.hidden = canSetVolume; });
}
function buildBands() {
  BANDS.forEach(b => {
    const btn = h('button', 'band');
    btn.type = 'button'; btn.dataset.preset = b.preset;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', b.name + ', ' + b.preset + ' hertz, ' + b.note);
    btn.append(h('span', 'bn', b.name), h('span', 'br', fmtHz(b.lo) + '–' + b.hi + ' Hz'), h('span', 'bd', b.note));
    E.bands.appendChild(btn);
  });
}
function renderTone() {
  const band = bandFor(S.beat), off = S.mode === 'off';
  $$('button', E.mode).forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)));
  $$('.band', E.bands).forEach(b => b.setAttribute('aria-pressed', String(bandFor(num(b.dataset.preset, 0)) === band)));
  E.beat.value = S.beat; E.carrier.value = S.carrier;
  setFill(E.beat); setFill(E.carrier);
  E.outBeat.textContent = fmtHz(S.beat) + ' Hz';
  E.outCarrier.textContent = S.carrier + ' Hz';
  E.carrierReset.hidden = S.carrier === DEFAULT_CARRIER;
  E.beatBig.replaceChildren(document.createTextNode(fmtHz(S.beat)), h('small', '', 'Hz'));
  E.beatLbl.textContent = band.name + ' · ' + band.note;
  E.carrierOut.replaceChildren();
  if (S.mode === 'binaural') {
    const l = S.carrier - S.beat / 2, r = S.carrier + S.beat / 2;
    E.carrierOut.append(h('span', 'l', 'L'), ' ', h('b', '', fmtHz(l) + ' Hz'), ' · ', h('span', 'r', 'R'), ' ', h('b', '', fmtHz(r) + ' Hz'));
    E.scopeCap.textContent = 'Perceived beat (left + right)';
    E.modeHint.textContent = 'Headphones required. Your left ear hears ' + fmtHz(l) + ' Hz and your right ear ' + fmtHz(r) + ' Hz; the ' + fmtHz(S.beat) + ' Hz beat forms in your brainstem from the difference.';
  } else if (S.mode === 'isochronic') {
    E.carrierOut.append('Carrier ', h('b', '', S.carrier + ' Hz'));
    E.scopeCap.textContent = S.pulse === 'sharp' ? 'Pulse envelope (sharp)' : 'Pulse envelope (smooth)';
    E.modeHint.textContent = S.pulse === 'sharp'
      ? 'Works on speakers or headphones. A ' + S.carrier + ' Hz tone switches on and off ' + fmtHz(S.beat) + ' times per second, with silence between pulses.'
      : 'Works on speakers or headphones. A ' + S.carrier + ' Hz tone swells and fades ' + fmtHz(S.beat) + ' times per second, without silent gaps.';
  } else {
    E.carrierOut.textContent = 'Tone off';
    E.scopeCap.textContent = 'No tone';
    E.modeHint.textContent = 'Tone off. Pick Binaural or Isochronic to layer a tone under your music.';
  }
  if (!off && S.carrier > DEFAULT_CARRIER) E.modeHint.textContent += ' Above 150 Hz the tone is turned down automatically to keep the same loudness.';
  E.beat.disabled = E.carrier.disabled = off;
  E.optPulse.hidden = S.mode !== 'isochronic';
  $$('button', E.pulse).forEach(b => b.setAttribute('aria-checked', String(b.dataset.pulse === S.pulse)));
  $('#hint-phones').toggleAttribute('hidden', S.mode !== 'binaural');
  $('#hint-info').toggleAttribute('hidden', S.mode === 'binaural');
  drawScope();
}

/* ---------- rendering: podcasts ---------- */
function podTimes(it) {
  const live = loaded.kind === 'episode' && it && loaded.id === it.id && !pendingSeek;
  let cur = it ? (it.played ? 0 : it.position || 0) : 0, dur = it ? it.duration || 0 : 0;
  if (live) { cur = el.currentTime || 0; if (isFinite(el.duration) && el.duration > 0) dur = el.duration; }
  else if (loaded.kind === 'episode' && it && loaded.id === it.id && pendingSeek) cur = pendingSeek;
  return { cur, dur, live };
}
function renderPodcast() {
  const it = podItem(), has = itemsOf('podcast').length > 0;
  const label = it ? lib.labels.get(it.labelId) : null;
  E.podGroup.hidden = !label || label.builtin;
  E.podGroup.textContent = label ? label.name : '';
  E.podTitle.textContent = it ? it.name : (has ? 'Pick an episode' : 'No podcasts yet');
  E.podEmpty.hidden = has;
  E.podPlayed.hidden = !it;
  E.podPlayed.textContent = it && it.played ? 'Mark as unplayed' : 'Mark as played';
  E.podPlay.disabled = E.podBack.disabled = E.podFwd.disabled = !it;
  $$('button', E.speed).forEach(b => b.setAttribute('aria-checked', String(num(b.dataset.speed, 1) === S.speed)));
  E.speedRead.textContent = S.speed + '×';
  renderPodSeek();
}
function renderPodSeek() {
  const it = podItem(), { cur, dur } = podTimes(it);
  E.podSeek.disabled = !it || !dur;
  E.podCur.textContent = fmtTime(cur);
  E.podLeft.textContent = dur ? '−' + fmtTime(Math.max(0, dur - cur)) : '0:00';
  E.podSeek.value = dur ? Math.round(cur / dur * 1000) : 0;
  setFill(E.podSeek);
  if (it) {
    const state = it.played ? 'Played' : (cur > 0 && dur ? fmtLeft(dur - cur) : (dur ? fmtTime(dur) : 'Ready'));
    E.podSub.textContent = state + (S.speed !== 1 ? ' · ' + S.speed + '×' : '');
  } else E.podSub.textContent = '';
}

/* ---------- rendering: shell ---------- */
const tabOf = o => (o === 'podcast' ? 'podcasts' : 'focus');
function renderMini() {
  let has, title = '', sub = '';
  if (owner === 'podcast') {
    const it = podItem();
    has = !!it;
    if (it) { const { cur, dur } = podTimes(it); title = it.name; sub = labelName(it.labelId) + ' · ' + (it.played ? 'Played' : fmtLeft(dur - cur)); }
  } else {
    const t = focusTrack();
    has = !!t || (!S.musicOn && S.mode !== 'off');
    title = musicActive() ? t.name : 'Tone only';
    sub = toneSummary();
  }
  const show = has && !editing && !E.picker.open && ((S.tab === 'library') || (playing && tabOf(owner) !== S.tab));
  E.mini.hidden = !show;
  E.miniTitle.textContent = title;
  E.miniSub.textContent = sub;
  E.miniNext.hidden = owner === 'podcast' || !musicActive();
  E.miniFwd.hidden = owner !== 'podcast';
  E.body.classList.toggle('has-float', show || !E.selbar.hidden);
}
function setTab(tab) {
  if (tab !== 'library' && editing) setEditing(false);
  S.tab = tab; store.set('tab', tab);
  E.dock.dataset.active = tab;
  ['focus', 'podcasts', 'library'].forEach(k => {
    E.views[k].hidden = k !== tab;
    $('#tab-' + k).setAttribute('aria-selected', String(k === tab));
  });
  if (tab === 'focus') requestAnimationFrame(() => { sizeScope(); startScope(); });
  if (tab === 'library') renderLibrary();
  if (tab === 'podcasts') renderPodcast();
  renderMini();
}

/* ---------- media session (lock screen, Control Center, media keys) ---------- */
function updatePosition() {
  const ms = navigator.mediaSession;
  if (!ms || !ms.setPositionState) return;
  try {
    const d = el.duration;
    if ((loaded.kind === 'track' || loaded.kind === 'episode') && isFinite(d) && d > 0) {
      ms.setPositionState({ duration: d, playbackRate: el.playbackRate || 1, position: Math.min(Math.max(0, el.currentTime || 0), d) });
    } else ms.setPositionState();
  } catch (e) {}
}
function setHandler(action, fn) { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {} }
function updateMediaSession() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  let meta;
  if (owner === 'podcast') {
    const it = podItem();
    meta = it ? { title: it.name, artist: labelName(it.labelId), album: 'Podcasts' } : { title: 'Podcasts', artist: 'Focus Player', album: 'Podcasts' };
    setHandler('nexttrack', null);
    setHandler('previoustrack', null);
    setHandler('seekbackward', it ? () => skip(-SKIP_BACK) : null);
    setHandler('seekforward', it ? () => skip(SKIP_FWD) : null);
    setHandler('seekto', it ? d => { if (d && isFinite(d.seekTime)) seekPodcast(d.seekTime); } : null);
  } else {
    const music = musicActive(), t = focusTrack();
    meta = music ? { title: t.name, artist: toneSummary(), album: labelName(t.labelId) } : { title: toneSummary(), artist: 'Focus Player', album: 'Tone only' };
    setHandler('seekbackward', null);
    setHandler('seekforward', null);
    setHandler('nexttrack', music ? nextTrack : null);
    setHandler('previoustrack', music ? prevTrack : null);
    setHandler('seekto', music ? d => { if (loaded.kind === 'track' && d && isFinite(d.seekTime)) { el.currentTime = d.seekTime; updatePosition(); } } : null);
  }
  try {
    if (window.MediaMetadata) ms.metadata = new MediaMetadata(Object.assign(meta, { artwork: ARTWORK }));
    ms.playbackState = playing ? 'playing' : 'paused';
  } catch (e) {}
  updatePosition();
}
function setupMediaSession() {
  if (!navigator.mediaSession) return;
  setHandler('play', () => playAll());
  setHandler('pause', () => pauseAll());
  setHandler('stop', () => pauseAll());
}

/* ---------- library ---------- */
let editing = false, filterText = '', libDirty = false;
const selected = new Set();
let addTarget = null;

function renderLibrarySoon() {
  if (S.tab !== 'library') { libDirty = true; return; }
  renderLibrary();
}
function renderLibrary() {
  // Never rebuild under a finger: wait while dragging or renaming.
  if (E.body.classList.contains('dragging') || (document.activeElement && document.activeElement.classList.contains('g-input'))) { libDirty = true; return; }
  libDirty = false;
  const section = S.libSection, all = itemsOf(section);
  $$('button', E.libSection).forEach(b => b.setAttribute('aria-checked', String(b.dataset.section === section)));
  E.libEdit.textContent = editing ? 'Done' : 'Edit';
  E.lib.classList.toggle('editing', editing);
  E.editTools.hidden = !editing;
  E.filter.hidden = editing || all.length < 2;
  const size = all.reduce((s, i) => s + (i.size || 0), 0);
  const noun = section === 'music' ? (all.length === 1 ? 'track' : 'tracks') : (all.length === 1 ? 'episode' : 'episodes');
  E.libMeta.textContent = all.length ? all.length + ' ' + noun + ' · ' + fmtSize(size) : 'Nothing here yet';
  if (all.length && navigator.storage && navigator.storage.estimate) {
    const base = E.libMeta.textContent;
    navigator.storage.estimate().then(e => { if (e && e.quota && e.usage != null && S.libSection === section) E.libMeta.textContent = base + ' · about ' + fmtSize(Math.max(0, e.quota - e.usage)) + ' free'; }).catch(() => {});
  }
  const hasLabels = labelsOf(section).some(l => !l.builtin);
  E.libEmpty.hidden = all.length > 0 || hasLabels;
  E.libEmptyTitle.textContent = section === 'music' ? 'No music yet' : 'No podcasts yet';
  E.libEmptyText.textContent = section === 'music'
    ? 'Add audio files for focusing. Label them to group them, then arrange groups and tracks in your own order.'
    : 'Add episodes as audio files. Label them by series to group them, then arrange them in your own order.';
  const q = filterText.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  groupsOf(section, editing ? 'all' : true).forEach(g => {
    const node = groupNode(g, q);
    if (node) frag.appendChild(node);
  });
  E.groups.replaceChildren(frag);
  renderSelbar();
}
function itemMeta(it) {
  if (it.section !== 'podcast') return it.duration ? fmtTime(it.duration) : '–';
  if (it.played) return 'Played';
  if (it.position > 0 && it.duration) return fmtLeft(it.duration - it.position);
  return it.duration ? fmtTime(it.duration) : '–';
}
function isCurrent(it) { return it.section === 'music' ? (S.musicOn && it.id === S.focusId) : it.id === S.podId; }
function groupNode(g, q) {
  const { label, items } = g;
  const rows = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
  if (q && !rows.length) return null;
  const sec = h('section', 'group');
  sec.dataset.label = label.id;
  const isCollapsed = !editing && !q && collapsed.has(label.id);
  sec.classList.toggle('collapsed', isCollapsed);
  const head = h('div', 'group-head');
  const total = items.reduce((s, i) => s + (i.duration || 0), 0);
  const meta = h('span', 'g-meta', items.length + (total >= 60 ? ' · ' +(total >= 3600 ? (total / 3600).toFixed(1) + ' h' : Math.round(total / 60) + ' min') : ''));
  if (editing) {
    const handle = h('button', 'handle g-handle'); handle.type = 'button';
    handle.setAttribute('aria-label', 'Drag to move the group ' + label.name);
    handle.appendChild(svgUse('i-grip'));
    head.appendChild(handle);
    if (label.builtin) { const s = h('span', 'g-static'); s.appendChild(h('span', 'g-name builtin', 'Ungrouped')); head.appendChild(s); }
    else {
      const inp = h('input', 'g-input'); inp.type = 'text'; inp.value = label.name; inp.maxLength = 60;
      inp.setAttribute('aria-label', 'Label name'); inp.dataset.label = label.id;
      head.appendChild(inp);
    }
    head.appendChild(meta);
  } else {
    const tog = h('button', 'g-toggle'); tog.type = 'button';
    tog.setAttribute('aria-expanded', String(!isCollapsed));
    tog.appendChild(svgUse('i-chev', 'chev'));
    tog.appendChild(h('span', 'g-name' + (label.builtin ? ' builtin' : ''), label.name));
    tog.appendChild(meta);
    head.appendChild(tog);
  }
  const add = h('button', 'icon-btn g-add'); add.type = 'button';
  add.setAttribute('aria-label', 'Add files to ' + label.name);
  add.title = 'Add files to ' + label.name;
  add.appendChild(svgUse('i-plus'));
  head.appendChild(add);
  if (editing && !label.builtin) {
    const del = h('button', 'icon-btn g-del'); del.type = 'button';
    del.setAttribute('aria-label', 'Delete the label ' + label.name);
    del.appendChild(svgUse('i-trash'));
    head.appendChild(del);
  }
  sec.appendChild(head);
  const ul = h('ul', 'items');
  rows.forEach((it, i) => ul.appendChild(rowNode(it, i)));
  if (!rows.length) ul.appendChild(h('li', 'row-empty', label.builtin ? 'Files without a label appear here.' : (editing ? 'Drag files here, or use +.' : 'Nothing with this label yet.')));
  sec.appendChild(ul);
  return sec;
}
function rowNode(it, i) {
  const li = h('li', 'row');
  li.dataset.id = it.id;
  const cur = isCurrent(it);
  li.classList.toggle('current', cur);
  li.classList.toggle('played', !!it.played);
  li.classList.toggle('selected', selected.has(it.id));
  if (editing) {
    const handle = h('button', 'handle r-handle'); handle.type = 'button';
    handle.setAttribute('aria-label', 'Drag to move ' + it.name);
    handle.appendChild(svgUse('i-grip'));
    li.appendChild(handle);
  }
  const main = h('button', 'row-main'); main.type = 'button';
  main.setAttribute('aria-label', editing ? (selected.has(it.id) ? 'Deselect ' : 'Select ') + it.name : 'Play ' + it.name);
  if (editing) { const c = h('span', 'check'); c.appendChild(svgUse('i-check')); main.appendChild(c); }
  else {
    const idx = h('span', 'r-idx');
    if (cur) { const eq = h('span', 'eq'); eq.setAttribute('aria-hidden', 'true'); eq.append(h('i'), h('i'), h('i')); idx.appendChild(eq); }
    else idx.textContent = String(i + 1);
    main.appendChild(idx);
  }
  main.append(h('span', 'r-name', it.name), h('span', 'r-meta', itemMeta(it)));
  li.appendChild(main);
  return li;
}
function setEditing(on) {
  editing = on;
  selected.clear();
  filterText = ''; E.filter.value = '';
  renderLibrary(); renderMini();
}
function setLibSection(section) {
  if (S.libSection === section) return;
  S.libSection = section; store.set('libSection', section);
  selected.clear(); filterText = ''; E.filter.value = '';
  renderLibrary();
}
let deleteArmed = false;
function renderSelbar() {
  const show = editing && selected.size > 0 && S.tab === 'library';
  E.selbar.hidden = !show;
  deleteArmed = false;
  E.selDelete.textContent = 'Delete';
  E.selDelete.classList.remove('danger');
  if (show) {
    E.selCount.textContent = selected.size + ' selected';
    E.selMove.textContent = S.libSection === 'music' ? 'Move to Podcasts' : 'Move to Music';
    E.selPlayed.hidden = S.libSection !== 'podcast';
    const allPlayed = [...selected].every(id => (lib.items.get(id) || {}).played);
    E.selPlayed.textContent = allPlayed ? 'Mark unplayed' : 'Mark played';
  }
  E.body.classList.toggle('has-float', show || !E.mini.hidden);
}
// Selected items in on-screen order (groups in order, items in order).
function selectedInOrder() {
  return groupsOf(S.libSection, 'all').flatMap(g => g.items).filter(i => selected.has(i.id));
}
function assignLabel(items, labelId) {
  let o = nextOrder(labelId);
  const changed = [];
  items.forEach(it => { if (it.labelId === labelId) return; it.labelId = labelId; it.order = o++; changed.push(it); });
  save(changed);
  fq.seqGroup = null;
  selected.clear();
  renderLibrary(); renderFocus(); renderPodcast(); refreshLoop(); updateMediaSession();
}
function moveToSection(items, to) {
  const target = UNGROUPED[to];
  let o = nextOrder(target);
  items.forEach(it => {
    if (loaded.id === it.id && playing) pauseAll();
    if (loaded.id === it.id) unload();
    it.section = to; it.labelId = target; it.order = o++;
    if (to === 'podcast') { it.position = 0; it.played = false; }
  });
  save(items);
  fq.seqGroup = null;
  selected.clear();
  toast((items.length === 1 ? 'Moved 1 file to ' : 'Moved ' + items.length + ' files to ') + (to === 'music' ? 'Music.' : 'Podcasts.'));
  renderLibrary(); renderFocus(); renderPodcast(); renderMini(); updateMediaSession();
}
function deleteSelected() {
  const items = selectedInOrder(), ids = items.map(i => i.id);
  if (!ids.length) return;
  // keep the focus session going on a track that stays
  const cur = focusTrack();
  let replacement = null;
  if (cur && ids.includes(cur.id)) {
    const group = itemsIn(cur.labelId), at = group.findIndex(i => i.id === cur.id);
    const rest = group.filter(i => !ids.includes(i.id));
    replacement = rest.length ? rest[Math.min(at, rest.length - 1)].id : null;
  }
  const losingFocus = cur && ids.includes(cur.id), losingPod = ids.includes(S.podId);
  if (losingPod) { if (owner === 'podcast' && playing) pausePodcast(); if (loaded.kind === 'episode') unload(); S.podId = null; store.set('podId', null); }
  (dbFailed ? Promise.resolve() : db.deleteItems(ids)).then(() => {
    ids.forEach(id => {
      lib.items.delete(id);
      const url = lib.urls.get(id);
      lib.urls.delete(id);
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
    if (losingFocus) {
      const target = replacement || firstMusicId();
      if (target) { setTrack(target); if (owner === 'focus' && playing && loaded.kind === 'track') safePlay(); }
      else {
        S.focusId = null; store.set('currentId', null);
        if (owner === 'focus' && loaded.kind === 'track') {
          if (playing && S.mode !== 'off') { loadSilence(); safePlay(); }
          else { if (playing) pauseFocus(); unload(); }
        }
      }
    }
    fq.seqGroup = null;
    selected.clear();
    toast(ids.length === 1 ? 'Deleted 1 file.' : 'Deleted ' + ids.length + ' files.');
    renderLibrary(); renderFocus(); renderPodcast(); renderMini(); updateMediaSession();
  }).catch(() => toast('Couldn’t delete. Reload the app and try again.'));
}
function deleteLabel(labelId) {
  const label = lib.labels.get(labelId);
  if (!label || label.builtin) return;
  const target = UNGROUPED[label.section];
  let o = nextOrder(target);
  const moved = itemsIn(labelId);
  moved.forEach(it => { it.labelId = target; it.order = o++; });
  save(moved);
  lib.labels.delete(labelId);
  collapsed.delete(labelId); store.set('collapsed', [...collapsed]);
  if (!dbFailed) db.deleteLabel(labelId).catch(saveFailed);
  fq.seqGroup = null;
  toast('Deleted the label “' + label.name + '”.' + (moved.length ? ' Its files moved to Ungrouped.' : ''));
  renderLibrary(); renderFocus(); renderPodcast(); refreshLoop();
}
function createLabel(name, section) {
  name = name.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const existing = labelsOf(section).find(l => l.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const ls = labelsOf(section);
  const label = { id: 'l' + uid(), name, section, order: ls.length ? ls[ls.length - 1].order + 1 : 0 };
  lib.labels.set(label.id, label);
  saveLabels(label);
  return label;
}

// Drag to reorder (edit mode)
function locateRow(under, x, y) {
  if (!E.groups.contains(under) || under.closest('.drag-ph')) return null;
  const row = under.closest('.row');
  if (row) { const r = row.getBoundingClientRect(); return { ref: row, after: y > r.top + r.height / 2 }; }
  const g = under.closest('.group');
  if (!g) return null;
  const list = $('.items', g);
  if (under.closest('.group-head')) return { parent: list, first: true };
  return { parent: list };
}
function locateGroup(under, x, y) {
  const g = under.closest('.group');
  if (!g || !E.groups.contains(g)) return null;
  const r = g.getBoundingClientRect();
  return { ref: g, after: y > r.top + r.height / 2 };
}
function commitRows() {
  const changed = [];
  $$('.group', E.groups).forEach(g => {
    const labelId = g.dataset.label;
    $$('.row', g).forEach((row, i) => {
      const it = lib.items.get(row.dataset.id);
      if (it && (it.labelId !== labelId || it.order !== i)) { it.labelId = labelId; it.order = i; changed.push(it); }
    });
  });
  save(changed);
  fq.seqGroup = null;
  renderLibrary(); renderFocus(); renderPodcast(); refreshLoop(); updateMediaSession();
}
function commitGroups() {
  E.groups.classList.remove('grouping');
  const changed = [];
  $$('.group', E.groups).forEach((g, i) => {
    const l = lib.labels.get(g.dataset.label);
    if (l && l.order !== i) { l.order = i; changed.push(l); }
  });
  saveLabels(changed);
  renderLibrary(); refreshLoop();
}

// Adding files
function isAudioFile(f) { return (f.type && f.type.indexOf('audio/') === 0) || /\.(mp3|m4a|aac|wav|flac|aif|aiff|ogg|opus|caf)$/i.test(f.name); }
function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff', ogg: 'audio/ogg', opus: 'audio/ogg', caf: 'audio/x-caf' })[ext] || 'audio/mpeg';
}
function probeDuration(file) {
  return new Promise(resolve => {
    const a = document.createElement('audio'), url = URL.createObjectURL(file);
    let done = false;
    const fin = v => { if (done) return; done = true; a.removeAttribute('src'); try { a.load(); } catch (e) {} URL.revokeObjectURL(url); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => fin(null);
    setTimeout(() => fin(0), 4000); // iPhone may not load metadata before playback; the duration fills in on first play
    a.src = url;
  });
}
function pickFiles(section, labelId) {
  addTarget = { section, labelId: lib.labels.has(labelId) ? labelId : UNGROUPED[section] };
  E.file.click();
}
async function addFiles(fileList, target) {
  const audio = Array.from(fileList || []).filter(isAudioFile);
  if (!audio.length) { showStatus('No audio files found in that selection.'); return; }
  if (S.tab !== 'library') setTab('library');
  setLibSection(target.section);
  const added = [], problems = [];
  for (let i = 0; i < audio.length; i++) {
    const f = audio[i];
    showStatus('Adding ' + (i + 1) + ' of ' + audio.length + ': ' + f.name);
    const dur = await probeDuration(f);
    if (dur === null) { problems.push(f.name + ': this browser can’t play that format. MP3 or M4A work everywhere.'); continue; }
    const item = { id: uid(), name: cleanName(f.name), type: f.type || guessType(f.name), size: f.size, duration: dur || 0, added: Date.now(), section: target.section, labelId: target.labelId, order: nextOrder(target.labelId), position: 0, played: false };
    try {
      if (!dbFailed) await db.addItem(item, f);
    } catch (err) {
      if (err && err.name === 'QuotaExceededError') { problems.push(f.name + ': storage on this device is full. Delete some files and try again.'); break; }
      problems.push(f.name + ': couldn’t be saved, so it plays only until you close the app.');
    }
    lib.items.set(item.id, item);
    lib.urls.set(item.id, URL.createObjectURL(f));
    added.push(item);
  }
  if (added.length && target.section === 'music' && !focusTrack()) setTrack(added[0].id);
  if (added.length && target.section === 'podcast' && !podItem()) { S.podId = added[0].id; store.set('podId', S.podId); }
  if (added.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  fq.seqGroup = null;
  refreshLoop();
  renderLibrary(); renderFocus(); renderPodcast(); renderMini(); updateMediaSession();
  const msg = added.length ? 'Added ' + added.length + (added.length === 1 ? ' file' : ' files') + ' to ' + labelName(target.labelId) + '.' : 'Nothing was added.';
  if (problems.length) showStatus(msg, problems); else { E.status.hidden = true; toast(msg); }
}

/* ---------- selector sheet (tap the title) ---------- */
let pickerSection = 'music';
function openPicker(section) {
  pickerSection = section;
  E.pickerFilter.value = '';
  renderPicker();
  try { E.picker.showModal(); } catch (e) { E.picker.setAttribute('open', ''); }
  renderMini();
  const cur = $('.pick-row.current', E.pickerBody);
  if (cur) cur.scrollIntoView({ block: 'center' });
}
function closePicker() { if (E.picker.open) E.picker.close(); }
E.picker.addEventListener('close', renderMini);
function renderPicker() {
  const section = pickerSection, q = E.pickerFilter.value.trim().toLowerCase();
  E.pickerTitle.textContent = section === 'music' ? 'Music' : 'Podcasts';
  const groups = groupsOf(section, false);
  E.pickerFilter.parentNode.hidden = itemsOf(section).length < 8;
  const frag = document.createDocumentFragment();
  groups.forEach(g => {
    const rows = q ? g.items.filter(i => i.name.toLowerCase().includes(q)) : g.items;
    if (!rows.length) return;
    const box = h('div', 'sheet-group');
    box.appendChild(h('h4', '', g.label.name));
    const ul = h('ul');
    rows.forEach((it, i) => {
      const li = h('li', 'pick-row');
      li.dataset.id = it.id;
      const cur = isCurrent(it);
      li.classList.toggle('current', cur);
      li.classList.toggle('played', !!it.played);
      const b = h('button', 'pick-main'); b.type = 'button';
      const idx = h('span', 'r-idx');
      if (cur) { const eq = h('span', 'eq'); eq.setAttribute('aria-hidden', 'true'); eq.append(h('i'), h('i'), h('i')); idx.appendChild(eq); }
      else idx.textContent = String(i + 1);
      b.append(idx, h('span', 'r-name', it.name), h('span', 'r-meta', itemMeta(it)));
      li.appendChild(b);
      if (section === 'podcast') {
        const p = h('button', 'played-btn'); p.type = 'button';
        p.setAttribute('aria-pressed', String(!!it.played));
        p.setAttribute('aria-label', it.played ? 'Mark ' + it.name + ' as unplayed' : 'Mark ' + it.name + ' as played');
        p.title = it.played ? 'Played' : 'Mark as played';
        p.appendChild(svgUse('i-played'));
        li.appendChild(p);
      }
      ul.appendChild(li);
    });
    box.appendChild(ul);
    frag.appendChild(box);
  });
  if (!frag.childNodes.length) {
    const empty = h('div', 'sheet-empty');
    const has = itemsOf(section).length > 0;
    empty.appendChild(h('span', '', has ? 'Nothing matches that filter.' : (section === 'music' ? 'No music in your library yet.' : 'No podcasts in your library yet.')));
    if (!has) {
      const b = h('button', 'btn primary', section === 'music' ? 'Add music' : 'Add episodes'); b.type = 'button';
      b.dataset.addSection = section;
      empty.appendChild(b);
    }
    frag.appendChild(empty);
  }
  E.pickerBody.replaceChildren(frag);
}
E.pickerBody.addEventListener('click', e => {
  const add = e.target.closest('[data-add-section]');
  if (add) { closePicker(); setTab('library'); setLibSection(add.dataset.addSection); pickFiles(add.dataset.addSection); return; }
  const row = e.target.closest('.pick-row');
  if (!row) return;
  const it = lib.items.get(row.dataset.id);
  if (!it) return;
  if (e.target.closest('.played-btn')) { setPlayed([it.id], !it.played); return; }
  closePicker();
  if (it.section === 'music') { if (!(owner === 'focus' && playing && S.musicOn && it.id === S.focusId)) playMusicItem(it.id); }
  else if (!(owner === 'podcast' && playing && it.id === S.podId)) playPodcast(it.id);
});
E.pickerFilter.addEventListener('input', renderPicker);
E.pickerDone.addEventListener('click', closePicker);
E.picker.addEventListener('click', e => { if (e.target === E.picker) closePicker(); });

/* ---------- label dialog ---------- */
let labelMode = 'create';
function openLabelDialog(mode) {
  labelMode = mode;
  const n = selected.size;
  E.labelTitle.textContent = mode === 'assign' ? 'Label ' + n + (n === 1 ? ' file' : ' files') : 'New label';
  E.labelList.hidden = mode !== 'assign';
  E.labelList.replaceChildren();
  if (mode === 'assign') {
    labelsOf(S.libSection).forEach(l => {
      const li = h('li'), b = h('button'); b.type = 'button'; b.dataset.label = l.id;
      b.append(h('span', '', l.name), h('span', 'muted', String(itemsIn(l.id).length)));
      li.appendChild(b);
      E.labelList.appendChild(li);
    });
  }
  E.labelCreate.textContent = mode === 'assign' ? 'Create and apply' : 'Create';
  E.labelName.value = '';
  try { E.labelDlg.showModal(); } catch (e) { E.labelDlg.setAttribute('open', ''); }
  if (mode === 'create') E.labelName.focus();
}
E.labelList.addEventListener('click', e => {
  const b = e.target.closest('button[data-label]');
  if (!b) return;
  assignLabel(selectedInOrder(), b.dataset.label);
  E.labelDlg.close();
});
E.labelForm.addEventListener('submit', e => {
  e.preventDefault();
  const label = createLabel(E.labelName.value, S.libSection);
  if (!label) { toast('Type a name for the label.'); return; }
  if (labelMode === 'assign') assignLabel(selectedInOrder(), label.id);
  else { toast('Created the label “' + label.name + '”.'); renderLibrary(); }
  E.labelDlg.close();
});
E.labelCancel.addEventListener('click', () => E.labelDlg.close());
E.labelDlg.addEventListener('click', e => { if (e.target === E.labelDlg) E.labelDlg.close(); });

/* ---------- events: focus ---------- */
E.play.addEventListener('click', () => { if (owner === 'focus' && playing) pauseFocus(); else playFocus(); });
E.next.addEventListener('click', nextTrack);
E.prev.addEventListener('click', prevTrack);
E.focusPick.addEventListener('click', () => openPicker('music'));
E.shuffle.addEventListener('click', () => {
  S.shuffle = !S.shuffle; store.set('shuffle', S.shuffle);
  fq.seqGroup = null;
  refreshLoop(); renderFocus();
});
E.end.addEventListener('click', () => {
  S.endMode = END_MODES[(END_MODES.indexOf(S.endMode) + 1) % END_MODES.length];
  store.set('endMode', S.endMode);
  refreshLoop(); renderFocus();
  toast(END_TOAST[S.endMode]);
});
E.source.addEventListener('click', e => { const b = e.target.closest('button[data-source]'); if (b) setMusicOn(b.dataset.source === 'music'); });
E.seek.addEventListener('input', () => {
  seekingF = true; setFill(E.seek);
  const d = el.duration;
  if (isFinite(d)) E.tCur.textContent = fmtTime(E.seek.value / 1000 * d);
});
E.seek.addEventListener('change', () => {
  const d = el.duration;
  if (loaded.kind === 'track' && isFinite(d)) { el.currentTime = E.seek.value / 1000 * d; updatePosition(); }
  seekingF = false;
});
E.volMusic.addEventListener('input', () => {
  S.volMusic = num(E.volMusic.value, 80); store.set('volMusic', S.volMusic);
  E.outMusic.textContent = S.volMusic; setFill(E.volMusic);
  applyVolume();
});
E.volTone.addEventListener('input', () => {
  S.toneLevel = num(E.volTone.value, 59); store.set('toneLevel', S.toneLevel);
  E.outTone.textContent = S.toneLevel; setFill(E.volTone);
  tone.setLevel(S.toneLevel);
  renderFocus(); renderMini();
});
E.volTone.addEventListener('change', updateMediaSession);

/* ---------- events: tone ---------- */
function toneChanged(restartFromOff) {
  renderTone(); renderFocus(); renderMini();
  if (owner === 'focus') {
    if (S.mode === 'off') { tone.stop(); if (playing && !musicActive()) pauseFocus(); }
    else if (playing) { if (restartFromOff || !tone.isOn()) tone.start(ftimer.fading ? ftimer.remaining : null); else tone.retune(); }
  }
}
E.mode.addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  const wasOff = S.mode === 'off';
  S.mode = b.dataset.mode; store.set('mode', S.mode);
  toneChanged(wasOff);
  updateMediaSession();
});
E.mode.addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const keys = Object.keys(MODES);
  let i = keys.indexOf(S.mode);
  i = (i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length;
  const btn = E.mode.querySelector('[data-mode="' + keys[i] + '"]');
  btn.focus(); btn.click(); e.preventDefault();
});
E.bands.addEventListener('click', e => {
  const b = e.target.closest('.band');
  if (!b) return;
  S.beat = num(b.dataset.preset, 10); store.set('beat', S.beat);
  const wasOff = S.mode === 'off';
  if (wasOff) { S.mode = 'isochronic'; store.set('mode', S.mode); }
  toneChanged(wasOff);
  updateMediaSession();
});
E.beat.addEventListener('input', () => {
  S.beat = Math.round(num(E.beat.value, 10) * 2) / 2; store.set('beat', S.beat);
  renderTone(); renderFocus();
  tone.retune();
});
E.beat.addEventListener('change', updateMediaSession);
E.carrier.addEventListener('input', () => {
  S.carrier = Math.round(num(E.carrier.value, DEFAULT_CARRIER)); store.set('carrier', S.carrier);
  renderTone();
  tone.retune();
});
E.carrierReset.addEventListener('click', () => { S.carrier = DEFAULT_CARRIER; store.set('carrier', S.carrier); renderTone(); tone.retune(); });
E.pulse.addEventListener('click', e => {
  const b = e.target.closest('button[data-pulse]');
  if (!b) return;
  S.pulse = b.dataset.pulse; store.set('pulse', S.pulse);
  renderTone(); tone.retune();
});

/* ---------- events: podcasts ---------- */
E.podPlay.addEventListener('click', () => { if (owner === 'podcast' && playing) pausePodcast(); else playPodcast(); });
E.podBack.addEventListener('click', () => skip(-SKIP_BACK));
E.podFwd.addEventListener('click', () => skip(SKIP_FWD));
E.podPick.addEventListener('click', () => openPicker('podcast'));
E.podPlayed.addEventListener('click', () => { const it = podItem(); if (it) setPlayed([it.id], !it.played); });
E.speed.addEventListener('click', e => { const b = e.target.closest('button[data-speed]'); if (b) setSpeed(num(b.dataset.speed, 1)); });
E.podSeek.addEventListener('input', () => {
  seekingP = true; setFill(E.podSeek);
  const { dur } = podTimes(podItem());
  if (dur) E.podCur.textContent = fmtTime(E.podSeek.value / 1000 * dur);
});
E.podSeek.addEventListener('change', () => {
  const { dur } = podTimes(podItem());
  if (dur) seekPodcast(E.podSeek.value / 1000 * dur);
  seekingP = false;
});
E.volPod.addEventListener('input', () => {
  S.volPod = num(E.volPod.value, 90); store.set('volPod', S.volPod);
  E.outPod.textContent = S.volPod; setFill(E.volPod);
  applyVolume();
});

/* ---------- events: shell ---------- */
E.dock.addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
E.miniPlay.addEventListener('click', togglePlay);
E.miniNext.addEventListener('click', nextTrack);
E.miniFwd.addEventListener('click', () => skip(SKIP_FWD));
E.miniOpen.addEventListener('click', () => setTab(tabOf(owner)));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-add-section]');
  if (!b || E.picker.contains(b)) return;
  const section = b.dataset.addSection;
  setTab('library'); setLibSection(section); pickFiles(section);
});
document.addEventListener('keydown', e => {
  if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (E.picker.open || E.labelDlg.open) return;
  if (t && t.closest && t.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  e.preventDefault();
  togglePlay();
});

/* ---------- events: library ---------- */
E.libSection.addEventListener('click', e => { const b = e.target.closest('button[data-section]'); if (b) setLibSection(b.dataset.section); });
E.libEdit.addEventListener('click', () => setEditing(!editing));
E.libAdd.addEventListener('click', () => pickFiles(S.libSection));
E.libEmptyAdd.addEventListener('click', () => pickFiles(S.libSection));
E.newLabel.addEventListener('click', () => openLabelDialog('create'));
E.filter.addEventListener('input', () => { filterText = E.filter.value; renderLibrary(); });
E.file.addEventListener('change', () => {
  const files = E.file.files, target = addTarget || { section: S.libSection, labelId: UNGROUPED[S.libSection] };
  addFiles(files, target).finally(() => { E.file.value = ''; addTarget = null; });
});
E.groups.addEventListener('click', e => {
  const tog = e.target.closest('.g-toggle');
  if (tog) {
    const id = tog.closest('.group').dataset.label;
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    store.set('collapsed', [...collapsed]);
    renderLibrary();
    return;
  }
  const add = e.target.closest('.g-add');
  if (add) { pickFiles(S.libSection, add.closest('.group').dataset.label); return; }
  const del = e.target.closest('.g-del');
  if (del) {
    const id = del.closest('.group').dataset.label;
    if (del.classList.contains('confirming')) { deleteLabel(id); return; }
    del.classList.add('confirming');
    del.replaceChildren(document.createTextNode('Delete label'));
    setTimeout(() => { if (del.isConnected) { del.classList.remove('confirming'); del.replaceChildren(svgUse('i-trash')); } }, 3500);
    return;
  }
  const main = e.target.closest('.row-main');
  if (!main) return;
  const id = main.closest('.row').dataset.id, it = lib.items.get(id);
  if (!it) return;
  if (editing) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    const row = main.closest('.row');
    row.classList.toggle('selected', selected.has(id));
    main.setAttribute('aria-label', (selected.has(id) ? 'Deselect ' : 'Select ') + it.name);
    renderSelbar(); renderMini();
    return;
  }
  if (it.section === 'music') playMusicItem(id); else playPodItem(id);
});
E.groups.addEventListener('change', e => {
  const inp = e.target.closest('.g-input');
  if (!inp) return;
  const l = lib.labels.get(inp.dataset.label);
  const name = inp.value.trim().replace(/\s+/g, ' ');
  if (!l) return;
  if (!name) { inp.value = l.name; return; }
  if (name !== l.name) { l.name = name; saveLabels(l); renderFocus(); renderPodcast(); updateMediaSession(); }
});
E.groups.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('g-input') && libDirty) setTimeout(renderLibrary, 0); });
E.groups.addEventListener('pointerdown', e => {
  if (!editing || e.button > 0) return;
  const rh = e.target.closest('.r-handle'), gh = e.target.closest('.g-handle');
  if (rh) beginDrag(e, rh.closest('.row'), { anchor: rh, locate: locateRow, onDrop: commitRows, onCancel: renderLibrary });
  else if (gh) beginDrag(e, gh.closest('.group'), { anchor: gh, onStart: () => E.groups.classList.add('grouping'), locate: locateGroup, onDrop: commitGroups, onCancel: () => { E.groups.classList.remove('grouping'); renderLibrary(); } });
});
E.selLabel.addEventListener('click', () => openLabelDialog('assign'));
E.selMove.addEventListener('click', () => moveToSection(selectedInOrder(), S.libSection === 'music' ? 'podcast' : 'music'));
E.selPlayed.addEventListener('click', () => {
  const items = selectedInOrder(), all = items.every(i => i.played);
  setPlayed(items.map(i => i.id), !all);
  selected.clear(); renderLibrary();
});
E.selDelete.addEventListener('click', () => {
  if (!deleteArmed) {
    deleteArmed = true;
    E.selDelete.textContent = 'Delete ' + selected.size + '?';
    E.selDelete.classList.add('danger');
    return;
  }
  deleteSelected();
});

// Drop files from Finder onto the library or onto a group
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; E.drop.classList.add('over'); });
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  $$('.group.drop-target').forEach(g => g.classList.remove('drop-target'));
  const g = e.target.closest && e.target.closest('.group');
  if (g) g.classList.add('drop-target');
});
document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { E.drop.classList.remove('over'); $$('.group.drop-target').forEach(g => g.classList.remove('drop-target')); } });
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; E.drop.classList.remove('over');
  $$('.group.drop-target').forEach(g => g.classList.remove('drop-target'));
  const g = S.tab === 'library' && e.target.closest ? e.target.closest('.group') : null;
  const section = S.tab === 'podcasts' ? 'podcast' : (S.tab === 'focus' ? 'music' : S.libSection);
  addFiles(e.dataTransfer.files, { section, labelId: g ? g.dataset.label : UNGROUPED[section] });
});

/* ---------- lifecycle ---------- */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { savePodPosition(true); return; }
  if (owner === 'focus' && playing) tone.resumeIfNeeded(); // after a call or Siri
  if (playing && el.paused && !switching) pauseAll(); // the player was stopped while the app was away
  ftimer.tick(); stimer.tick(); ftimer.render(); stimer.render();
  if (S.tab === 'focus') sizeScope();
  startScope();
  if (libDirty) renderLibrarySoon();
});
window.addEventListener('pagehide', () => savePodPosition(true));
function onThemeChange() { readColors(); drawScope(); }
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', onThemeChange); else if (mq.addListener) mq.addListener(onThemeChange);
}
if (window.ResizeObserver) new ResizeObserver(() => sizeScope()).observe(E.scope);
else window.addEventListener('resize', sizeScope);

/* ---------- start ---------- */
async function loadLibrary() {
  let data;
  try {
    data = await db.loadAll();
  } catch (e) {
    dbFailed = true;
    showStatus(e && e.name === 'BlockedError'
      ? 'Another Focus Player window is still open with the previous version. Close it, then reload this one to finish updating your library.'
      : 'This browser blocked storage for this app, so added files play only until you close it. The tone generator works normally.');
    data = { files: [], items: [], labels: [] };
  }
  const newLabels = [];
  data.labels.forEach(l => lib.labels.set(l.id, l));
  ['music', 'podcast'].forEach(sec => {
    if (!lib.labels.has(UNGROUPED[sec])) {
      const l = { id: UNGROUPED[sec], name: 'Ungrouped', section: sec, order: -1, builtin: true };
      lib.labels.set(l.id, l);
      newLabels.push(l);
    }
  });
  data.items.forEach(it => lib.items.set(it.id, it));
  // Files from the previous version have no metadata record yet: they become Music, Ungrouped, in A–Z order.
  const legacy = [];
  data.files.forEach(f => {
    const blob = f.blob instanceof Blob ? f.blob : (f.blob ? new Blob([f.blob], { type: f.type || 'audio/mpeg' }) : null);
    if (!blob) return;
    lib.urls.set(f.id, URL.createObjectURL(blob));
    if (!lib.items.has(f.id)) legacy.push({ id: f.id, name: f.name || 'Untitled', type: f.type || 'audio/mpeg', size: f.size || blob.size || 0, duration: f.duration || 0, added: f.added || Date.now(), section: 'music', labelId: UNGROUPED.music, order: 0, position: 0, played: false });
  });
  legacy.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  let o = nextOrder(UNGROUPED.music);
  legacy.forEach(it => { it.order = o++; lib.items.set(it.id, it); });
  const fixed = [];
  [...lib.items.values()].forEach(it => {
    if (!lib.urls.has(it.id)) { lib.items.delete(it.id); return; } // metadata without a file
    if (it.section !== 'music' && it.section !== 'podcast') { it.section = 'music'; fixed.push(it); }
    if (!lib.labels.has(it.labelId) || lib.labels.get(it.labelId).section !== it.section) { it.labelId = UNGROUPED[it.section]; it.order = nextOrder(it.labelId); fixed.push(it); }
  });
  saveLabels(newLabels);
  save(legacy.concat(fixed));
}
async function init() {
  readColors();
  buildBands();
  renderVolumes(); renderTone(); renderFocus(); renderPodcast(); ftimer.render(); stimer.render();
  setupMediaSession();
  setTab(location.hash === '#library' ? 'library' : location.hash === '#podcasts' ? 'podcasts' : S.tab);
  E.libFoot.textContent = standalone
    ? 'Files are stored in this app on this device. Keep your originals as a backup.'
    : 'Files are stored in this browser on this device. Safari can clear a website’s data after several weeks without use; apps added to the Home Screen aren’t affected. Keep your originals as a backup.';
  if (standalone && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await loadLibrary();
  if (!focusTrack() && S.focusId) S.focusId = null;
  if (!focusTrack()) { const f = firstMusicId(); if (f) { S.focusId = f; store.set('currentId', f); } }
  if (!podItem()) S.podId = null;
  if (owner === 'focus' && S.musicOn && focusTrack()) loadTrack(S.focusId);
  else if (owner === 'podcast' && podItem()) loadEpisode(S.podId);
  applyVolume();
  renderFocus(); renderPodcast(); renderPlayState(); renderLibrary(); updateMediaSession();
}
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
