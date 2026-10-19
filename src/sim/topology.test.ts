import { describe, expect, it } from 'vitest';
import { classifyPhase, findDomains, meanNormal, skyrmionCores, solidAngle, topologicalCharge } from './topology';

/** 格子の中心に、芯が下を向いたスキルミオン(ブロッホ型)を1つ置いた配置 */
function skyrmion(nx: number, ny: number, radius: number, polarity = 1): Float32Array {
  const m = new Float32Array(nx * ny * 3);
  const cx = (nx - 1) / 2;
  const cy = (ny - 1) / 2;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      // 中心で θ = π(下向き)、外側で θ = 0(上向き)
      const theta = Math.PI * Math.exp(-((r / radius) ** 2));
      const phi = Math.atan2(dy, dx) + Math.PI / 2;
      const i = (x + y * nx) * 3;
      m[i] = Math.sin(theta) * Math.cos(phi);
      m[i + 1] = Math.sin(theta) * Math.sin(phi);
      m[i + 2] = polarity * Math.cos(theta);
    }
  }
  return m;
}

describe('topology', () => {
  it('3本の直交する単位ベクトルの立体角は π/2(球面の 1/8)', () => {
    const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(solidAngle(m, 0, 1, 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(solidAngle(m, 0, 2, 1)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('一様な磁化のトポロジカル電荷は 0', () => {
    const m = new Float32Array(10 * 10 * 3);
    for (let i = 0; i < 100; i++) m[i * 3 + 2] = 1;
    expect(topologicalCharge(m, 10, 10)).toBeCloseTo(0, 6);
    expect(meanNormal(m, 100)).toBe(1);
    expect(findDomains(m, 10, 10)).toEqual([]);
  });

  it('スキルミオン1つで |Q| = 1、向きを反転すると符号が変わる', () => {
    const q = topologicalCharge(skyrmion(24, 24, 4), 24, 24);
    expect(Math.abs(q)).toBeCloseTo(1, 1);
    expect(topologicalCharge(skyrmion(24, 24, 4, -1), 24, 24)).toBeCloseTo(-q, 6);
  });

  it('スキルミオンの芯は小さく丸いドメインとして1つ見つかり、SkX と判定される', () => {
    const m = skyrmion(24, 24, 3);
    const domains = findDomains(m, 24, 24);
    expect(domains).toHaveLength(1);
    expect(domains[0]?.compact).toBe(true);
    expect(domains[0]?.touchesEdge).toBe(false);
    expect(domains[0]?.x).toBeCloseTo(11.5, 1);
    expect(skyrmionCores(domains)).toHaveLength(1);
    expect(classifyPhase(domains, meanNormal(m, 24 * 24))).toBe('SkX');
  });

  it('細長いドメイン(らせん)は HL と判定される', () => {
    const nx = 16;
    const ny = 12;
    const m = new Float32Array(nx * ny * 3);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) m[(x + y * nx) * 3 + 2] = x >= 6 && x <= 8 ? -1 : 1;
    }
    const domains = findDomains(m, nx, ny);
    expect(domains).toHaveLength(1);
    expect(domains[0]?.compact).toBe(false);
    expect(domains[0]?.touchesEdge).toBe(true);
    expect(skyrmionCores(domains)).toEqual([]);
    expect(classifyPhase(domains, meanNormal(m, nx * ny))).toBe('HL');
  });
});
