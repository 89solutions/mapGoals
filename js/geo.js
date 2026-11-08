/*
 * Pure geometry + progress helpers. No DOM, no Leaflet.
 * Works as a browser global (window.MapGoalsGeo) and as a CommonJS module (for tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapGoalsGeo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const EARTH_RADIUS_KM = 6371.0088;
  const KM_PER_MILE = 1.609344;

  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  /** Great-circle distance between two [lat, lng] points, in km. */
  function haversineKm(a, b) {
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Points along the great circle from a to b (inclusive), so the line drawn
   * on the map is the true shortest path and interpolation along it is accurate.
   */
  function greatCirclePoints(a, b, segments = 128) {
    const lat1 = toRad(a[0]), lng1 = toRad(a[1]);
    const lat2 = toRad(b[0]), lng2 = toRad(b[1]);
    const d = haversineKm(a, b) / EARTH_RADIUS_KM; // angular distance
    if (d < 1e-9) return [a.slice(), b.slice()];
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const A = Math.sin((1 - f) * d) / Math.sin(d);
      const B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
      const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
      const z = A * Math.sin(lat1) + B * Math.sin(lat2);
      pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
    }
    return unwrapLongitudes(pts);
  }

  /** Make longitudes continuous so lines crossing the antimeridian draw correctly. */
  function unwrapLongitudes(pts) {
    const out = [pts[0].slice()];
    for (let i = 1; i < pts.length; i++) {
      let lng = pts[i][1];
      const prev = out[i - 1][1];
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
      out.push([pts[i][0], lng]);
    }
    return out;
  }

  /** Total length of a polyline ([[lat,lng], ...]) in km. */
  function pathLengthKm(path) {
    let total = 0;
    for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1], path[i]);
    return total;
  }

  /**
   * The point that is `fraction` (0..1) of the way along the polyline, by distance.
   * Also returns the portion of the path already travelled.
   */
  function pointAlongPath(path, fraction) {
    if (!path || path.length === 0) return null;
    if (path.length === 1) return { point: path[0].slice(), travelled: [path[0].slice()] };
    const f = clamp(fraction, 0, 1);
    const target = pathLengthKm(path) * f;
    let walked = 0;
    const travelled = [path[0].slice()];
    for (let i = 1; i < path.length; i++) {
      const seg = haversineKm(path[i - 1], path[i]);
      if (walked + seg >= target) {
        const t = seg === 0 ? 0 : (target - walked) / seg;
        const p = [
          path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
          path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
        ];
        travelled.push(p);
        return { point: p, travelled };
      }
      walked += seg;
      travelled.push(path[i].slice());
    }
    const last = path[path.length - 1].slice();
    return { point: last, travelled };
  }

  /** Sum of logged progress entries. */
  function totalProgress(entries) {
    return (entries || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }

  /** Fraction (0..1) of the goal achieved. */
  function progressFraction(achieved, target) {
    if (!(target > 0)) return 0;
    return clamp(achieved / target, 0, 1);
  }

  function kmTo(km, unit) {
    return unit === 'mi' ? km / KM_PER_MILE : km;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  return {
    EARTH_RADIUS_KM,
    KM_PER_MILE,
    haversineKm,
    greatCirclePoints,
    pathLengthKm,
    pointAlongPath,
    totalProgress,
    progressFraction,
    kmTo,
    clamp,
  };
});
