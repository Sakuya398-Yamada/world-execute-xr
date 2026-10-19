/**
 * 主成分分析(3次元)。three.js には依存しない。
 * 共分散行列を作り、ヤコビ法で固有分解する。固有値の大きい順が第1・第2・第3主成分。
 */

export type Vec3 = readonly [number, number, number];
/** 3 × 3 の対称行列(行優先で9要素) */
export type Mat3 = readonly number[];

export interface Covariance {
  readonly mean: Vec3;
  /** 不偏共分散(行優先) */
  readonly cov: Mat3;
}

export interface Eigen3 {
  /** 固有値(大きい順) */
  readonly values: Vec3;
  /** 単位固有ベクトル(values と同じ順) */
  readonly vectors: readonly [Vec3, Vec3, Vec3];
}

/** points は [x0, y0, z0, x1, y1, z1, ...] */
export function covariance3(points: ArrayLike<number>): Covariance {
  const n = Math.floor(points.length / 3);
  if (n < 2) throw new Error('covariance3: 点が2つ以上必要です');
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) mean[k] = (mean[k] ?? 0) + (points[i * 3 + k] ?? 0) / n;
  }
  const cov = Array.from({ length: 9 }, () => 0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 3; r++) {
      const dr = (points[i * 3 + r] ?? 0) - (mean[r] ?? 0);
      for (let c = r; c < 3; c++) {
        const dc = (points[i * 3 + c] ?? 0) - (mean[c] ?? 0);
        cov[r * 3 + c] = (cov[r * 3 + c] ?? 0) + (dr * dc) / (n - 1);
      }
    }
  }
  // 下三角は上三角の写し
  cov[3] = cov[1] ?? 0;
  cov[6] = cov[2] ?? 0;
  cov[7] = cov[5] ?? 0;
  return { mean: [mean[0] ?? 0, mean[1] ?? 0, mean[2] ?? 0], cov };
}

/**
 * 対称行列のヤコビ法による固有分解。非対角成分が最大のところを回転で消すことを、十分小さくなるまで繰り返す。
 */
export function symmetricEigen3(m: Mat3, tolerance = 1e-12, maxSweeps = 50): Eigen3 {
  const a = Array.from({ length: 9 }, (_, i) => m[i] ?? 0);
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const at = (r: number, c: number): number => a[r * 3 + c] ?? 0;

  for (let sweep = 0; sweep < maxSweeps * 3; sweep++) {
    // 絶対値が最大の非対角成分 (p, q)
    let p = 0;
    let q = 1;
    for (const [r, c] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(at(r, c)) > Math.abs(at(p, q))) {
        p = r;
        q = c;
      }
    }
    const apq = at(p, q);
    const scale = Math.abs(at(0, 0)) + Math.abs(at(1, 1)) + Math.abs(at(2, 2)) || 1;
    if (Math.abs(apq) <= tolerance * scale) break;

    // a'_pq = 0 になる回転角 θ: tan 2θ = 2 a_pq / (a_qq − a_pp)
    const theta = 0.5 * Math.atan2(2 * apq, at(q, q) - at(p, p));
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // A ← Jᵀ A J(J は p, q 平面の回転)
    for (let k = 0; k < 3; k++) {
      const akp = at(k, p);
      const akq = at(k, q);
      a[k * 3 + p] = cos * akp - sin * akq;
      a[k * 3 + q] = sin * akp + cos * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = at(p, k);
      const aqk = at(q, k);
      a[p * 3 + k] = cos * apk - sin * aqk;
      a[q * 3 + k] = sin * apk + cos * aqk;
    }
    // V ← V J(列が固有ベクトル)
    for (let k = 0; k < 3; k++) {
      const vkp = v[k * 3 + p] ?? 0;
      const vkq = v[k * 3 + q] ?? 0;
      v[k * 3 + p] = cos * vkp - sin * vkq;
      v[k * 3 + q] = sin * vkp + cos * vkq;
    }
  }

  const order = [0, 1, 2].toSorted((i, j) => at(j, j) - at(i, i));
  const column = (c: number): Vec3 => [v[c] ?? 0, v[3 + c] ?? 0, v[6 + c] ?? 0];
  const [i0 = 0, i1 = 1, i2 = 2] = order;
  return {
    values: [at(i0, i0), at(i1, i1), at(i2, i2)],
    vectors: [column(i0), column(i1), column(i2)],
  };
}

/**
 * 2 × 2 の対称行列 [[a, b], [b, c]] の固有分解(床への射影の楕円に使う)。
 * @returns 大きい方の固有値、小さい方の固有値、大きい方の固有ベクトルの角度 [rad]
 */
export function symmetricEigen2(a: number, b: number, c: number): { major: number; minor: number; angle: number } {
  const mid = (a + c) / 2;
  const radius = Math.hypot((a - c) / 2, b);
  return { major: mid + radius, minor: mid - radius, angle: 0.5 * Math.atan2(2 * b, a - c) };
}
