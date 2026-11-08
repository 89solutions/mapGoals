const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/forecast.js');

const e = (date, value) => ({ date, value });

test('estimates from a start date: 15 of 30 lbs in 6 weeks → 6 more weeks', () => {
  const r = F.estimateFinish([e('2026-01-15', 7), e('2026-02-12', 8)], 30, { startDate: '2026-01-01' });
  assert.equal(r.status, 'estimate');
  assert.equal(r.basisFrom, '2026-01-01');
  assert.equal(r.basisTo, '2026-02-12');
  assert.equal(r.daysNeeded, 42); // 15 left at 15/42 per day
  assert.equal(r.finishDate, '2026-03-26');
});

test('without a start date, the first entry is the baseline', () => {
  // first day's 5 is the baseline; then 5 more in 10 days → 0.5/day; 20 left → 40 days
  const r = F.estimateFinish([e('2026-03-01', 5), e('2026-03-11', 5)], 30);
  assert.equal(r.status, 'estimate');
  assert.equal(r.ratePerDay, 0.5);
  assert.equal(r.finishDate, '2026-04-20');
});

test('recalculates as progress is added', () => {
  const entries = [e('2026-03-01', 2), e('2026-03-08', 2)];
  const before = F.estimateFinish(entries, 20, { startDate: '2026-02-22' }).finishDate;
  entries.push(e('2026-03-15', 6)); // a great week speeds things up
  const after = F.estimateFinish(entries, 20, { startDate: '2026-02-22' }).finishDate;
  assert.ok(after < before, `${after} should be earlier than ${before}`);
});

test('handles entries out of order and setbacks', () => {
  const r = F.estimateFinish([e('2026-01-21', -1), e('2026-01-01', 0), e('2026-01-11', 3)], 10);
  assert.equal(r.status, 'estimate');
  assert.equal(r.ratePerDay, 0.1); // net +2 over 20 days
  assert.equal(r.finishDate, '2026-04-11'); // 8 left / 0.1 = 80 days
});

test('reports why there is no estimate yet', () => {
  assert.equal(F.estimateFinish([], 30).status, 'no-data');
  assert.equal(F.estimateFinish([e('2026-01-01', 3)], 0).status, 'no-target');
  assert.equal(F.estimateFinish([e('2026-01-01', 3)], 30).status, 'need-more');
  assert.equal(F.estimateFinish([e('2026-01-01', 3), e('2026-01-05', 0)], 30).status, 'no-progress');
  assert.equal(F.estimateFinish([e('2026-01-01', 3), e('2026-01-05', -2)], 30).status, 'no-progress');
  assert.equal(F.estimateFinish([e('2020-01-01', 0), e('2026-01-01', 0.0001)], 1000).status, 'too-slow');
});

test('a single entry can be estimated when a start date is set', () => {
  const r = F.estimateFinish([e('2026-01-08', 2)], 10, { startDate: '2026-01-01' });
  assert.equal(r.status, 'estimate');
  assert.equal(r.finishDate, '2026-02-05'); // 2/week, 8 left → 4 weeks
});

test('reports the date the goal was reached', () => {
  const r = F.estimateFinish([e('2026-01-01', 20), e('2026-01-10', 12), e('2026-01-20', -1)], 30);
  assert.equal(r.status, 'reached');
  assert.equal(r.reachedDate, '2026-01-10');
  // dipped below and crossed again → the later crossing counts
  const r2 = F.estimateFinish([e('2026-01-01', 31), e('2026-01-05', -3), e('2026-01-09', 5)], 30);
  assert.equal(r2.reachedDate, '2026-01-09');
});

test('compares against an optional target date', () => {
  const opts = { startDate: '2026-01-01', targetDate: '2026-03-12' };
  const r = F.estimateFinish([e('2026-02-12', 15)], 30, opts); // finishes 2026-03-26
  assert.equal(r.daysLate, 14);
  assert.equal(r.requiredRatePerDay, 15 / 28);
  const early = F.estimateFinish([e('2026-02-12', 15)], 30, { ...opts, targetDate: '2026-04-09' });
  assert.equal(early.daysLate, -14);
  const passed = F.estimateFinish([e('2026-02-12', 15)], 30, { ...opts, targetDate: '2026-02-01' });
  assert.equal(passed.requiredRatePerDay, null);
});

test('day arithmetic is immune to daylight saving', () => {
  assert.equal(F.daysBetween('2026-03-28', '2026-03-30'), 2); // UK clocks change 29 Mar
  assert.equal(F.fromDay(F.toDay('2026-10-25') + 1), '2026-10-26');
  assert.equal(F.toDay('nonsense'), null);
});

test('friendly descriptions', () => {
  assert.equal(F.describeIn(0), 'today');
  assert.equal(F.describeIn(1), 'tomorrow');
  assert.equal(F.describeIn(10), 'in 10 days');
  assert.equal(F.describeIn(42), 'in 6 weeks');
  assert.equal(F.describeIn(150), 'in about 5 months');
  assert.equal(F.describeIn(800), 'in about 2 years');
  assert.equal(F.describeSpan(-14), '2 weeks');
});
