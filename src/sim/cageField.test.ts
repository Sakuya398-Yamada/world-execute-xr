import { describe, expect, it } from 'vitest';
import { cageFieldLine, inducedCharge } from './cageField';

const xs = Array.from({ length: 201 }, (_, i) => -1 + i / 100);

/** 流れ関数 ψ / (E0/2) */
const psi = (x: number, rho: number, radius: number): number => {
  const r = Math.hypot(x, rho);
  return rho * rho * (1 + (2 * radius ** 3) / r ** 3);
};

describe('cageFieldLine', () => {
  it('球が無ければ、力線は軸に平行なまっすぐな線', () => {
    const pieces = cageFieldLine(0.3, 0, xs);
    expect(pieces).toHaveLength(1);
    for (const p of pieces[0] ?? []) expect(p.rho).toBe(0.3);
  });

  it('遠くでは ρ0 に戻り、どの点でも流れ関数が一定', () => {
    const radius = 0.2;
    const rho0 = 0.5;
    const pieces = cageFieldLine(rho0, radius, xs);
    expect(pieces).toHaveLength(1);
    const line = pieces[0] ?? [];
    expect(line[0]?.rho).toBeCloseTo(rho0, 1);
    for (const p of line) {
      expect(psi(p.x, p.rho, radius)).toBeCloseTo(rho0 * rho0, 6);
      expect(Math.hypot(p.x, p.rho)).toBeGreaterThanOrEqual(radius - 1e-9);
    }
  });

  it('ρ0 < √3 R の力線は球に当たって2本に分かれ、表面の点で終わる', () => {
    const radius = 0.3;
    const rho0 = 0.2;
    const pieces = cageFieldLine(rho0, radius, xs);
    expect(pieces).toHaveLength(2);
    const end = (pieces[0] ?? []).at(-1);
    const start = (pieces[1] ?? [])[0];
    expect(Math.hypot(end?.x ?? 0, end?.rho ?? 0)).toBeCloseTo(radius, 6);
    expect(Math.hypot(start?.x ?? 0, start?.rho ?? 0)).toBeCloseTo(radius, 6);
    // 球の手前(−x 側)で入り、向こう側(+x 側)から出る
    expect(end?.x).toBeLessThan(0);
    expect(start?.x).toBeGreaterThan(0);
  });

  it('表面の誘導電荷は −x 側が負、+x 側が正', () => {
    expect(inducedCharge(-0.2, 0.2)).toBeCloseTo(-3, 10);
    expect(inducedCharge(0.2, 0.2)).toBeCloseTo(3, 10);
  });
});
