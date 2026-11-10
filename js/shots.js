// The draft photo list: one walk around the car, then three inside.
// ring: where the person stands, in 45° steps around the car along the route (0 front, 2 driver side, 4 rear,
// 6 passenger side). The phone's turn between photos must match: the gyroscope tells us how far they walked.
// ringTol: how many degrees off still counts as the right spot (wider for wheels, which are photographed close up).
// Map coordinates are for the top-view map (viewBox 0 0 160 200, car facing up).
// Left = driver side (Jordan and Saudi Arabia drive on the right, so the driver sits on the left).

export const SHOTS = [
  {
    id: 'front', ring: 0, ringTol: 25,
    walk: { en: 'Walk to the front of the car', ar: 'اذهب إلى مقدمة السيارة' },
    kind: 'exterior', view: 'head', end: 'front', spot: [80, 14], aim: [80, 100],
    name: { en: 'Front', ar: 'الأمام' },
    tip: { en: 'Stand 3–4 steps in front of the car.', ar: 'قف أمام السيارة على بُعد 3–4 خطوات.' },
  },
  {
    id: 'front-left', ring: 1, ringTol: 25,
    walk: { en: 'Walk to the front corner on the driver side', ar: 'اذهب إلى الزاوية الأمامية من جهة السائق' },
    kind: 'exterior', view: 'angle', end: 'front', spot: [32, 36], aim: [80, 100],
    name: { en: 'Front corner, driver side', ar: 'الزاوية الأمامية، جهة السائق' },
    tip: { en: 'Stand at the corner so the front and the side both show.', ar: 'قف عند الزاوية لتظهر المقدمة والجانب معاً.' },
  },
  {
    id: 'wheel-fl', ring: 2, ringTol: 45,
    walk: { en: 'Walk to the driver side of the car', ar: 'اذهب إلى جهة السائق' },
    kind: 'wheel', spot: [30, 72], aim: [55, 72],
    name: { en: 'Front wheel, driver side', ar: 'الإطار الأمامي، جهة السائق' },
    tip: { en: 'Crouch next to the front wheel.', ar: 'انزل بجانب الإطار الأمامي.' },
  },
  {
    id: 'left', ring: 2, ringTol: 25,
    walk: { en: 'Walk to the driver side of the car', ar: 'اذهب إلى جهة السائق' },
    kind: 'exterior', view: 'side', spot: [14, 100], aim: [80, 100],
    name: { en: 'Driver side', ar: 'جهة السائق' },
    tip: { en: 'Stand opposite the middle of the car, 4–5 steps back.', ar: 'قف مقابل منتصف السيارة على بُعد 4–5 خطوات.' },
  },
  {
    id: 'wheel-rl', ring: 2, ringTol: 45,
    walk: { en: 'Walk to the driver side of the car', ar: 'اذهب إلى جهة السائق' },
    kind: 'wheel', spot: [30, 128], aim: [55, 128],
    name: { en: 'Rear wheel, driver side', ar: 'الإطار الخلفي، جهة السائق' },
    tip: { en: 'Crouch next to the rear wheel.', ar: 'انزل بجانب الإطار الخلفي.' },
  },
  {
    id: 'rear-left', ring: 3, ringTol: 25,
    walk: { en: 'Walk to the rear corner on the driver side', ar: 'اذهب إلى الزاوية الخلفية من جهة السائق' },
    kind: 'exterior', view: 'angle', end: 'rear', spot: [32, 164], aim: [80, 100],
    name: { en: 'Rear corner, driver side', ar: 'الزاوية الخلفية، جهة السائق' },
    tip: { en: 'Stand at the corner so the back and the side both show.', ar: 'قف عند الزاوية لتظهر المؤخرة والجانب معاً.' },
  },
  {
    id: 'rear', ring: 4, ringTol: 25,
    walk: { en: 'Walk to the back of the car', ar: 'اذهب إلى خلف السيارة' },
    kind: 'exterior', view: 'head', end: 'rear', spot: [80, 186], aim: [80, 100],
    name: { en: 'Rear', ar: 'الخلف' },
    tip: { en: 'Stand 3–4 steps behind the car.', ar: 'قف خلف السيارة على بُعد 3–4 خطوات.' },
  },
  {
    id: 'rear-right', ring: 5, ringTol: 25,
    walk: { en: 'Walk to the rear corner on the passenger side', ar: 'اذهب إلى الزاوية الخلفية من جهة الراكب' },
    kind: 'exterior', view: 'angle', end: 'rear', spot: [128, 164], aim: [80, 100],
    name: { en: 'Rear corner, passenger side', ar: 'الزاوية الخلفية، جهة الراكب' },
    tip: { en: 'Stand at the corner so the back and the side both show.', ar: 'قف عند الزاوية لتظهر المؤخرة والجانب معاً.' },
  },
  {
    id: 'wheel-rr', ring: 6, ringTol: 45,
    walk: { en: 'Walk to the passenger side of the car', ar: 'اذهب إلى جهة الراكب' },
    kind: 'wheel', spot: [130, 128], aim: [105, 128],
    name: { en: 'Rear wheel, passenger side', ar: 'الإطار الخلفي، جهة الراكب' },
    tip: { en: 'Crouch next to the rear wheel.', ar: 'انزل بجانب الإطار الخلفي.' },
  },
  {
    id: 'right', ring: 6, ringTol: 25,
    walk: { en: 'Walk to the passenger side of the car', ar: 'اذهب إلى جهة الراكب' },
    kind: 'exterior', view: 'side', spot: [146, 100], aim: [80, 100],
    name: { en: 'Passenger side', ar: 'جهة الراكب' },
    tip: { en: 'Stand opposite the middle of the car, 4–5 steps back.', ar: 'قف مقابل منتصف السيارة على بُعد 4–5 خطوات.' },
  },
  {
    id: 'wheel-fr', ring: 6, ringTol: 45,
    walk: { en: 'Walk to the passenger side of the car', ar: 'اذهب إلى جهة الراكب' },
    kind: 'wheel', spot: [130, 72], aim: [105, 72],
    name: { en: 'Front wheel, passenger side', ar: 'الإطار الأمامي، جهة الراكب' },
    tip: { en: 'Crouch next to the front wheel.', ar: 'انزل بجانب الإطار الأمامي.' },
  },
  {
    id: 'front-right', ring: 7, ringTol: 25,
    walk: { en: 'Walk to the front corner on the passenger side', ar: 'اذهب إلى الزاوية الأمامية من جهة الراكب' },
    kind: 'exterior', view: 'angle', end: 'front', spot: [128, 36], aim: [80, 100],
    name: { en: 'Front corner, passenger side', ar: 'الزاوية الأمامية، جهة الراكب' },
    tip: { en: 'Stand at the corner so the front and the side both show.', ar: 'قف عند الزاوية لتظهر المقدمة والجانب معاً.' },
  },
  {
    id: 'dashboard', kind: 'interior', spot: [69, 98], aim: [69, 82],
    name: { en: 'Dashboard and mileage', ar: 'لوحة العدادات وعداد المسافة' },
    tip: { en: 'Sit in the driver’s seat with the engine on, so the mileage shows.', ar: 'اجلس في مقعد السائق والمحرك يعمل ليظهر عداد المسافة.' },
  },
  {
    id: 'seats', kind: 'interior', spot: [40, 104], aim: [80, 104],
    name: { en: 'Front seats', ar: 'المقاعد الأمامية' },
    tip: { en: 'Open the driver door and fit both front seats in the photo.', ar: 'افتح باب السائق وصوّر المقعدين الأماميين معاً.' },
  },
  {
    id: 'vin', kind: 'detail', spot: [64, 80], aim: [64, 72],
    name: { en: 'Chassis number (VIN)', ar: 'رقم الشاصي (VIN)' },
    tip: { en: 'Look at the bottom of the windscreen or the driver door frame.', ar: 'ستجده أسفل الزجاج الأمامي أو على إطار باب السائق.' },
  },
];

// Lowest acceptable sharpness (variance of the Laplacian on a 320px-wide copy of the frame) per kind of shot.
// Only very soft frames fail this; everyday sharpness is judged against the recent best frame instead.
// Measured on test photos: sharp 800–7500, a 4px blur at 1280px ≈ 170, an 8px blur ≈ 20, a 14px blur ≈ 5.
export const SHARP_FLOOR = { exterior: 12, wheel: 12, interior: 8, detail: 20 };

// Rough width-to-height ratio of the car on screen for each view, used to draw the target frame.
export const VIEW_ASPECT = { head: 1.45, angle: 2.5, side: 2.95 };

// Which checks each kind of shot shows, in order.
export const CHECKS_FOR = {
  exterior: ['spot', 'car', 'frame', 'light', 'level', 'sharp'],
  wheel: ['spot', 'close', 'light', 'sharp'],
  interior: ['inside', 'light', 'sharp'],
  detail: ['close', 'light', 'sharp'],
};
