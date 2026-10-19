import { describe, expect, it } from 'vitest';
import { SpinLattice } from './spinLattice';

const params = { j: 1, d: 1.2, b: 0.5, rate: 0.15 };

/** 格子の中心に、芯が −c を向いたスキルミオンを1つ置く(背景は +c)。helicity 0 でネール型、±π/2 でブロッホ型 */
function placeSkyrmion(lattice: SpinLattice, radius: number, helicity: number): void {
  const { nx, ny, m } = lattice;
  const cx = (nx - 1) / 2;
  const cy = (ny - 1) / 2;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const r = Math.hypot(x - cx, y - cy);
      const theta = r < radius ? Math.PI * (1 - r / radius) : 0;
      const phi = Math.atan2(y - cy, x - cx) + helicity;
      const i = (x + y * nx) * 3;
      m[i] = Math.sin(theta) * Math.cos(phi);
      m[i + 1] = Math.sin(theta) * Math.sin(phi);
      m[i + 2] = Math.cos(theta);
    }
  }
}

function fill(lattice: SpinLattice, a: number, b: number, c: number): void {
  for (let i = 0; i < lattice.nx * lattice.ny; i++) lattice.m.set([a, b, c], i * 3);
}

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

  it('step の field でパラメータの磁場を上書きできる', () => {
    const lattice = new SpinLattice(6, 6, { j: 1, d: 0, b: 1, rate: 0.2 }, 3);
    for (let k = 0; k < 400; k++) lattice.step(-1);
    for (let i = 0; i < 36; i++) expect(lattice.m[i * 3 + 2]).toBeLessThan(-0.99);
  });

  it('一様な状態のエネルギーは、ボンドの数と磁場から決まる', () => {
    const lattice = new SpinLattice(5, 4, { j: 1, d: 0.7, b: 0.3, rate: 0.1 }, 1);
    fill(lattice, 0, 0, 1);
    const bonds = 4 * 4 + 5 * 3;
    // 平行なスピンどうしの外積は 0 なので、DM 相互作用は効かない
    expect(lattice.energy()).toBeCloseTo((-bonds - 0.3 * 20) / 20, 10);
    expect(lattice.energy(-0.3)).toBeCloseTo((-bonds + 0.3 * 20) / 20, 10);
  });

  it('一様な状態のトポロジカル電荷は 0、スキルミオン1つなら −1', () => {
    const lattice = new SpinLattice(25, 25, params, 1);
    fill(lattice, 0, 0, 1);
    expect(lattice.topologicalCharge()).toBeCloseTo(0, 10);
    placeSkyrmion(lattice, 8, Math.PI / 2);
    expect(lattice.topologicalCharge()).toBeCloseTo(-1, 2);
    placeSkyrmion(lattice, 8, 0);
    expect(lattice.topologicalCharge()).toBeCloseTo(-1, 2);
  });

  it('この DM 相互作用ではブロッホ型の片方の向きが一番低いエネルギーになる', () => {
    const lattice = new SpinLattice(25, 25, { j: 1, d: 1, b: 0, rate: 0.1 }, 1);
    const energyOf = (helicity: number): number => {
      placeSkyrmion(lattice, 8, helicity);
      return lattice.energy();
    };
    const neel = energyOf(0);
    const bloch = Math.min(energyOf(Math.PI / 2), energyOf(-Math.PI / 2));
    expect(bloch).toBeLessThan(neel);
    expect(energyOf(Math.PI)).toBeCloseTo(neel, 10);
  });
});
