import type { SpinLattice } from './spinLattice';

/** スキルミオンの芯(c 成分が負の格子点のまとまり) */
export interface SkyrmionCore {
  /** 芯の重心(格子の座標。−c 成分の大きさで重みをつける) */
  readonly x: number;
  readonly y: number;
  /** まとまりの格子点の数 */
  readonly size: number;
}

/**
 * 磁場(+c)と逆を向いた格子点のまとまりを、上下左右のつながりで探す。
 * 細長いもの(迷路状のドメインの切れ端)も1つとして数えるので、数はトポロジカル電荷と完全には一致しない。
 * @param threshold c 成分がこれより小さい格子点を芯とみなす
 * @param maxSize これより大きいまとまり(ドメイン)は芯として数えない
 */
export function findSkyrmionCores(lattice: SpinLattice, threshold = -0.5, maxSize = 40): SkyrmionCore[] {
  const { nx, ny, m } = lattice;
  const seen = new Uint8Array(nx * ny);
  const cores: SkyrmionCore[] = [];
  const stack: number[] = [];
  for (let start = 0; start < nx * ny; start++) {
    if (seen[start] === 1 || (m[start * 3 + 2] ?? 1) >= threshold) continue;
    let weight = 0;
    let sx = 0;
    let sy = 0;
    let size = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      const x = i % nx;
      const y = Math.floor(i / nx);
      const w = -(m[i * 3 + 2] ?? 0);
      weight += w;
      sx += x * w;
      sy += y * w;
      size += 1;
      const visit = (k: number): void => {
        if (seen[k] === 0 && (m[k * 3 + 2] ?? 1) < threshold) {
          seen[k] = 1;
          stack.push(k);
        }
      };
      if (x + 1 < nx) visit(i + 1);
      if (x > 0) visit(i - 1);
      if (y + 1 < ny) visit(i + nx);
      if (y > 0) visit(i - nx);
    }
    if (size <= maxSize) cores.push({ x: sx / weight, y: sy / weight, size });
  }
  return cores;
}
