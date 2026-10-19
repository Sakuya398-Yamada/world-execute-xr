import { seededRandom } from './random';

/**
 * 2次元の正方格子上の古典スピン系(磁化)の緩和。three.js には依存しない。
 *
 * エネルギー: E = −J Σ m_i·m_j − D Σ d_ij·(m_i × m_j) − B Σ m_i^c
 * - 第1項: 交換相互作用(隣どうしをそろえる)
 * - 第2項: ブロッホ型のジャロシンスキー・守谷相互作用(d_ij は i から j への単位ベクトル。隣どうしをねじる)
 * - 第3項: 面に垂直な外部磁場
 * D と B の兼ね合いで、一様な磁化・迷路状のドメイン・スキルミオンが現れる。
 *
 * 時間発展は過減衰(エネルギーを下げる向きに少しずつ回す)で、歳差運動は省いている。
 * 成分は (a, b, c) で、a・b が格子の面内、c が面に垂直な向き。
 */

export interface SpinParams {
  /** 交換相互作用 */
  readonly j: number;
  /** DM 相互作用 */
  readonly d: number;
  /** 外部磁場(c 方向) */
  readonly b: number;
  /** 1ステップで回す量 */
  readonly rate: number;
}

export class SpinLattice {
  readonly nx: number;
  readonly ny: number;
  /** スピン(a, b, c)× nx × ny。i = x + y × nx */
  readonly m: Float32Array;
  private readonly next: Float32Array;
  private readonly p: SpinParams;
  private readonly seed: number;
  private stepCount = 0;

  constructor(nx: number, ny: number, p: SpinParams, seed: number) {
    this.nx = nx;
    this.ny = ny;
    this.p = p;
    this.seed = seed;
    this.m = new Float32Array(nx * ny * 3);
    this.next = new Float32Array(nx * ny * 3);
    this.reset();
  }

  get steps(): number {
    return this.stepCount;
  }

  /** 種から決まるランダムな向きに戻す */
  reset(): void {
    const random = seededRandom(this.seed);
    for (let i = 0; i < this.nx * this.ny; i++) {
      // 球面上の一様分布
      const c = random() * 2 - 1;
      const phi = random() * Math.PI * 2;
      const s = Math.sqrt(1 - c * c);
      this.m[i * 3] = s * Math.cos(phi);
      this.m[i * 3 + 1] = s * Math.sin(phi);
      this.m[i * 3 + 2] = c;
    }
    this.stepCount = 0;
  }

  /**
   * 1ステップ緩和させる。
   * @param field 外部磁場(c 方向)。省略時はパラメータの b。時間とともに磁場を変えるときに使う
   */
  step(field?: number): void {
    const { nx, ny, m, next } = this;
    const { j, d, rate } = this.p;
    const b = field ?? this.p.b;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = (x + y * nx) * 3;
        let ha = 0;
        let hb = 0;
        let hc = b;
        // 隣(端は開放境界)。d_ij = (da, db, 0) のとき、m_j × d_ij = (−mc·db, mc·da, ma·db − mb·da)
        const neighbor = (k: number, da: number, db: number): void => {
          const ma = m[k] ?? 0;
          const mb = m[k + 1] ?? 0;
          const mc = m[k + 2] ?? 0;
          ha += j * ma - d * mc * db;
          hb += j * mb + d * mc * da;
          hc += j * mc + d * (ma * db - mb * da);
        };
        if (x + 1 < nx) neighbor(i + 3, 1, 0);
        if (x > 0) neighbor(i - 3, -1, 0);
        if (y + 1 < ny) neighbor(i + nx * 3, 0, 1);
        if (y > 0) neighbor(i - nx * 3, 0, -1);

        let a = (m[i] ?? 0) + rate * ha;
        let bb = (m[i + 1] ?? 0) + rate * hb;
        let c = (m[i + 2] ?? 0) + rate * hc;
        const norm = Math.hypot(a, bb, c) || 1;
        a /= norm;
        bb /= norm;
        c /= norm;
        next[i] = a;
        next[i + 1] = bb;
        next[i + 2] = c;
      }
    }
    m.set(next);
    this.stepCount += 1;
  }

  /**
   * 1スピンあたりのエネルギー E/N。
   * @param field 外部磁場。省略時はパラメータの b
   */
  energy(field?: number): number {
    const { nx, ny, m } = this;
    const { j, d } = this.p;
    const b = field ?? this.p.b;
    let e = 0;
    // 各ボンドを1回ずつ数える(右と下の隣だけ)
    const bond = (i: number, k: number, da: number, db: number): number => {
      const [a1, b1, c1] = [m[i] ?? 0, m[i + 1] ?? 0, m[i + 2] ?? 0];
      const [a2, b2, c2] = [m[k] ?? 0, m[k + 1] ?? 0, m[k + 2] ?? 0];
      // d_ij·(m_i × m_j)。d_ij = (da, db, 0)
      const cross = da * (b1 * c2 - c1 * b2) + db * (c1 * a2 - a1 * c2);
      return -j * (a1 * a2 + b1 * b2 + c1 * c2) - d * cross;
    };
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = (x + y * nx) * 3;
        if (x + 1 < nx) e += bond(i, i + 3, 1, 0);
        if (y + 1 < ny) e += bond(i, i + nx * 3, 0, 1);
        e -= b * (m[i + 2] ?? 0);
      }
    }
    return e / (nx * ny);
  }

  /**
   * トポロジカル電荷(スキルミオン数)Q = (1/4π) Σ m·(∂x m × ∂y m) の格子版。
   * 各格子の正方形を2つの三角形に分け、3つのスピンが張る立体角(符号つき)を足し合わせる(Berg–Lüscher の方法)。
   * 磁場の向き(+c)の中に、芯が −c を向いたスキルミオンが1つあると Q = −1。
   */
  topologicalCharge(): number {
    const { nx, ny } = this;
    let omega = 0;
    for (let y = 0; y + 1 < ny; y++) {
      for (let x = 0; x + 1 < nx; x++) {
        const i00 = (x + y * nx) * 3;
        const i10 = i00 + 3;
        const i01 = i00 + nx * 3;
        const i11 = i01 + 3;
        omega += this.solidAngle(i00, i10, i11) + this.solidAngle(i00, i11, i01);
      }
    }
    return omega / (4 * Math.PI);
  }

  /** 3つのスピンが単位球面上に張る三角形の、符号つきの立体角 */
  private solidAngle(i: number, k: number, l: number): number {
    const m = this.m;
    const [a1, b1, c1] = [m[i] ?? 0, m[i + 1] ?? 0, m[i + 2] ?? 0];
    const [a2, b2, c2] = [m[k] ?? 0, m[k + 1] ?? 0, m[k + 2] ?? 0];
    const [a3, b3, c3] = [m[l] ?? 0, m[l + 1] ?? 0, m[l + 2] ?? 0];
    const triple = a1 * (b2 * c3 - c2 * b3) + b1 * (c2 * a3 - a2 * c3) + c1 * (a2 * b3 - b2 * a3);
    const dot = 1 + (a1 * a2 + b1 * b2 + c1 * c2) + (a2 * a3 + b2 * b3 + c2 * c3) + (a3 * a1 + b3 * b1 + c3 * c1);
    return 2 * Math.atan2(triple, dot);
  }
}
