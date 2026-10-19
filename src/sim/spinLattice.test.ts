import { describe, expect, it } from 'vitest';
import { SpinLattice } from './spinLattice';

const params = { j: 1, d: 1.2, b: 0.5, rate: 0.15 };

describe('SpinLattice', () => {
  it('ステップを進めてもスピンの長さは 1 のまま', () => {
    const lattice = new SpinLattice(8, 6, params, 1);
    for (let k = 0; k < 50; k++) lattice.step();
    for (let i = 0; i < 8 * 6; i++) {
      expect(Math.hypot(lattice.m[i * 3] ?? 0, lattice.m[i * 3 + 1] ?? 0, lattice.m[i * 3 + 2] ?? 0)).toBeCloseTo(1, 5);
    }
    expect(lattice.steps).toBe(50);
  });

  it('同じ種なら、reset して同じだけ進めると同じ状態になる', () => {
    const lattice = new SpinLattice(8, 6, params, 7);
    for (let k = 0; k < 20; k++) lattice.step();
    const first = Float32Array.from(lattice.m);
    lattice.reset();
    for (let k = 0; k < 20; k++) lattice.step();
    expect(lattice.m).toEqual(first);
  });

  it('DM 相互作用が無く磁場だけなら、磁場の向き(c)にそろう', () => {
    const lattice = new SpinLattice(6, 6, { j: 1, d: 0, b: 1, rate: 0.2 }, 3);
    for (let k = 0; k < 400; k++) lattice.step();
    for (let i = 0; i < 36; i++) expect(lattice.m[i * 3 + 2]).toBeGreaterThan(0.99);
  });
});
