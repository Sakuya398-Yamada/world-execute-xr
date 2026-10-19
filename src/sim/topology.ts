/**
 * 格子上のスピン配置のトポロジカル電荷(スキルミオン数)Q = (1/4π) ∫ m·(∂x m × ∂y m) dx dy。three.js には依存しない。
 *
 * 各プラケットを2つの三角形に分け、3つのスピンが張る球面三角形の符号つき立体角(Berg–Lüscher)を足し合わせる。
 * 連続体のときと同じく、スキルミオン1つでおおよそ ±1 になる(端の開放境界では端数が出る)。
 * スピンの並びは SpinLattice と同じ(成分 (a, b, c) × nx × ny、i = x + y × nx)。
 */

/** 3つの単位ベクトルが張る球面三角形の符号つき立体角 */
export function solidAngle(m: ArrayLike<number>, i: number, j: number, k: number): number {
  const ax = m[i * 3] ?? 0;
  const ay = m[i * 3 + 1] ?? 0;
  const az = m[i * 3 + 2] ?? 0;
  const bx = m[j * 3] ?? 0;
  const by = m[j * 3 + 1] ?? 0;
  const bz = m[j * 3 + 2] ?? 0;
  const cx = m[k * 3] ?? 0;
  const cy = m[k * 3 + 1] ?? 0;
  const cz = m[k * 3 + 2] ?? 0;
  const triple = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  const denominator = 1 + (ax * bx + ay * by + az * bz) + (bx * cx + by * cy + bz * cz) + (cx * ax + cy * ay + cz * az);
  return 2 * Math.atan2(triple, denominator);
}

/** 格子全体のトポロジカル電荷 */
export function topologicalCharge(m: ArrayLike<number>, nx: number, ny: number): number {
  let total = 0;
  for (let y = 0; y + 1 < ny; y++) {
    for (let x = 0; x + 1 < nx; x++) {
      const i = x + y * nx;
      const right = i + 1;
      const up = i + nx;
      const diagonal = i + nx + 1;
      total += solidAngle(m, i, right, diagonal) + solidAngle(m, i, diagonal, up);
    }
  }
  return total / (4 * Math.PI);
}

/** 面に垂直な成分 c の平均(磁化) */
export function meanNormal(m: ArrayLike<number>, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += m[i * 3 + 2] ?? 0;
  return sum / count;
}

/** 下を向いた(c < しきい値の)ひとかたまりのドメイン */
export interface Domain {
  /** 重心(格子の座標) */
  readonly x: number;
  readonly y: number;
  /** サイト数 */
  readonly size: number;
  /** 小さく丸い(スキルミオンの芯とみなせる)か */
  readonly compact: boolean;
  /** 格子の端に触れているか(端で切れたスキルミオンは、丸ごと1つとは数えない) */
  readonly touchesEdge: boolean;
}

/** スキルミオンの芯とみなすドメインの大きさの上限 [サイト] */
const COMPACT_MAX_SIZE = 16;

/**
 * 面に垂直な成分 c がしきい値より小さい(下を向いた)サイトを、上下左右のつながりでドメインに分ける。
 * 小さく、縦横の広がりが同じくらいのものを、スキルミオンの芯(compact)とみなす。
 */
export function findDomains(m: ArrayLike<number>, nx: number, ny: number, threshold = -0.3): Domain[] {
  const seen = new Uint8Array(nx * ny);
  const domains: Domain[] = [];
  const stack: number[] = [];
  for (let start = 0; start < nx * ny; start++) {
    if (seen[start] === 1 || (m[start * 3 + 2] ?? 1) >= threshold) continue;
    seen[start] = 1;
    stack.push(start);
    let size = 0;
    let sx = 0;
    let sy = 0;
    let minX = nx;
    let maxX = -1;
    let minY = ny;
    let maxY = -1;
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      const x = i % nx;
      const y = Math.floor(i / nx);
      size += 1;
      sx += x;
      sy += y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbors = [x + 1 < nx ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < ny ? i + nx : -1, y > 0 ? i - nx : -1];
      for (const n of neighbors) {
        if (n >= 0 && seen[n] === 0 && (m[n * 3 + 2] ?? 1) < threshold) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const compact = size <= COMPACT_MAX_SIZE && Math.max(w, h) <= 2 * Math.min(w, h) + 1;
    const touchesEdge = minX === 0 || minY === 0 || maxX === nx - 1 || maxY === ny - 1;
    domains.push({ x: sx / size, y: sy / size, size, compact, touchesEdge });
  }
  return domains;
}

/** 端に触れていない、丸ごと1つのスキルミオンの芯 */
export function skyrmionCores(domains: readonly Domain[]): Domain[] {
  return domains.filter((d) => d.compact && !d.touchesEdge);
}

export type SpinPhase = 'FM' | 'HL' | 'SkX';

/**
 * 相の目安: 下を向いたドメインが無く、ほぼ一様に上を向いていれば FM(一様な磁化)、
 * 下を向いたドメインがすべて小さく丸ければ SkX(スキルミオン)、それ以外は HL(らせん / 迷路状のドメイン)。
 */
export function classifyPhase(domains: readonly Domain[], magnetization: number): SpinPhase {
  if (domains.length === 0) return magnetization > 0.5 ? 'FM' : 'HL';
  if (domains.every((d) => d.compact) && skyrmionCores(domains).length > 0) return 'SkX';
  return 'HL';
}
