// Distance helpers for the donor "Maximum Alert Radius" (pure, no DB access).
//
// Where a point comes from, best first:
//   1. 'gps'  - coordinates the person saved (donor: "Use my current location";
//               requester: "Use my current location" on the request form).
//   2. 'city' - the centre of the city typed on the profile / request. The
//               distance is then APPROXIMATE (it is measured between city
//               centres, not between the exact addresses).
//   3. none   - the city is not in CITY_CENTERS and no coordinates exist. The
//               rule then falls back to "same city name" so an unknown place
//               is never silently shown to everyone.
//
// City centres are approximate (good to a few km). Add a city by adding a line.

const EARTH_RADIUS_KM = 6371;

export const DEFAULT_ALERT_RADIUS_KM = 10;
export const MIN_ALERT_RADIUS_KM = 1;
export const MAX_ALERT_RADIUS_KM = 100;

// [latitude, longitude]
export const CITY_CENTERS = {
  karachi: [24.8607, 67.0011],
  lahore: [31.5204, 74.3587],
  islamabad: [33.6844, 73.0479],
  rawalpindi: [33.5651, 73.0169],
  peshawar: [34.0151, 71.5249],
  quetta: [30.1798, 66.975],
  multan: [30.1575, 71.5249],
  faisalabad: [31.4504, 73.135],
  hyderabad: [25.396, 68.3578],
  sukkur: [27.7052, 68.8574],
  rohri: [27.69, 68.895],
  'pano aqil': [27.8553, 69.1115],
  larkana: [27.559, 68.212],
  khairpur: [27.5295, 68.7592],
  shikarpur: [27.9556, 68.6382],
  jacobabad: [28.2769, 68.4514],
  ghotki: [28.006, 69.315],
  nawabshah: [26.2483, 68.4096],
  'shaheed benazirabad': [26.2483, 68.4096],
  dadu: [26.7319, 67.777],
  'mirpur khas': [25.5251, 69.0159],
  'rahim yar khan': [28.4202, 70.2952],
  bahawalpur: [29.3956, 71.6836],
  sialkot: [32.4945, 74.5229],
  gujranwala: [32.1877, 74.1945],
  sargodha: [32.074, 72.6861],
  sahiwal: [30.6682, 73.1114],
  abbottabad: [34.1558, 73.2194],
  mardan: [34.1989, 72.0231],
};

export function normalizePlace(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// "Sukkur", " sukkur ", "Sukkur, Sindh" all resolve to Sukkur.
export function cityCenter(city) {
  const full = normalizePlace(city);
  if (!full) return null;
  if (CITY_CENTERS[full]) return CITY_CENTERS[full];
  const first = normalizePlace(full.split(',')[0]);
  return CITY_CENTERS[first] || null;
}

export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Validates a latitude/longitude pair from a request body.
//   both empty        -> { ok: true, none: true }
//   both valid        -> { ok: true, latitude, longitude }   (numbers)
//   anything else     -> { ok: false, error }
export function parseCoordinates(latitude, longitude) {
  const empty = (v) => v === undefined || v === null || v === '';
  if (empty(latitude) && empty(longitude)) return { ok: true, none: true };
  if (empty(latitude) || empty(longitude)) {
    return { ok: false, error: 'latitude and longitude must be sent together' };
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: 'latitude must be a number between -90 and 90' };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, error: 'longitude must be a number between -180 and 180' };
  }
  return { ok: true, latitude: lat, longitude: lng };
}

// A usable point for {latitude, longitude, city}, or null when none can be found.
export function resolvePoint({ latitude, longitude, city } = {}) {
  const hasGps = latitude !== null && latitude !== undefined && latitude !== ''
    && longitude !== null && longitude !== undefined && longitude !== '';
  if (hasGps) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, source: 'gps' };
  }
  const center = cityCenter(city);
  return center ? { lat: center[0], lng: center[1], source: 'city' } : null;
}

// Is a request inside a donor's alert radius?
//   { ok, km, approximate }
//   km is null when no distance could be worked out (the same-city fallback).
export function checkRadius({ donor, request, radiusKm }) {
  const radius = Number(radiusKm) > 0 ? Number(radiusKm) : DEFAULT_ALERT_RADIUS_KM;
  const from = resolvePoint(donor);
  const to = resolvePoint(request);

  if (!from || !to) {
    const sameCity = normalizePlace(donor?.city) !== '' &&
      normalizePlace(donor?.city) === normalizePlace(request?.city);
    return { ok: sameCity, km: null, approximate: true };
  }

  const km = haversineKm(from, to);
  return {
    ok: km <= radius,
    km: Math.round(km * 10) / 10,
    approximate: from.source === 'city' || to.source === 'city',
  };
}
