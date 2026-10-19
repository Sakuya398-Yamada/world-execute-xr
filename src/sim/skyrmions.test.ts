import { describe, expect, it } from 'vitest';
import { findSkyrmionCores } from './skyrmions';
import { SpinLattice } from './spinLattice';

/** (cx, cy) を中心に、芯が −c を向いた円形の領域を作る(背景は +c) */
function paintCore(lattice: SpinLattice, cx: number, cy: number, radius: number): void {
  for (let y = 0; y < lattice.ny; y++) {
    for (let x = 0; x < lattice.nx; x++) {
      if (Math.hypot(x - cx, y - cy) <= radius) lattice.m.set([0, 0, -1], (x + y * lattice.nx) * 3);
    }
  }
}

describe('findSkyrmionCores', () => {
  it('離れた芯を別々に見つけ、重心を返す', () => {
    const lattice = new SpinLattice(20, 12, { j: 1, d: 1, b: 0, rate: 0.1 }, 1);
    for (let i = 0; i < 20 * 12; i++) lattice.m.set([0, 0, 1], i * 3);
    paintCore(lattice, 4, 5, 1.5);
    paintCore(lattice, 14, 7, 1.5);
    const cores = findSkyrmionCores(lattice).toSorted((a, b) => a.x - b.x);
    expect(cores).toHaveLength(2);
    expect(cores[0]?.x).toBeCloseTo(4, 5);
    expect(cores[0]?.y).toBeCloseTo(5, 5);
    expect(cores[1]?.x).toBeCloseTo(14, 5);
    expect(cores[1]?.y).toBeCloseTo(7, 5);
  });

  it('大きすぎるまとまり(ドメイン)は芯として数えない', () => {
    const lattice = new SpinLattice(20, 12, { j: 1, d: 1, b: 0, rate: 0.1 }, 1);
    for (let i = 0; i < 20 * 12; i++) lattice.m.set([0, 0, 1], i * 3);
    paintCore(lattice, 10, 6, 5);
    expect(findSkyrmionCores(lattice, -0.5, 40)).toHaveLength(0);
  });
});
