function revDelta(v, prev) {
  if (prev === null || prev === undefined) return { d: null, dir: 'first', pct: null };
  const d = v - prev;
  if (d === 0) return { d: 0, dir: 'flat', pct: 0 };
  const pct = prev > 0 ? Math.round(Math.abs(d) / prev * 100) : null;
  return { d, dir: d > 0 ? 'up' : 'down', pct };
}
module.exports = { revDelta };
