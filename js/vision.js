// The "eyes": a car detector (AI) plus plain image maths for light, sharpness and movement.
// Everything runs on the phone; no frame is sent anywhere.

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

let detector = null;
let loading = null;
let lastTs = 0;

export function loadDetector() {
  if (detector) return Promise.resolve(detector);
  if (loading) return loading;
  loading = (async () => {
    const { FilesetResolver, ObjectDetector } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) =>
      ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        scoreThreshold: 0.3,
        maxResults: 6,
        categoryAllowlist: ['car', 'truck', 'bus'],
      });
    try {
      detector = await make('GPU');
    } catch (err) {
      console.warn('GPU detector failed, falling back to CPU', err);
      detector = await make('CPU');
    }
    return detector;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// Returns detections as fractions of the frame (0–1).
export function detect(source, vw, vh) {
  if (!detector) return [];
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;
  const res = detector.detectForVideo(source, ts);
  return (res.detections || []).map((d) => {
    const b = d.boundingBox;
    const c = d.categories[0] || { score: 0, categoryName: '' };
    const x = clamp01(b.originX / vw), y = clamp01(b.originY / vh);
    return {
      x, y,
      w: clamp01((b.originX + b.width) / vw) - x,
      h: clamp01((b.originY + b.height) / vh) - y,
      score: c.score,
      label: c.categoryName,
    };
  });
}

// --- Image maths on a small copy of the frame ---------------------------------------------

const SW = 320;
const small = document.createElement('canvas');
const sctx = small.getContext('2d', { willReadFrequently: true });
let prevGray = null;

export function resetMotion() { prevGray = null; }

// mean: average brightness 0–255
// lapVar: sharpness (variance of the Laplacian) inside the car box or the centre of the frame
// clip: share of blown-out pixels in that area (reflections)
// motion: average change since the last analysed frame (camera shake or walking)
export function measure(source, vw, vh, box) {
  const sh = Math.max(8, Math.round((SW * vh) / vw));
  if (small.width !== SW || small.height !== sh) {
    small.width = SW;
    small.height = sh;
    prevGray = null;
  }
  sctx.drawImage(source, 0, 0, SW, sh);
  const { data } = sctx.getImageData(0, 0, SW, sh);
  const n = SW * sh;
  const gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const g = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    gray[i] = g;
    sum += g;
  }
  const mean = sum / n;

  const r = box
    ? { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h }
    : { x0: 0.15, y0: 0.15, x1: 0.85, y1: 0.85 };
  const x0 = Math.max(1, Math.floor(r.x0 * SW)), x1 = Math.min(SW - 2, Math.ceil(r.x1 * SW));
  const y0 = Math.max(1, Math.floor(r.y0 * sh)), y1 = Math.min(sh - 2, Math.ceil(r.y1 * sh));

  let lsum = 0, lsq = 0, cnt = 0, clipped = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * SW;
    for (let x = x0; x <= x1; x++) {
      const i = row + x;
      const g = gray[i];
      const l = 4 * g - gray[i - 1] - gray[i + 1] - gray[i - SW] - gray[i + SW];
      lsum += l;
      lsq += l * l;
      cnt++;
      if (g >= 250) clipped++;
    }
  }
  const lapVar = cnt ? lsq / cnt - (lsum / cnt) ** 2 : 0;

  let motion = 0;
  if (prevGray && prevGray.length === n) {
    let d = 0, c = 0;
    for (let i = 0; i < n; i += 7) { d += Math.abs(gray[i] - prevGray[i]); c++; }
    motion = d / c;
  }
  prevGray = gray;

  return { mean, lapVar, clip: cnt ? clipped / cnt : 0, motion };
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
