import { describe, expect, it } from 'vitest';
import { covariance3, symmetricEigen2, symmetricEigen3, type Mat3 } from './pca';
import { seededRandom } from './random';

const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, k) => s + x * (b[k] ?? 0), 0);

/** 行列 A と固有分解から A v = λ v を確かめる */
function residual(m: Mat3, value: number, v: readonly number[]): number {
  let worst = 0;
  for (let r = 0; r < 3; r++) {
    const av = (m[r * 3] ?? 0) * (v[0] ?? 0) + (m[r * 3 + 1] ?? 0) * (v[1] ?? 0) + (m[r * 3 + 2] ?? 0) * (v[2] ?? 0);
    worst = Math.max(worst, Math.abs(av - value * (v[r] ?? 0)));
  }
  return worst;
}

describe('symmetricEigen3', () => {
  it('対角行列は、そのまま大きい順に並ぶ', () => {
    const { values, vectors } = symmetricEigen3([2, 0, 0, 0, 5, 0, 0, 0, 1]);
    expect(values).toEqual([5, 2, 1]);
    expect(Math.abs(vectors[0][1])).toBeCloseTo(1);
    expect(Math.abs(vectors[1][0])).toBeCloseTo(1);
    expect(Math.abs(vectors[2][2])).toBeCloseTo(1);
  });

  it('一般の対称行列で A v = λ v、固有ベクトルは正規直交', () => {
    const m = [4, 1, -2, 1, 3, 0.5, -2, 0.5, 6];
    const { values, vectors } = symmetricEigen3(m);
    expect(values[0]).toBeGreaterThanOrEqual(values[1]);
    expect(values[1]).toBeGreaterThanOrEqual(values[2]);
    // 固有値の和はトレース
    expect(values[0] + values[1] + values[2]).toBeCloseTo(13, 10);
    vectors.forEach((v, i) => {
      expect(residual(m, values[i] ?? 0, v)).toBeLessThan(1e-9);
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    });
    expect(dot(vectors[0], vectors[1])).toBeCloseTo(0, 10);
    expect(dot(vectors[0], vectors[2])).toBeCloseTo(0, 10);
    expect(dot(vectors[1], vectors[2])).toBeCloseTo(0, 10);
  });
});

describe('covariance3', () => {
  it('既知の向きと広がりの正規分布から、主成分を取り戻せる', () => {
    const random = seededRandom(1);
    const gaussian = (): number => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    // 主成分の向き: (1, 1, 0)/√2、(−1, 1, 0)/√2、(0, 0, 1)。標準偏差 3, 1, 0.3
    const s = Math.SQRT1_2;
    const points: number[] = [];
    for (let i = 0; i < 20000; i++) {
      const [a, b, c] = [gaussian() * 3, gaussian(), gaussian() * 0.3];
      points.push(10 + s * a - s * b, -5 + s * a + s * b, 2 + c);
    }
    const { mean, cov } = covariance3(points);
    expect(mean[0]).toBeCloseTo(10, 1);
    expect(mean[1]).toBeCloseTo(-5, 1);
    const { values, vectors } = symmetricEigen3(cov);
    expect(values[0]).toBeCloseTo(9, 0);
    expect(values[1]).toBeCloseTo(1, 1);
    expect(values[2]).toBeCloseTo(0.09, 2);
    expect(Math.abs(vectors[0][0] * s + vectors[0][1] * s)).toBeCloseTo(1, 2);
    expect(Math.abs(vectors[2][2])).toBeCloseTo(1, 3);
  });
});

describe('symmetricEigen2', () => {
  it('回転した楕円の軸', () => {
    // 軸 (cos30°, sin30°) に分散 4、直交方向に分散 1
    const t = Math.PI / 6;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const a = 4 * c * c + s * s;
    const b = (4 - 1) * c * s;
    const d = 4 * s * s + c * c;
    const { major, minor, angle } = symmetricEigen2(a, b, d);
    expect(major).toBeCloseTo(4, 12);
    expect(minor).toBeCloseTo(1, 12);
    expect(angle).toBeCloseTo(t, 12);
  });
});
