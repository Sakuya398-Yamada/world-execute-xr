/**
 * ブリッジ全波整流回路 + 平滑コンデンサの波形計算。three.js には依存しない。
 *
 * 回路: 交流電源 → ブリッジ(D1〜D4) → [スイッチ + C] ∥ R
 * - 電源側の直列抵抗 Rs(トランス巻線 + ダイオードの抵抗をまとめたもの)を入れている。
 *   Rs = 0 だとコンデンサが一瞬で充電されてしまい、接続直後の充電の過渡が見えないため。
 * - ダイオードは順方向電圧 Vf の理想ダイオードとして扱う。
 */

export interface RectifierParams {
  /** 入力正弦波の振幅 [V] */
  readonly vPeak: number;
  /** 入力周波数 [Hz]。実際の商用周波数ではなく、目で追える見た目用の値 */
  readonly freqHz: number;
  /** ダイオード1本あたりの順方向電圧 [V] */
  readonly vf: number;
  /** 負荷抵抗 [Ω] */
  readonly r: number;
  /** 電源側の直列抵抗 [Ω] */
  readonly rs: number;
  /** 平滑コンデンサ [F] */
  readonly c: number;
}

export interface RectifierSample {
  /** 回路上の時刻 [s] */
  readonly t: number;
  /** 入力電圧 [V] */
  readonly vIn: number;
  /** 出力(負荷)電圧 [V] */
  readonly vOut: number;
  /** ブリッジを流れる電流 [A]。0 なら全ダイオードが非導通 */
  readonly iBridge: number;
}

export function inputVoltage(p: RectifierParams, t: number): number {
  return p.vPeak * Math.sin(2 * Math.PI * p.freqHz * t);
}

/** ブリッジの出力側に現れる開放電圧(全波整流後の脈流) */
export function rectifiedVoltage(p: RectifierParams, vIn: number): number {
  return Math.max(Math.abs(vIn) - 2 * p.vf, 0);
}

/** コンデンサ無しのときの出力電圧(Rs と R の分圧) */
export function unsmoothedOutput(p: RectifierParams, vIn: number): number {
  return (rectifiedVoltage(p, vIn) * p.r) / (p.r + p.rs);
}

/**
 * 固定刻み h で回路を時間発展させる。
 * 時刻は常に h の整数倍の格子上を進むので、フレームレートに関係なく同じ時刻では同じ波形になる。
 */
export class RectifierSim {
  private readonly p: RectifierParams;
  /** 積分の刻み [s] */
  readonly h: number;
  private step = 0;
  /** コンデンサの電圧 [V](スイッチが開いている間も保持) */
  private vCap = 0;
  private last: RectifierSample = { t: 0, vIn: 0, vOut: 0, iBridge: 0 };

  constructor(p: RectifierParams, h: number) {
    this.p = p;
    this.h = h;
  }

  /** reset からの刻み数 */
  get steps(): number {
    return this.step;
  }

  get time(): number {
    return this.step * this.h;
  }

  get latest(): RectifierSample {
    return this.last;
  }

  reset(): void {
    this.step = 0;
    this.vCap = 0;
    this.last = { t: 0, vIn: 0, vOut: 0, iBridge: 0 };
  }

  /** 1刻み進める。capacitorOn はその刻みの間スイッチが閉じているかどうか */
  advance(capacitorOn: boolean): RectifierSample {
    const { p, h } = this;
    this.step += 1;
    const t = this.step * h;
    const vIn = inputVoltage(p, t);
    const vRect = rectifiedVoltage(p, vIn);

    if (!capacitorOn) {
      const vOut = unsmoothedOutput(p, vIn);
      this.last = { t, vIn, vOut, iBridge: vRect / (p.r + p.rs) };
      return this.last;
    }

    // 導通中:   C dv/dt = (vRect − v)/Rs − v/R
    // 非導通中: C dv/dt = −v/R
    // どちらも陰的オイラー法で解く(刻みに対して時定数が小さくても発散しない)
    const charging = vRect > this.vCap;
    const gLoad = h / (p.r * p.c);
    const vNext = charging
      ? (this.vCap + (h * vRect) / (p.rs * p.c)) / (1 + h / (p.rs * p.c) + gLoad)
      : this.vCap / (1 + gLoad);
    this.vCap = vNext;
    this.last = {
      t,
      vIn,
      vOut: vNext,
      iBridge: charging ? Math.max(vRect - vNext, 0) / p.rs : 0,
    };
    return this.last;
  }
}
