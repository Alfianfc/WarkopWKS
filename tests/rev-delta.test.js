const { test } = require('node:test');
const assert = require('node:assert/strict');

// Fungsi ini BELUM ada di kasir.html — test harus FAIL dulu.
const { revDelta } = require('./rev-delta.fixture.js');

test('naik: d=+5000 dari 10000 -> dir up, pct 50', () => {
  assert.deepEqual(revDelta(15000, 10000), { d: 5000, dir: 'up', pct: 50 });
});

test('turun: d=-3000 dari 10000 -> dir down, pct 30', () => {
  assert.deepEqual(revDelta(7000, 10000), { d: -3000, dir: 'down', pct: 30 });
});

test('tetap: sama -> dir flat, pct 0', () => {
  assert.deepEqual(revDelta(8000, 8000), { d: 0, dir: 'flat', pct: 0 });
});

test('prev nol: hindari bagi-nol -> pct null', () => {
  assert.deepEqual(revDelta(5000, 0), { d: 5000, dir: 'up', pct: null });
});

test('titik pertama (prev null): dir first', () => {
  assert.deepEqual(revDelta(5000, null), { d: null, dir: 'first', pct: null });
});
