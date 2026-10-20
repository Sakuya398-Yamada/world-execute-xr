/**
 * 等高線(マーチングスクエア)。three.js には依存しない。
 * 格子 (nx + 1) × (ny + 1) 点の値から、値が level になる線分を返す。座標は格子の添字(0〜nx, 0〜ny)。
 */

/** 線分 [x0, y0, x1, y1] の並び */
export type Segments = number[];

/**
 * @param values values[i + j × (nx + 1)] が格子点 (i, j) の値
 */
export function contourSegments(values: ArrayLike<number>, nx: number, ny: number, level: number): Segments {
  const out: Segments = [];
  const at = (i: number, j: number): number => values[i + j * (nx + 1)] ?? 0;
  // 辺の上で値が level になる位置(線形補間)
  const cross = (a: number, b: number): number => (level - a) / (b - a);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v11 = at(i + 1, j + 1);
      const v01 = at(i, j + 1);
      // 4つの角が level より上かどうかで、等高線が通る辺を決める
      const points: [number, number][] = [];
      if (v00 >= level !== v10 >= level) points.push([i + cross(v00, v10), j]);
      if (v10 >= level !== v11 >= level) points.push([i + 1, j + cross(v10, v11)]);
      if (v01 >= level !== v11 >= level) points.push([i + cross(v01, v11), j + 1]);
      if (v00 >= level !== v01 >= level) points.push([i, j + cross(v00, v01)]);
      if (points.length === 2) {
        const [p, q] = points;
        if (p !== undefined && q !== undefined) out.push(p[0], p[1], q[0], q[1]);
      } else if (points.length === 4) {
        // 鞍点: 中心の値で、どちらの組み合わせでつなぐかを決める
        const center = (v00 + v10 + v11 + v01) / 4;
        const [p0, p1, p2, p3] = points;
        if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) continue;
        if (center >= level === v00 >= level) {
          out.push(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
        } else {
          out.push(p0[0], p0[1], p3[0], p3[1], p1[0], p1[1], p2[0], p2[1]);
        }
      }
    }
  }
  return out;
}
