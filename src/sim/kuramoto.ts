/**
 * 蔵本モデル(結合振動子の位相同期)。three.js には依存しない。
 *
 * dφ_i/dt = ω_i + K r sin(ψ − φ_i) + F sin(Ω t − φ_i)
 * - r e^(iψ) = (1/N) Σ e^(iφ_j) は秩序変数(平均場)。r = 0 でばらばら、r = 1 で完全に同期
 * - 第3項は外からの周期的な駆動(ペースメーカー)。全体を Ω の位相に引き込む
 *
 * 固定刻み h で4次のルンゲ=クッタ法で積分する。時刻は h の整数倍の格子上を進むので、
 * フレームレートに関係なく同じ時刻では同じ状態になる。
 */

export interface KuramotoDrive {
  /** 結合の強さ K [rad/s] */
  readonly k: number;
  /** 駆動の強さ F [rad/s] */
  readonly f: number;
  /** 駆動の角振動数 Ω [rad/s] */
  readonly omega: number;
}

export interface OrderParameter {
  /** 0〜1 */
  readonly r: number;
  /** 平均の位相 ψ [rad] */
  readonly psi: number;
}

export function orderParameter(phases: ArrayLike<number>): OrderParameter {
  let re = 0;
  let im = 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i] ?? 0;
    re += Math.cos(p);
    im += Math.sin(p);
  }
  const n = Math.max(phases.length, 1);
  return { r: Math.hypot(re, im) / n, psi: Math.atan2(im, re) };
}

export class KuramotoSim {
  /** 固有角振動数 ω_i [rad/s] */
  readonly omegas: Float64Array;
  /** 位相 φ_i [rad](折り返さずに積算する) */
  readonly phases: Float64Array;
  private readonly initial: Float64Array;
  /** 積分の刻み [s] */
  readonly h: number;
  private step = 0;
  private readonly k1: Float64Array;
  private readonly k2: Float64Array;
  private readonly k3: Float64Array;
  private readonly k4: Float64Array;
  private readonly tmp: Float64Array;

  constructor(omegas: ArrayLike<number>, initial: ArrayLike<number>, h: number) {
    if (omegas.length !== initial.length) throw new Error('omegas と initial の数が違います');
    this.omegas = Float64Array.from(omegas);
    this.initial = Float64Array.from(initial);
    this.phases = Float64Array.from(initial);
    this.h = h;
    const n = omegas.length;
    this.k1 = new Float64Array(n);
    this.k2 = new Float64Array(n);
    this.k3 = new Float64Array(n);
    this.k4 = new Float64Array(n);
    this.tmp = new Float64Array(n);
  }

  get time(): number {
    return this.step * this.h;
  }

  reset(): void {
    this.phases.set(this.initial);
    this.step = 0;
  }

  /** 1刻み進める。drive はその刻みの間の結合と駆動(刻みの頭の時刻で決めたもの) */
  advance(drive: KuramotoDrive): void {
    const { phases, h, k1, k2, k3, k4, tmp } = this;
    const t = this.time;
    this.derivative(phases, t, drive, k1);
    this.offset(phases, k1, h / 2, tmp);
    this.derivative(tmp, t + h / 2, drive, k2);
    this.offset(phases, k2, h / 2, tmp);
    this.derivative(tmp, t + h / 2, drive, k3);
    this.offset(phases, k3, h, tmp);
    this.derivative(tmp, t + h, drive, k4);
    for (let i = 0; i < phases.length; i++) {
      phases[i] = (phases[i] ?? 0) + (h / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0));
    }
    this.step += 1;
  }

  private offset(base: Float64Array, slope: Float64Array, scale: number, out: Float64Array): void {
    for (let i = 0; i < base.length; i++) out[i] = (base[i] ?? 0) + scale * (slope[i] ?? 0);
  }

  private derivative(phases: Float64Array, t: number, drive: KuramotoDrive, out: Float64Array): void {
    const { r, psi } = orderParameter(phases);
    const external = drive.omega * t;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i] ?? 0;
      out[i] = (this.omegas[i] ?? 0) + drive.k * r * Math.sin(psi - p) + drive.f * Math.sin(external - p);
    }
  }
}
