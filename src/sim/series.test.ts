import { describe, expect, it } from 'vitest';
import { BASEL_LIMIT, archimedesPi, baselPartialSums } from './series';

describe('archimedesPi', () => {
  it('六角形から始めて、内接・外接が三角関数の値と一致する', () => {
    for (const { sides, lower, upper } of archimedesPi(6)) {
      expect(lower).toBeCloseTo(sides * Math.sin(Math.PI / sides), 12);
      expect(upper).toBeCloseTo(sides * Math.tan(Math.PI / sides), 12);
      expect(lower).toBeLessThan(Math.PI);
      expect(upper).toBeGreaterThan(Math.PI);
    }
  });

  it('96角形でアルキメデスの評価 3 + 10/71 < π < 3 + 1/7 の範囲に入る', () => {
    const last = archimedesPi(4).at(-1);
    expect(last?.sides).toBe(96);
    expect(last?.lower).toBeGreaterThan(3 + 10 / 71);
    expect(last?.upper).toBeLessThan(3 + 1 / 7);
  });
});

describe('baselPartialSums', () => {
  it('部分和は増え続け、π²/6 との差はおよそ 1/n', () => {
    const sums = baselPartialSums(1000);
    expect(sums[0]).toBe(1);
    expect(sums[1]).toBeCloseTo(1.25, 12);
    for (let i = 1; i < sums.length; i++) expect(sums[i]).toBeGreaterThan(sums[i - 1] ?? 0);
    const gap = BASEL_LIMIT - (sums[999] ?? 0);
    expect(gap).toBeGreaterThan(0);
    // 尾の和は 1/(n+1) と 1/n の間
    expect(gap).toBeGreaterThan(1 / 1001);
    expect(gap).toBeLessThan(1 / 1000);
  });
});
