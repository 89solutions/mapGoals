const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../js/geo.js');

const LONDON = [51.5074, -0.1278];
const NEW_YORK = [40.7128, -74.006];

test('haversine London → New York ≈ 5570 km', () => {
  const km = Geo.haversineKm(LONDON, NEW_YORK);
  assert.ok(Math.abs(km - 5570) < 15, `got ${km}`);
});

test('great-circle path length matches haversine distance', () => {
  const path = Geo.greatCirclePoints(LONDON, NEW_YORK);
  assert.ok(Math.abs(Geo.pathLengthKm(path) - Geo.haversineKm(LONDON, NEW_YORK)) < 0.5);
  assert.deepEqual(path[0].map((v) => +v.toFixed(6)), LONDON);
});

test('15 of 30 lbs puts the marker halfway along a 100-mile route', () => {
  const fraction = Geo.progressFraction(Geo.totalProgress([{ amount: 10 }, { amount: 5 }]), 30);
  assert.equal(fraction, 0.5);
  // ~100 miles due north along a meridian
  const start = [50, 0];
  const end = [50 + (100 * Geo.KM_PER_MILE) / 111.195, 0];
  const path = Geo.greatCirclePoints(start, end);
  const total = Geo.kmTo(Geo.pathLengthKm(path), 'mi');
  assert.ok(Math.abs(total - 100) < 0.5, `total ${total}`);
  const { point, travelled } = Geo.pointAlongPath(path, fraction);
  const done = Geo.kmTo(Geo.haversineKm(start, point), 'mi');
  assert.ok(Math.abs(done - 50) < 0.5, `travelled ${done}`);
  assert.ok(Math.abs(Geo.kmTo(Geo.pathLengthKm(travelled), 'mi') - 50) < 0.5);
});

test('progress is clamped to 0..1 and handles bad targets', () => {
  assert.equal(Geo.progressFraction(40, 30), 1);
  assert.equal(Geo.progressFraction(-5, 30), 0);
  assert.equal(Geo.progressFraction(5, 0), 0);
  assert.equal(Geo.progressFraction(5, null), 0);
});

test('pointAlongPath works on multi-segment (road-like) paths', () => {
  const path = [[0, 0], [0, 1], [1, 1]]; // two ~111 km legs
  const mid = Geo.pointAlongPath(path, 0.5).point;
  assert.ok(Math.abs(mid[0]) < 0.01 && Math.abs(mid[1] - 1) < 0.01, `got ${mid}`);
  assert.deepEqual(Geo.pointAlongPath(path, 1).point, [1, 1]);
  assert.deepEqual(Geo.pointAlongPath(path, 0).point, [0, 0]);
});

test('antimeridian crossing keeps longitudes continuous', () => {
  const path = Geo.greatCirclePoints([35.68, 139.69], [37.77, -122.42]); // Tokyo → San Francisco
  for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i][1] - path[i - 1][1]) < 180);
});

test('bearings', () => {
  assert.ok(Math.abs(Geo.bearingDeg([0, 0], [1, 0]) - 0) < 1e-9); // north
  assert.ok(Math.abs(Geo.bearingDeg([0, 0], [0, 1]) - 90) < 1e-9); // east
  assert.ok(Math.abs(Geo.bearingDeg([0, 0], [-1, 0]) - 180) < 1e-9); // south
  assert.ok(Math.abs(Geo.bearingDeg([0, 0], [0, -1]) - 270) < 1e-9); // west
  // London → New York heads west-north-west at the start of the great circle
  const b = Geo.bearingDeg(LONDON, NEW_YORK);
  assert.ok(b > 280 && b < 300, `got ${b}`);
});

test('pointAlongPath reports the heading of the current leg', () => {
  const path = [[0, 0], [0, 1], [1, 1]]; // east, then north
  assert.ok(Math.abs(Geo.pointAlongPath(path, 0.25).heading - 90) < 1e-6);
  assert.ok(Math.abs(Geo.pointAlongPath(path, 0.75).heading - 0) < 1e-6);
  assert.ok(Math.abs(Geo.pointAlongPath(path, 0).heading - 90) < 1e-6);
  assert.ok(Math.abs(Geo.pointAlongPath(path, 1).heading - 0) < 1e-6);
  assert.equal(Geo.pointAlongPath([[5, 5], [5, 5]], 0.5).heading, null);
});

test('traveller icon depends on route type and distance (50-mile threshold)', () => {
  const mi = (n) => n * Geo.KM_PER_MILE;
  assert.equal(Geo.pickTraveller('road', mi(20), 'auto'), 'runner');
  assert.equal(Geo.pickTraveller('road', mi(50), 'auto'), 'runner');
  assert.equal(Geo.pickTraveller('road', mi(51), 'auto'), 'car');
  assert.equal(Geo.pickTraveller('straight', mi(20), 'auto'), 'bird');
  assert.equal(Geo.pickTraveller('straight', mi(500), 'auto'), 'plane');
  assert.equal(Geo.pickTraveller('straight', mi(500)), 'plane');
  assert.equal(Geo.pickTraveller('road', mi(500), 'cyclist'), 'cyclist');
});
