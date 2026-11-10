import { SHOTS, SHARP_FLOOR, VIEW_ASPECT, CHECKS_FOR } from './shots.js';
import { STR } from './i18n.js';
import { loadDetector, detect, measure, resetMotion } from './vision.js';

const HOLD_MS = 1000;          // how long a shot must stay right before the photo is taken
const TICK_MS = 90;            // analyse about 11 frames a second
const ANYWAY_AFTER_MS = 12000; // offer "Take anyway" after 12 s on one shot
const RING = 226.2;            // circumference of the shutter ring (r = 36)

// Steady: a hand-held phone always trembles a little; only real movement (walking, swinging) counts.
const MOTION_MAX = 22;         // smoothed average pixel change between analysed frames
const GYRO_MAX = 45;           // smoothed phone rotation, degrees per second
// Sharp: judged against the sharpest frame of the last few seconds, so it adapts to each phone and scene.
const SHARP_REL = 0.5;         // a frame must be at least half as sharp as the recent best
const BEST_DECAY = 0.97;       // the recent best fades by 3% per analysed frame (about 2 s half-life)

const REVIEW_MS = 1800;        // the review moves on by itself after this (matches the CSS animation)

// SF Symbols-style icons used in lists and the review bar
const ICON = {
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.6 12.4l3 3 5.8-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.6 13a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3z" fill="currentColor"/><path d="M12 9.5v4.2M12 16.6v.1" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.4-2h5.8l1.4 2h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
};

const $ = (s) => document.querySelector(s);
const el = {
  start: $('#screen-start'), capture: $('#screen-capture'), done: $('#screen-done'),
  btnStart: $('#btn-start'), videoFile: $('#video-file'), startStatus: $('#start-status'),
  stage: $('#stage'), video: $('#cam'), img: $('#test-img'), overlay: $('#overlay'), flash: $('#flash'),
  shotCount: $('#shot-count'), shotName: $('#shot-name'), shotTip: $('#shot-tip'),
  instruction: $('#instruction'), instructionText: $('#instruction-text'), hint: $('#hint'),
  aiPanel: $('#ai-panel'), checks: $('#checks'), hud: $('#hud'),
  miniMap: $('#mini-map'), shutter: $('#btn-shutter'), ring: $('#ring'),
  thumbBtn: $('#btn-thumb'), lastThumb: $('#last-thumb'),
  btnAnyway: $('#btn-anyway'), btnSkip: $('#btn-skip'), btnAi: $('#btn-aiview'), btnTorch: $('#btn-torch'),
  btnClose: $('#btn-close'), btnVoice: $('#btn-voice'), btnShots: $('#btn-shotlist'),
  review: $('#review'), reviewImg: $('#review-img'), reviewTitle: $('#review-title'), reviewMeta: $('#review-meta'),
  reviewCount: $('#review-count'), btnRetake: $('#btn-retake'), btnNext: $('#btn-next'),
  sheet: $('#shot-sheet'), sheetList: $('#sheet-list'), btnSheetClose: $('#btn-sheet-close'),
  doneIcon: $('#done-icon'), doneTitle: $('#done-title'), doneSub: $('#done-sub'), reportList: $('#report-list'),
  btnSend: $('#btn-send'), btnAgain: $('#btn-again'), toast: $('#toast'),
};
const octx = el.overlay.getContext('2d');

const state = {
  lang: initialLang(),
  voice: true,
  aiView: false,
  idx: 0,
  captures: {},            // shot id -> { url, verified, score, chips, at }
  startedAt: 0,
  sourceKind: null,        // 'camera' | 'file' | 'image'
  stream: null,
  running: false,
  paused: false,
  returnToDone: false,
};

// Per-shot live state
let live = resetLive();
function resetLive() {
  return {
    box: null, lastSeen: 0, dets: [], m: null, ev: null,
    hold: 0, lastTick: 0, shotStart: performance.now(),
    pendingInstr: null, pendingSince: 0, shownInstr: null,
    lastSpokeAt: 0, lastSpokenKey: null, capturing: false,
    frames: 0, fpsAt: performance.now(), fps: 0, checksSig: '',
    motionEma: 0, bestLap: 0,
  };
}

const t = (k) => STR[state.lang][k];
const sensors = { available: false, tilt: 0, roll: 0, rot: 0, rotAvailable: false, physLandscape: null };
let audioCtx = null;
let wakeLock = null;
let reviewTimer = null;
let toastTimer = null;

// ---------------------------------------------------------------- language

function initialLang() {
  try {
    const saved = localStorage.getItem('kadr-lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

function applyLang() {
  const s = STR[state.lang];
  document.documentElement.lang = state.lang;
  document.documentElement.dir = s.dir;
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = s[n.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-label]').forEach((n) => { n.setAttribute('aria-label', s[n.dataset.i18nLabel]); });
  document.querySelectorAll('.js-lang').forEach((b) => { b.textContent = s.switchTo; });
  if (!el.capture.hidden) { renderShotHeader(); live.checksSig = ''; showInstruction(live.shownInstr || 'search', true); }
  if (!el.done.hidden) renderDone();
  if (!el.sheet.hidden) renderSheet();
}

function toggleLang() {
  state.lang = state.lang === 'ar' ? 'en' : 'ar';
  try { localStorage.setItem('kadr-lang', state.lang); } catch { /* ignore */ }
  speechSynthesis?.cancel?.();
  applyLang();
}

// ---------------------------------------------------------------- top-view map

function renderMap(svg, { current = -1 } = {}) {
  const p = [];
  p.push('<g>');
  p.push('<rect class="body" x="56" y="50" width="48" height="100" rx="15"/>');
  p.push('<path class="glass" d="M61 84 Q80 75 99 84"/>');
  p.push('<path class="glass" d="M63 128 Q80 135 97 128"/>');
  for (const [x, y] of [[51, 63], [103, 63], [51, 119], [103, 119]]) p.push(`<rect class="wheel" x="${x}" y="${y}" width="6" height="18" rx="2"/>`);
  p.push('<rect class="lamp" x="61" y="52" width="10" height="4" rx="2"/><rect class="lamp" x="89" y="52" width="10" height="4" rx="2"/>');
  p.push('<rect class="tail" x="61" y="144" width="10" height="3.5" rx="1.75"/><rect class="tail" x="89" y="144" width="10" height="3.5" rx="1.75"/>');
  p.push('</g>');

  SHOTS.forEach((s, i) => {
    const [x, y] = s.spot;
    const done = !!state.captures[s.id];
    const cur = i === current;
    if (cur) {
      p.push(`<line class="aim" x1="${x}" y1="${y}" x2="${s.aim[0]}" y2="${s.aim[1]}"/>`);
      p.push(`<circle class="pulse" cx="${x}" cy="${y}" r="9"/>`);
    }
    p.push(`<circle class="spot${done ? ' done' : ''}${cur ? ' cur' : ''}" cx="${x}" cy="${y}" r="${cur ? 10 : 7}"/>`);
    if (done && !cur) p.push(`<path class="tick" d="M${x - 3.5} ${y} l2.4 2.6 l4.6 -5"/>`);
  });
  svg.innerHTML = p.join('');
}

// ---------------------------------------------------------------- start

el.btnStart.addEventListener('click', async () => {
  // These three must run inside the tap itself (iPhone rules).
  askMotionPermission();
  unlockAudio();
  unlockSpeech();
  setStatus(t('loading'));
  el.btnStart.disabled = true;
  try {
    if (!window.isSecureContext) throw codeError('https');
    if (!navigator.mediaDevices?.getUserMedia) throw codeError('none');
    const [stream] = await Promise.all([openCamera(), loadDetector().catch(() => { throw codeError('model'); })]);
    useStream(stream);
    setStatus('');
    enterCapture(0);
  } catch (err) {
    console.error(err);
    const map = { https: 'needHttps', none: 'cameraNone', denied: 'cameraDenied', model: 'modelFail' };
    setStatus(t(map[err.code] || 'cameraNone'), true);
  } finally {
    el.btnStart.disabled = false;
  }
});

el.videoFile.addEventListener('change', async () => {
  const file = el.videoFile.files?.[0];
  if (!file) return;
  unlockAudio();
  unlockSpeech();
  setStatus(t('loading'));
  try {
    await loadDetector().catch(() => { throw codeError('model'); });
    stopStream();
    state.sourceKind = 'file';
    el.img.hidden = true;
    el.video.hidden = false;
    el.video.srcObject = null;
    if (el.video.src) URL.revokeObjectURL(el.video.src);
    el.video.src = URL.createObjectURL(file);
    el.video.loop = true;
    el.video.muted = true;
    await el.video.play().catch(() => { throw codeError('video'); });
    setStatus('');
    enterCapture(0);
  } catch (err) {
    console.error(err);
    setStatus(t(err.code === 'model' ? 'modelFail' : 'videoFail'), true);
  } finally {
    el.videoFile.value = '';
  }
});

function setStatus(msg, isError = false) {
  el.startStatus.textContent = msg;
  el.startStatus.classList.toggle('error', isError);
}

function codeError(code) { const e = new Error(code); e.code = code; return e; }

async function openCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw codeError('denied');
    throw codeError('none');
  }
}

function useStream(stream) {
  stopStream();
  state.stream = stream;
  state.sourceKind = 'camera';
  el.img.hidden = true;
  el.video.hidden = false;
  if (el.video.src) { URL.revokeObjectURL(el.video.src); el.video.removeAttribute('src'); }
  el.video.loop = false;
  el.video.srcObject = stream;
  el.video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch { /* not supported */ }
  const caps = track.getCapabilities?.() || {};
  el.btnTorch.hidden = !caps.torch;
  el.btnTorch.setAttribute('aria-pressed', 'false');
}

function stopStream() {
  state.stream?.getTracks().forEach((tr) => tr.stop());
  state.stream = null;
  el.btnTorch.hidden = true;
}

async function resumeSource() {
  if (state.sourceKind === 'camera' && (!state.stream || state.stream.getVideoTracks()[0]?.readyState === 'ended')) {
    useStream(await openCamera());
  } else if (state.sourceKind === 'file') {
    el.video.play().catch(() => {});
  }
}

// ---------------------------------------------------------------- sensors, sound, voice

function askMotionPermission() {
  const listen = () => window.addEventListener('devicemotion', onMotion);
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === 'function') {
    DME.requestPermission().then((r) => { if (r === 'granted') listen(); }).catch(() => {});
  } else if (DME) {
    listen();
  }
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  const g = Math.hypot(a.x, a.y, a.z);
  if (g < 4) return;
  sensors.available = true;
  // tilt: how far the phone leans back or forward from upright (0 = upright, 90 = flat)
  const tilt = (Math.asin(Math.min(1, Math.abs(a.z) / g)) * 180) / Math.PI;
  // roll: how far the picture is twisted from level, whichever way the phone is held
  const ang = (Math.atan2(a.x, a.y) * 180) / Math.PI;
  const d = ((ang % 90) + 90) % 90;
  const roll = Math.min(d, 90 - d);
  sensors.tilt += (tilt - sensors.tilt) * 0.3;
  sensors.roll += (roll - sensors.roll) * 0.3;
  if (Math.abs(a.x) > Math.abs(a.y) * 1.3) sensors.physLandscape = true;
  else if (Math.abs(a.y) > Math.abs(a.x) * 1.3) sensors.physLandscape = false;
  // rotation speed (gyroscope), degrees per second
  const r = e.rotationRate;
  if (r && r.alpha != null && r.beta != null && r.gamma != null) {
    sensors.rotAvailable = true;
    sensors.rot += (Math.hypot(r.alpha, r.beta, r.gamma) - sensors.rot) * 0.25;
  }
}

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch { audioCtx = null; }
}

function shutterSound() {
  if (!audioCtx || !state.voice) return;
  const len = Math.floor(audioCtx.sampleRate * 0.07);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.35;
  src.buffer = buf;
  src.connect(gain).connect(audioCtx.destination);
  src.start();
}

let voices = [];
function loadVoices() { voices = window.speechSynthesis?.getVoices?.() || []; }
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

function unlockSpeech() {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

function pickVoice() {
  const prefs = state.lang === 'ar' ? ['ar-sa', 'ar-jo', 'ar-ae', 'ar'] : ['en-gb', 'en-us', 'en'];
  for (const p of prefs) {
    const v = voices.find((x) => x.lang.replace('_', '-').toLowerCase().startsWith(p));
    if (v) return v;
  }
  return null;
}

function speak(text) {
  if (!state.voice || !('speechSynthesis' in window)) return;
  const v = pickVoice();
  if (!v) return; // never read Arabic with an English voice
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v;
  u.lang = v.lang;
  u.rate = state.lang === 'ar' ? 0.95 : 1.02;
  speechSynthesis.speak(u);
}

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running) keepAwake();
});

// ---------------------------------------------------------------- capture screen

function enterCapture(i) {
  el.start.hidden = true;
  el.done.hidden = true;
  el.capture.hidden = false;
  if (!state.startedAt) state.startedAt = Date.now();
  state.running = true;
  state.paused = false;
  keepAwake();
  goTo(i);
  requestAnimationFrame(loop);
}

function goTo(i) {
  state.idx = i;
  live = resetLive();
  resetMotion();
  el.review.hidden = true;
  el.btnAnyway.hidden = true;
  el.shutter.classList.remove('ready');
  el.ring.style.strokeDashoffset = RING;
  renderShotHeader();
  showInstruction('search', true);
  const s = SHOTS[i];
  speak(`${s.name[state.lang]}. ${s.tip[state.lang]}`);
  live.lastSpokeAt = performance.now() + 1500; // give the intro time before the first correction
}

function renderShotHeader() {
  const s = SHOTS[state.idx];
  el.shotName.textContent = s.name[state.lang];
  el.shotCount.textContent = STR[state.lang].counter(state.idx + 1, SHOTS.length);
  el.shotTip.textContent = s.tip[state.lang];
  renderMap(el.miniMap, { current: state.idx });
  // Latest photo in the corner, like the iPhone Camera
  const last = Object.values(state.captures).sort((a, b) => b.at - a.at)[0];
  el.lastThumb.hidden = !last;
  if (last) el.lastThumb.src = last.url;
}

function currentSource() {
  if (state.sourceKind === 'image') {
    const im = el.img;
    if (!im.complete || !im.naturalWidth) return null;
    return { el: im, vw: im.naturalWidth, vh: im.naturalHeight };
  }
  const v = el.video;
  if (v.readyState < 2 || !v.videoWidth) return null;
  return { el: v, vw: v.videoWidth, vh: v.videoHeight };
}

function loop(now) {
  if (!state.running) return;
  requestAnimationFrame(loop);
  if (state.paused || live.capturing) return;
  if (now - live.lastTick < TICK_MS) return;
  const src = currentSource();
  if (!src) return;
  const dt = live.lastTick ? Math.min(250, now - live.lastTick) : TICK_MS;
  live.lastTick = now;

  let dets = [];
  try { dets = detect(src.el, src.vw, src.vh); } catch (err) { console.warn(err); }
  live.dets = dets;
  const box = pickBox(dets, now);
  const m = measure(src.el, src.vw, src.vh, box);
  live.m = m;
  // An identical frame (the camera hasn't delivered a new one yet) says nothing about movement.
  if (m.motion > 0) live.motionEma += (m.motion - live.motionEma) * 0.35;
  // Sharpness is measured on the car when there is one, else the centre: start afresh when that switches.
  const roi = box ? 'car' : 'centre';
  if (roi !== live.roi) { live.roi = roi; live.bestLap = m.lapVar; }
  live.bestLap = Math.max(m.lapVar, live.bestLap * BEST_DECAY);

  live.frames++;
  if (now - live.fpsAt > 1000) { live.fps = live.frames; live.frames = 0; live.fpsAt = now; }

  const shot = SHOTS[state.idx];
  const ev = evaluate(shot, box, m, src);
  live.ev = ev;
  updateLive(ev, now, dt, shot);
  drawOverlay(ev, src, shot);
}

function pickBox(dets, now) {
  let best = null, bestScore = 0;
  for (const d of dets) {
    const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
    const central = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) * 1.4);
    const s = d.score * (0.25 + d.w * d.h) * (0.4 + central);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  if (best) {
    const prev = live.box;
    live.box = prev && iou(prev, best) > 0.3 ? lerpBox(prev, best, 0.55) : { ...best };
    live.box.score = best.score;
    live.box.label = best.label;
    live.lastSeen = now;
  } else if (live.box && now - live.lastSeen > 350) {
    live.box = null;
  }
  return live.box;
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}
function lerpBox(a, b, k) {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
}

// The rules: compare what the camera sees with the shot we need, and pick ONE thing to fix.
function evaluate(shot, box, m, src) {
  const k = shot.kind;
  const chips = {};
  let instr = null;
  const fail = (key) => { if (!instr) instr = key; };
  const useSensors = sensors.available && state.sourceKind === 'camera';

  // 1. Phone sideways for outside shots
  if (k === 'exterior' && state.sourceKind === 'camera' && src.vw < src.vh) {
    fail(useSensors && sensors.physLandscape ? 'rotationLock' : 'rotate');
  }

  // 2. Light
  const darkLimit = k === 'interior' ? 38 : 48;
  const lightOk = m.mean >= darkLimit && m.mean <= 218;
  chips.light = lightOk ? 'ok' : 'bad';
  if (!lightOk) fail(m.mean < darkLimit ? (k === 'interior' ? 'darkInside' : 'dark') : 'bright');

  // Geometry of the car on screen
  const margin = 0.015;
  let cut = null, fill = 0, ratio = 0, wholeCar = false;
  if (box) {
    cut = { L: box.x < margin, R: box.x + box.w > 1 - margin, T: box.y < margin, B: box.y + box.h > 1 - margin };
    cut.any = cut.L || cut.R || cut.T || cut.B;
    fill = Math.max(box.w, box.h);
    ratio = (box.w * src.vw) / Math.max(1, box.h * src.vh);
    wholeCar = !cut.any && fill < 0.8;
  }

  if (k === 'exterior') {
    // 3. A car, seen from the right kind of angle
    if (!box) {
      chips.car = 'bad';
      chips.frame = 'bad';
      fail('noCar');
    } else {
      // The car's on-screen shape only separates clear cases: head-on (narrow) vs side-on (wide).
      // Corners sit in between and overlap both, so for corners we only catch the extremes.
      let viewOk = true;
      if (!cut.L && !cut.R) {
        if (shot.view === 'head' && ratio > 2.3) {
          viewOk = false;
          fail(shot.end === 'rear' ? 'goRear' : 'goFront');
        } else if (shot.view === 'side' && ratio < 1.9) {
          viewOk = false;
          fail('goSide');
        } else if (shot.view === 'angle' && (ratio < 1.3 || ratio > 3.0)) {
          viewOk = false;
          fail(shot.end === 'rear' ? 'goCornerRear' : 'goCornerFront');
        }
      }
      chips.car = viewOk ? 'ok' : 'bad';

      // 4. Whole car in the frame, centred, not too far
      let frameOk = true;
      const cx = box.x + box.w / 2 - 0.5, cy = box.y + box.h / 2 - 0.5;
      if ((cut.L && cut.R) || (cut.T && cut.B) || (cut.any && fill > 0.9)) { frameOk = false; fail('stepBack'); }
      else if (cut.L) { frameOk = false; fail('aimLeft'); }
      else if (cut.R) { frameOk = false; fail('aimRight'); }
      else if (cut.T) { frameOk = false; fail('aimUp'); }
      else if (cut.B) { frameOk = false; fail('aimDown'); }
      else if (fill < 0.55) { frameOk = false; fail('closer'); }
      else if (Math.abs(cx) > 0.12) { frameOk = false; fail(cx < 0 ? 'aimLeft' : 'aimRight'); }
      else if (Math.abs(cy) > 0.16) { frameOk = false; fail(cy < 0 ? 'aimUp' : 'aimDown'); }
      chips.frame = frameOk ? 'ok' : 'bad';
    }

    // 5. Phone level and upright
    if (useSensors) {
      let lv = 'ok';
      if (sensors.tilt > 38) { lv = 'bad'; fail('upright'); }
      else if (sensors.roll > 5) { lv = 'bad'; fail('level'); }
      chips.level = lv;
    } else {
      chips.level = 'na';
    }
  } else if (k === 'wheel' || k === 'detail') {
    // Close up, the car runs off both sides (or top and bottom) of the frame, or isn't recognised at all.
    // A whole car that is big enough to be this car means the person is still standing back.
    const spans = box && ((cut.L && cut.R) || (cut.T && cut.B) || box.w * box.h > 0.8);
    const closeOk = !box || spans || box.w < 0.3;
    chips.close = closeOk ? 'ok' : 'bad';
    if (!closeOk) fail(k === 'wheel' ? 'closeWheel' : 'closeVin');
  } else if (k === 'interior') {
    // Only a large, whole car means "you're outside"; small cars seen through the windscreen don't count.
    const insideOk = !(box && wholeCar && box.w > 0.45);
    chips.inside = insideOk ? 'ok' : 'bad';
    if (!insideOk) fail('goInside');
  }

  // 6. Steady and sharp
  const isLive = state.sourceKind !== 'image';
  const gyroMoving = useSensors && sensors.rotAvailable && sensors.rot > GYRO_MAX;
  const moving = isLive && (gyroMoving || live.motionEma > MOTION_MAX);
  const softerThanRecent = isLive && m.lapVar < live.bestLap * SHARP_REL; // e.g. a shake blurred this frame
  const blurry = m.lapVar < SHARP_FLOOR[k];                                // very soft: dirty lens, no focus
  chips.sharp = moving || softerThanRecent || blurry ? 'bad' : 'ok';
  if (moving || softerThanRecent) fail('still');
  else if (blurry) fail('blurry');

  const hint = k === 'exterior' && box && m.clip > 0.06 ? 'glareHint' : null;
  return { ok: !instr, instr: instr || 'good', chips, hint, box, ratio, fill, cut };
}

function updateLive(ev, now, dt, shot) {
  // Instruction, steadied so it doesn't flicker
  if (ev.instr !== live.pendingInstr) { live.pendingInstr = ev.instr; live.pendingSince = now; }
  if (live.shownInstr !== ev.instr && (now - live.pendingSince >= 220 || live.shownInstr === 'search')) {
    showInstruction(ev.instr);
    if (!ev.ok && now - live.lastSpokeAt > 2600 && (live.lastSpokenKey !== ev.instr || now - live.lastSpokeAt > 6000)) {
      speak(STR[state.lang].instr[ev.instr]);
      live.lastSpokeAt = now;
      live.lastSpokenKey = ev.instr;
    }
  }

  // Check chips
  const order = CHECKS_FOR[shot.kind];
  const sig = state.lang + order.map((c) => ev.chips[c]).join();
  if (sig !== live.checksSig) {
    live.checksSig = sig;
    el.checks.innerHTML = order.map((c) =>
      `<li class="${ev.chips[c] || 'na'}">${escapeHtml(STR[state.lang].chips[c])}</li>`).join('');
  }

  // Hint
  const hintText = ev.ok && ev.hint ? t(ev.hint) : '';
  el.hint.hidden = !hintText;
  if (hintText) el.hint.textContent = hintText;

  // Auto-capture: stay right for a moment and the photo takes itself
  live.hold = ev.ok ? live.hold + dt : Math.max(0, live.hold - dt * 1.5);
  el.ring.style.strokeDashoffset = String(RING * (1 - Math.min(1, live.hold / HOLD_MS)));
  el.shutter.classList.toggle('ready', ev.ok);
  if (live.hold >= HOLD_MS) capture(true);

  if (now - live.shotStart > ANYWAY_AFTER_MS) el.btnAnyway.hidden = false;

  // What the AI sees (for the pitch)
  el.aiPanel.hidden = !state.aiView;
  if (state.aiView) {
    const m = live.m;
    const best = Math.max(1, live.bestLap);
    const lines = [
      `LIGHT ${fmt(m.mean, 0).padStart(5)}    SHARP ${fmt(m.lapVar, 0).padStart(5)} ${(fmt((m.lapVar / best) * 100, 0) + '%').padStart(4)}`,
      `MOVE  ${fmt(live.motionEma, 1).padStart(5)}/${MOTION_MAX}  GYRO ${sensors.rotAvailable ? fmt(sensors.rot, 0).padStart(4) + '/' + GYRO_MAX : '   –'}`,
      `RATIO ${ev.box ? fmt(ev.ratio, 2).padStart(5) : '    –'}    FILL ${ev.box ? (fmt(ev.fill * 100, 0) + '%').padStart(5) : '    –'}`,
      `TILT  ${sensors.available ? (fmt(sensors.roll, 1) + '°').padStart(5) : '    –'}    GLARE ${(fmt(m.clip * 100, 1) + '%').padStart(4)}  ${live.fps} FPS`,
    ];
    el.hud.textContent = lines.join('\n');
  }
}

function showInstruction(key, force = false) {
  if (!force && live.shownInstr === key) return;
  live.shownInstr = key;
  el.instructionText.textContent = STR[state.lang].instr[key];
  el.instruction.dataset.state = key === 'good' ? 'ok' : key === 'search' || key === 'noCar' ? 'search' : 'bad';
}

// ---------------------------------------------------------------- overlay drawing

// Camera colours (the camera screen is always dark): yellow while tracking, green when right.
const C = { track: '#FFD60A', ok: '#30D158', off: 'rgba(255,255,255,0.75)', guide: 'rgba(255,255,255,0.4)' };

function drawOverlay(ev, src, shot) {
  const W = el.stage.clientWidth, H = el.stage.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (el.overlay.width !== Math.round(W * dpr) || el.overlay.height !== Math.round(H * dpr)) {
    el.overlay.width = Math.round(W * dpr);
    el.overlay.height = Math.round(H * dpr);
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, W, H);
  const s = Math.min(W / src.vw, H / src.vh);
  const dw = src.vw * s, dh = src.vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;

  // Target guide for this shot
  octx.save();
  octx.lineWidth = 1.5;
  octx.strokeStyle = ev.ok ? C.ok : C.guide;
  if (shot.kind === 'exterior') {
    const aspect = VIEW_ASPECT[shot.view];
    let gw = dw * 0.84, gh = gw / aspect;
    if (gh > dh * 0.74) { gh = dh * 0.74; gw = gh * aspect; }
    roundRect(ox + (dw - gw) / 2, oy + (dh - gh) / 2, gw, gh, 18);
    octx.stroke();
  } else if (shot.kind === 'wheel') {
    octx.beginPath();
    octx.arc(ox + dw / 2, oy + dh / 2, Math.min(dw, dh) * 0.36, 0, Math.PI * 2);
    octx.stroke();
  } else if (shot.kind === 'detail') {
    const gw = dw * 0.7, gh = Math.min(dh * 0.26, gw * 0.3);
    roundRect(ox + (dw - gw) / 2, oy + (dh - gh) / 2, gw, gh, 10);
    octx.stroke();
  }
  octx.restore();

  // Every detection, with its confidence (AI view)
  if (state.aiView) {
    octx.save();
    octx.font = '500 12px ui-monospace, "SF Mono", Menlo, monospace';
    octx.direction = 'ltr';
    octx.textAlign = 'left';
    for (const d of live.dets) {
      const x = ox + d.x * dw, y = oy + d.y * dh;
      octx.strokeStyle = 'rgba(255,255,255,0.6)';
      octx.lineWidth = 1;
      octx.strokeRect(x, y, d.w * dw, d.h * dh);
      const label = `car ${Math.round(d.score * 100)}%`; // the model's car, truck and bus all count as a car here
      const tw = octx.measureText(label).width + 10;
      octx.fillStyle = 'rgba(28,28,30,0.8)';
      octx.fillRect(x, Math.max(0, y - 18), tw, 18);
      octx.fillStyle = '#fff';
      octx.fillText(label, x + 5, Math.max(13, y - 5));
    }
    octx.restore();
  }

  // The car the guide is tracking
  if (ev.box && (shot.kind === 'exterior' || state.aiView)) {
    const b = ev.box;
    let color = C.track;
    if (ev.ok) color = C.ok;
    else if (shot.kind === 'exterior' && (ev.chips.car === 'bad' || ev.chips.frame === 'bad')) color = C.off;
    brackets(ox + b.x * dw, oy + b.y * dh, b.w * dw, b.h * dh, color);
  }
}

function roundRect(x, y, w, h, r) {
  octx.beginPath();
  octx.moveTo(x + r, y);
  octx.arcTo(x + w, y, x + w, y + h, r);
  octx.arcTo(x + w, y + h, x, y + h, r);
  octx.arcTo(x, y + h, x, y, r);
  octx.arcTo(x, y, x + w, y, r);
  octx.closePath();
}

function brackets(x, y, w, h, color) {
  const L = Math.max(12, Math.min(42, Math.min(w, h) * 0.2));
  octx.save();
  octx.strokeStyle = color;
  octx.lineWidth = 3;
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  octx.beginPath();
  octx.moveTo(x, y + L); octx.lineTo(x, y); octx.lineTo(x + L, y);
  octx.moveTo(x + w - L, y); octx.lineTo(x + w, y); octx.lineTo(x + w, y + L);
  octx.moveTo(x + w, y + h - L); octx.lineTo(x + w, y + h); octx.lineTo(x + w - L, y + h);
  octx.moveTo(x + L, y + h); octx.lineTo(x, y + h); octx.lineTo(x, y + h - L);
  octx.stroke();
  octx.restore();
}

// ---------------------------------------------------------------- taking the photo

async function capture(verified) {
  if (live.capturing) return;
  const src = currentSource();
  if (!src) return;
  live.capturing = true;
  const shot = SHOTS[state.idx];
  const ev = live.ev;
  const m = live.m;

  el.flash.classList.remove('go');
  void el.flash.offsetWidth;
  el.flash.classList.add('go');
  shutterSound();
  navigator.vibrate?.(30);

  const c = document.createElement('canvas');
  c.width = src.vw;
  c.height = src.vh;
  c.getContext('2d').drawImage(src.el, 0, 0, src.vw, src.vh);
  let blob = null;
  try { blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); } catch (err) { console.warn(err); }
  if (!blob) { live.capturing = false; return; }

  const prev = state.captures[shot.id];
  if (prev?.url) URL.revokeObjectURL(prev.url);
  state.captures[shot.id] = {
    url: URL.createObjectURL(blob),
    verified,
    score: verified && ev && m ? scoreOf(shot, ev, m) : null,
    chips: ev ? { ...ev.chips } : {},
    at: new Date(),
  };
  if (state.sourceKind === 'file') el.video.pause();
  state.paused = true;
  showReview(shot);
}

function scoreOf(shot, ev, m) {
  let s = 100;
  if (m.mean < 85) s -= Math.min(15, (85 - m.mean) * 0.4);
  else if (m.mean > 190) s -= Math.min(15, (m.mean - 190) * 0.5);
  const rel = Math.min(1, m.lapVar / Math.max(1, live.bestLap));
  s -= Math.min(12, (1 - rel) * 24);
  const abs = m.lapVar / SHARP_FLOOR[shot.kind];
  if (abs < 4) s -= Math.min(10, (4 - abs) * 3);
  s -= Math.min(10, m.clip * 100);
  if (ev.box && shot.kind === 'exterior') {
    const cx = Math.abs(ev.box.x + ev.box.w / 2 - 0.5), cy = Math.abs(ev.box.y + ev.box.h / 2 - 0.5);
    s -= Math.min(8, (cx + cy) * 30);
  }
  if (sensors.available && state.sourceKind === 'camera') s -= Math.min(6, sensors.roll);
  return Math.max(0, Math.min(100, Math.round(s)));
}

function showReview(shot) {
  const s = STR[state.lang];
  const cap = state.captures[shot.id];
  el.reviewImg.src = cap.url;
  el.reviewTitle.innerHTML = `${cap.verified ? ICON.ok : ICON.warn}<span>${escapeHtml(cap.verified ? s.looksGood : s.savedUnchecked)}</span>`;
  el.reviewTitle.classList.toggle('warn', !cap.verified);
  el.reviewMeta.textContent = cap.verified ? `${shot.name[state.lang]} · ${s.quality} ${cap.score}` : shot.name[state.lang];
  const last = nextIndex() === -1 || state.returnToDone;
  el.btnNext.textContent = last ? s.finish : s.usePhoto;
  el.review.hidden = false;

  clearTimeout(reviewTimer);
  el.reviewCount.classList.remove('counting');
  if (cap.verified) {
    void el.reviewCount.offsetWidth;
    el.reviewCount.classList.add('counting');
    reviewTimer = setTimeout(advance, REVIEW_MS);
  }
  live.capturing = false;
}

function nextIndex() {
  for (let j = state.idx + 1; j < SHOTS.length; j++) if (!state.captures[SHOTS[j].id]) return j;
  for (let j = 0; j < state.idx; j++) if (!state.captures[SHOTS[j].id]) return j;
  return -1;
}

function advance() {
  clearTimeout(reviewTimer);
  el.reviewCount.classList.remove('counting');
  el.review.hidden = true;
  const n = nextIndex();
  if (state.returnToDone || n === -1) { state.returnToDone = false; showDone(); return; }
  if (state.sourceKind === 'file') el.video.play().catch(() => {});
  state.paused = false;
  goTo(n);
}

el.btnNext.addEventListener('click', advance);
el.btnRetake.addEventListener('click', () => {
  clearTimeout(reviewTimer);
  el.reviewCount.classList.remove('counting');
  el.review.hidden = true;
  if (state.sourceKind === 'file') el.video.play().catch(() => {});
  state.paused = false;
  goTo(state.idx);
});

el.shutter.addEventListener('click', () => {
  unlockAudio();
  if (live.ev?.ok) { capture(true); return; }
  // Not right yet: say what to fix, out loud
  el.instruction.classList.remove('nudge');
  void el.instruction.offsetWidth;
  el.instruction.classList.add('nudge');
  const key = live.shownInstr && live.shownInstr !== 'search' ? live.shownInstr : null;
  if (key) { speak(STR[state.lang].instr[key]); live.lastSpokeAt = performance.now(); live.lastSpokenKey = key; }
});
el.btnAnyway.addEventListener('click', () => capture(false));
el.btnSkip.addEventListener('click', () => {
  const n = nextIndex();
  if (n === -1 || n === state.idx) { showDone(); return; }
  goTo(n);
});
el.btnAi.addEventListener('click', () => {
  state.aiView = !state.aiView;
  el.btnAi.setAttribute('aria-pressed', String(state.aiView));
  el.aiPanel.hidden = !state.aiView;
});
el.btnVoice.addEventListener('click', () => {
  state.voice = !state.voice;
  el.btnVoice.setAttribute('aria-pressed', String(state.voice));
  if (!state.voice) speechSynthesis?.cancel?.();
});
el.btnTorch.addEventListener('click', async () => {
  const track = state.stream?.getVideoTracks()[0];
  if (!track) return;
  const on = el.btnTorch.getAttribute('aria-pressed') !== 'true';
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    el.btnTorch.setAttribute('aria-pressed', String(on));
  } catch { el.btnTorch.hidden = true; }
});
el.btnClose.addEventListener('click', () => {
  if (Object.keys(state.captures).length) showDone();
  else exitToStart();
});

// All-photos sheet (from the title or the last-photo thumbnail)
const openSheet = () => { renderSheet(); el.sheet.hidden = false; state.paused = true; };
el.btnShots.addEventListener('click', openSheet);
el.thumbBtn.addEventListener('click', openSheet);
el.btnSheetClose.addEventListener('click', closeSheet);
el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });
function closeSheet() { el.sheet.hidden = true; if (el.review.hidden) state.paused = false; }
function renderSheet() {
  el.sheetList.innerHTML = SHOTS.map((s, i) => {
    const done = !!state.captures[s.id];
    const cur = i === state.idx;
    const st = cur ? `<span class="st">${escapeHtml(t('current'))}</span>` : done ? `<span class="st">${ICON.ok}</span>` : '';
    return `<li><button type="button" data-i="${i}"><span class="n">${i + 1}</span><span class="nm">${escapeHtml(s.name[state.lang])}</span>${st}</button></li>`;
  }).join('');
}
el.sheetList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  el.sheet.hidden = true;
  state.paused = false;
  goTo(Number(b.dataset.i));
});

function exitToStart() {
  state.running = false;
  stopStream();
  el.video.pause();
  speechSynthesis?.cancel?.();
  el.capture.hidden = true;
  el.done.hidden = true;
  el.start.hidden = false;
}

// ---------------------------------------------------------------- done screen

function showDone() {
  state.running = false;
  state.paused = false;
  speechSynthesis?.cancel?.();
  stopStream();
  el.video.pause();
  try { wakeLock?.release?.(); } catch { /* ignore */ }
  el.capture.hidden = true;
  el.start.hidden = true;
  el.done.hidden = false;
  renderDone();
  window.scrollTo(0, 0);
}

function renderDone() {
  const s = STR[state.lang];
  const caps = SHOTS.map((x) => state.captures[x.id]).filter(Boolean);
  const n = caps.length;
  const passed = caps.filter((c) => c.verified).length;
  const complete = n === SHOTS.length;
  el.doneIcon.innerHTML = complete ? ICON.ok : ICON.camera;
  el.doneIcon.classList.toggle('partial', !complete);
  el.doneTitle.textContent = complete ? s.doneTitleAll : s.doneTitleSome(n, SHOTS.length);
  const lastAt = caps.reduce((a, c) => Math.max(a, c.at.getTime()), state.startedAt || Date.now());
  const secs = Math.max(0, Math.round((lastAt - (state.startedAt || lastAt)) / 1000));
  el.doneSub.textContent = s.doneSub(s.duration(Math.floor(secs / 60), secs % 60), passed);

  const timeFmt = new Intl.DateTimeFormat(s.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.reportList.innerHTML = SHOTS.map((x, i) => {
    const c = state.captures[x.id];
    const thumb = c ? `<img class="row-thumb" src="${c.url}" alt="">` : `<span class="row-thumb">${ICON.camera}</span>`;
    const sub = c ? `${timeFmt.format(c.at)} · ${c.verified ? s.allPassed : s.notChecked}` : s.missing;
    const end = !c
      ? `<span class="i chev">${ICON.chevron}</span>`
      : c.verified
        ? `<span>${c.score}</span><span class="i ok">${ICON.ok}</span>`
        : `<span class="i warn">${ICON.warn}</span>`;
    return `<li><button class="row" type="button" data-i="${i}">${thumb}<span class="row-text"><span class="row-title">${escapeHtml(x.name[state.lang])}</span><span class="row-sub">${escapeHtml(sub)}</span></span><span class="row-end">${end}</span></button></li>`;
  }).join('');
}

el.reportList.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  try { await resumeSource(); } catch { exitToStart(); return; }
  state.returnToDone = true;
  enterCapture(Number(b.dataset.i));
});
el.btnSend.addEventListener('click', () => {
  el.toast.textContent = t('sentDemo');
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
});
el.btnAgain.addEventListener('click', async () => {
  for (const c of Object.values(state.captures)) URL.revokeObjectURL(c.url);
  state.captures = {};
  state.startedAt = 0;
  state.returnToDone = false;
  if (state.sourceKind === 'image') { enterCapture(0); return; }
  try { await resumeSource(); enterCapture(0); } catch { exitToStart(); }
});

document.querySelectorAll('.js-lang').forEach((b) => b.addEventListener('click', toggleLang));

// ---------------------------------------------------------------- helpers

function fmt(v, d) { return Number.isFinite(v) ? v.toFixed(d) : '–'; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Test hook for desktop checks without a camera: kadr.useImage(url) runs the guide on a still photo.
window.kadr = {
  state,
  shots: SHOTS,
  async useImage(url) {
    await loadDetector();
    stopStream();
    state.sourceKind = 'image';
    el.video.hidden = true;
    el.img.hidden = false;
    await new Promise((res, rej) => { el.img.onload = res; el.img.onerror = rej; el.img.src = url; });
    if (el.capture.hidden) enterCapture(state.idx);
    else { live = resetLive(); resetMotion(); }
  },
  goTo: (i) => goTo(i),
  live: () => ({ ...live.ev, m: live.m, dets: live.dets }),
};

applyLang();
