import { describe, expect, it } from 'vitest';
import { contourSegments } from './contour';
import { gradient, heavyBall, loss, lossRange } from './descent';

describe('descent', () => {
  it('解析的な勾配は数値微分と一致する', () => {
    const h = 1e-5;
    for (const [u, v] of [[-0.7, 0.4], [0.1, -0.3], [0.5, 0.9]] as const) {
      const [gu, gv] = gradient(u, v);
      expect(gu).toBeCloseTo((loss(u + h, v) - loss(u - h, v)) / (2 * h), 5);
      expect(gv).toBeCloseTo((loss(u, v + h) - loss(u, v - h)) / (2 * h), 5);
    }
  });

  it('慣性つき勾配降下は、角から始めても大域的な最小値にたどり着く', () => {
    const path = heavyBall({ start: [-0.85, 0.82], steps: 160, eta: 0.012, momentum: 0.86 });
    const [u, v] = path[path.length - 1] ?? [0, 0];
    const { min, argmin } = lossRange(400);
    expect(path).toHaveLength(161);
    expect(loss(u, v) - min).toBeLessThan(1e-3);
    expect(Math.hypot(u - argmin[0], v - argmin[1])).toBeLessThan(0.03);
  });
});

describe('contourSegments', () => {
  it('f = x² + y² の等高線は円になる', () => {
    const n = 40;
    const values: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) values.push(((i - n / 2) / (n / 2)) ** 2 + ((j - n / 2) / (n / 2)) ** 2);
    }
    const segments = contourSegments(values, n, n, 0.25);
    expect(segments.length).toBeGreaterThan(0);
    for (let k = 0; k < segments.length; k += 2) {
      const x = ((segments[k] ?? 0) - n / 2) / (n / 2);
      const y = ((segments[k + 1] ?? 0) - n / 2) / (n / 2);
      expect(Math.hypot(x, y)).toBeCloseTo(0.5, 2);
    }
  });

  it('範囲の外の値なら線は出ない', () => {
    expect(contourSegments([0, 0, 0, 0], 1, 1, 1)).toEqual([]);
  });
});
