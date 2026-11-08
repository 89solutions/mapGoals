const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/units.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('parses money in many forms', () => {
  assert.deepEqual(U.parseAmount('£3.52', 'GBP'), { value: 3.52, unit: 'GBP' });
  assert.deepEqual(U.parseAmount('3.52', 'GBP'), { value: 3.52, unit: 'GBP' });
  assert.deepEqual(U.parseAmount(' 3.52 GBP ', 'GBP'), { value: 3.52, unit: 'GBP' });
  assert.deepEqual(U.parseAmount('52p', 'GBP'), { value: 0.52, unit: 'GBP' });
  assert.deepEqual(U.parseAmount('£1,250.75', 'GBP'), { value: 1250.75, unit: 'GBP' });
  assert.deepEqual(U.parseAmount('€4,50', 'GBP'), { value: 4.5, unit: 'EUR' });
  assert.deepEqual(U.parseAmount('$20', 'GBP'), { value: 20, unit: 'USD' });
  assert.deepEqual(U.parseAmount('-£2.10', 'GBP'), { value: -2.1, unit: 'GBP' });
  assert.deepEqual(U.parseAmount('£-2.10', 'GBP'), { value: -2.1, unit: 'GBP' });
  assert.deepEqual(U.parseAmount('5 pounds', 'GBP'), { value: 5, unit: 'GBP' });
});

test('parses weights, including stones-and-pounds', () => {
  assert.deepEqual(U.parseAmount('2.5', 'lb'), { value: 2.5, unit: 'lb' });
  assert.deepEqual(U.parseAmount('5 pounds', 'kg'), { value: 5, unit: 'lb' });
  assert.deepEqual(U.parseAmount('1.2kg', 'lb'), { value: 1.2, unit: 'kg' });
  const r = U.parseAmount('2st 5lb', 'lb');
  assert.equal(r.unit, 'st');
  close(r.value, 2 + 5 / 14);
  close(U.parseAmount('1 st 7', 'st').value, 1.5);
  assert.equal(U.parseAmount('−1', 'lb').value, -1); // unicode minus
});

test('rejects nonsense and incompatible units', () => {
  assert.ok(U.parseAmount('', 'lb').error);
  assert.ok(U.parseAmount('abc', 'lb').error);
  assert.ok(U.parseAmount('3 bananas', 'lb').error);
  assert.ok(U.parseAmount('£3 2kg', 'GBP').error);
});

test('weight conversions', () => {
  close(U.convert(1, 'st', 'lb'), 14);
  close(U.convert(1, 'kg', 'lb'), 2.2046226218);
  close(U.convert(30, 'lb', 'kg'), 13.6077711);
  assert.equal(U.convert(1, 'kg', 'GBP'), null);
});

test('currency conversion uses rates', () => {
  const rates = { EUR: 1, GBP: 0.8, USD: 1.2 };
  close(U.convert(8, 'GBP', 'EUR', rates), 10);
  close(U.convert(8, 'GBP', 'USD', rates), 12);
});

test('money sums are exact to the penny', () => {
  const entries = [0.1, 0.2, 3.52, 1.1, 0.01].map((amount) => ({ amount, unit: 'GBP' }));
  assert.equal(U.sumInUnit(entries, 'GBP').total, 4.93);
  const mixed = U.sumInUnit([{ amount: 10, unit: 'GBP' }, { amount: 10, unit: 'EUR' }], 'GBP', { EUR: 1, GBP: 0.8 });
  assert.equal(mixed.total, 18);
});

test('sums mixed weight units and skips incompatible entries', () => {
  const { total, skipped } = U.sumInUnit(
    [{ amount: 1, unit: 'st' }, { amount: 2, unit: 'lb' }, { amount: 5, unit: 'GBP' }, { amount: 1 }],
    'lb'
  );
  close(total, 17);
  assert.equal(skipped.length, 1);
});

test('formats values for display', () => {
  assert.equal(U.format(3.52, 'GBP', null, { locale: 'en-GB' }), '£3.52');
  assert.equal(U.format(1250, 'USD', null, { locale: 'en-US' }), '$1,250.00');
  assert.equal(U.format(3.52, 'GBP', null, { locale: 'en-GB', signed: true }), '+£3.52');
  assert.equal(U.format(10 + 4 / 14, 'st', null, { locale: 'en-GB' }), '10 st 4 lb');
  assert.equal(U.format(15, 'lb', null, { locale: 'en-GB' }), '15 lbs');
  assert.equal(U.format(1, 'lb', null, { locale: 'en-GB' }), '1 lb');
  assert.equal(U.format(12, 'custom', 'pages', { locale: 'en-GB' }), '12 pages');
});

test('maps legacy free-text units', () => {
  assert.equal(U.unitIdFromText('lbs'), 'lb');
  assert.equal(U.unitIdFromText('£'), 'GBP');
  assert.equal(U.unitIdFromText('kg'), 'kg');
  assert.equal(U.unitIdFromText('miles'), 'mi');
  assert.equal(U.unitIdFromText('pages'), null);
});

test('"$" follows the goal currency when ambiguous', () => {
  assert.equal(U.parseAmount('$5', 'CAD').unit, 'CAD');
  assert.equal(U.parseAmount('$5', 'GBP').unit, 'USD');
  assert.equal(U.parseAmount('5 pounds', 'GBP').unit, 'GBP');
  assert.equal(U.parseAmount('5 pounds', 'st').unit, 'lb');
});

test('stones display text parses back to the same weight', () => {
  const text = U.format(30 / 14, 'st', null, { locale: 'en-GB' });
  assert.equal(text, '2 st 2 lb');
  const r = U.parseAmount(text, 'st');
  assert.ok(Math.abs(U.convert(r.value, r.unit, 'lb') - 30) < 1e-6);
});
