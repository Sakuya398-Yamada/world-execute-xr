/**
 * 損失関数の曲面と、慣性つき勾配降下(heavy ball)。three.js には依存しない。
 * 座標は正規化したもの(u, v ∈ [−1, 1])。
 */

/** うねりのある椀。最小値は (0.34, −0.035) あたりにあり、いくつかの浅い窪み(局所解)を持つ */
export function loss(u: number, v: number): number {
  return 0.55 * ((u - 0.18) ** 2 + (v + 0.12) ** 2) + 0.05 * Math.cos(2.5 * Math.PI * u) * Math.cos(2.5 * Math.PI * v);
}

/** 解析的な勾配 */
export function gradient(u: number, v: number): [number, number] {
  const k = 2.5 * Math.PI;
  return [
    1.1 * (u - 0.18) - 0.05 * k * Math.sin(k * u) * Math.cos(k * v),
    1.1 * (v + 0.12) - 0.05 * k * Math.cos(k * u) * Math.sin(k * v),
  ];
}

export interface DescentOptions {
  readonly start: readonly [number, number];
  readonly steps: number;
  /** 学習率 */
  readonly eta: number;
  /** 慣性(前の一歩をどれだけ持ち越すか) */
  readonly momentum: number;
}

/** v ← μ v − η ∇f(x)、x ← x + v の軌跡(最初の点を含む steps + 1 点) */
export function heavyBall({ start, steps, eta, momentum }: DescentOptions): [number, number][] {
  let [u, v] = start;
  let du = 0;
  let dv = 0;
  const path: [number, number][] = [[u, v]];
  for (let i = 0; i < steps; i++) {
    const [gu, gv] = gradient(u, v);
    du = momentum * du - eta * gu;
    dv = momentum * dv - eta * gv;
    u += du;
    v += dv;
    path.push([u, v]);
  }
  return path;
}

/** 格子(n × n、[−1, 1]²)の上での最小値と最大値 */
export function lossRange(n: number): { min: number; max: number; argmin: [number, number] } {
  let min = Infinity;
  let max = -Infinity;
  let argmin: [number, number] = [0, 0];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const u = (i / n) * 2 - 1;
      const v = (j / n) * 2 - 1;
      const f = loss(u, v);
      if (f < min) {
        min = f;
        argmin = [u, v];
      }
      max = Math.max(max, f);
    }
  }
  return { min, max, argmin };
}
