import { describe, expect, it } from 'vitest';
import { daysFromCivil, eraLabel, int64Bits, isLeapYear, unixSecondsOfYear } from './calendar';
import { KuramotoSim, orderParameter } from './kuramoto';
import { aliasFrequency, wrapSymmetric } from './strobe';

describe('calendar', () => {
  it('Unix 時間の基準点', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(unixSecondsOfYear(1970)).toBe(0);
    expect(unixSecondsOfYear(2000)).toBe(946684800);
    expect(unixSecondsOfYear(2026)).toBe(1767225600);
  });

  it('紀元前後(先発グレゴリオ暦)', () => {
    // 0001-01-01T00:00:00Z
    expect(unixSecondsOfYear(1)).toBe(-62135596800);
    // 天文学的な 0 年 = 紀元前1年(うるう年なので 366 日)
    expect(unixSecondsOfYear(0)).toBe(-62135596800 - 366 * 86400);
    expect(isLeapYear(0)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('年の途中は日割り', () => {
    expect(unixSecondsOfYear(1970.5)).toBe(365 * 86400 * 0.5);
  });

  it('AD / BC の表記(0 年は無い)', () => {
    expect(eraLabel(1)).toBe('AD 1');
    expect(eraLabel(0)).toBe('BC 1');
    expect(eraLabel(-1)).toBe('BC 2');
  });

  it('64 ビットの2の補数', () => {
    expect(int64Bits(0).every((b) => !b)).toBe(true);
    expect(int64Bits(-1).every((b) => b)).toBe(true);
    const five = int64Bits(5);
    expect(five[0]).toBe(false);
    expect(five.slice(61)).toEqual([true, false, true]);
    expect(int64Bits(-62135596800)[0]).toBe(true);
  });
});

describe('strobe', () => {
  it('見かけの周波数は (−fs/2, fs/2] に折り返す', () => {
    expect(aliasFrequency(1, 10)).toBeCloseTo(1);
    expect(aliasFrequency(9, 10)).toBeCloseTo(-1);
    expect(aliasFrequency(10, 10)).toBeCloseTo(0);
    expect(aliasFrequency(5, 10)).toBeCloseTo(5);
    expect(aliasFrequency(12.5, 5)).toBeCloseTo(2.5);
  });

  it('角度の折り返し', () => {
    expect(wrapSymmetric(0.1, 1)).toBeCloseTo(0.1);
    expect(wrapSymmetric(0.9, 1)).toBeCloseTo(-0.1);
    expect(wrapSymmetric(-0.5, 1)).toBeCloseTo(0.5);
  });
});

describe('KuramotoSim', () => {
  const n = 12;
  const initial = Array.from({ length: n }, (_, i) => (i * 2.399) % (2 * Math.PI));

  it('結合が無ければ、それぞれの固有振動数で回るだけ', () => {
    const sim = new KuramotoSim(Array.from({ length: n }, (_, i) => 1 + i * 0.1), initial, 0.01);
    for (let k = 0; k < 100; k++) sim.advance({ k: 0, f: 0, omega: 0 });
    for (let i = 0; i < n; i++) expect(sim.phases[i]).toBeCloseTo((initial[i] ?? 0) + (1 + i * 0.1) * 1, 6);
  });

  it('結合が十分強ければ同期する(r → 1)', () => {
    const sim = new KuramotoSim(Array.from({ length: n }, (_, i) => 3 + (i - n / 2) * 0.05), initial, 0.01);
    expect(orderParameter(sim.phases).r).toBeLessThan(0.5);
    for (let k = 0; k < 2000; k++) sim.advance({ k: 4, f: 0, omega: 0 });
    expect(orderParameter(sim.phases).r).toBeGreaterThan(0.98);
  });

  it('駆動があれば、駆動の位相に引き込まれる', () => {
    const omega = 3;
    const sim = new KuramotoSim(Array.from({ length: n }, () => omega), initial, 0.005);
    for (let k = 0; k < 4000; k++) sim.advance({ k: 2, f: 3, omega });
    const { psi } = orderParameter(sim.phases);
    const lag = Math.atan2(Math.sin(omega * sim.time - psi), Math.cos(omega * sim.time - psi));
    expect(Math.abs(lag)).toBeLessThan(0.05);
  });

  it('reset して同じだけ進めると同じ状態になる', () => {
    const sim = new KuramotoSim(Array.from({ length: n }, (_, i) => 2 + i * 0.03), initial, 0.01);
    for (let k = 0; k < 50; k++) sim.advance({ k: 1, f: 0.5, omega: 2 });
    const first = Float64Array.from(sim.phases);
    sim.reset();
    for (let k = 0; k < 50; k++) sim.advance({ k: 1, f: 0.5, omega: 2 });
    expect(sim.phases).toEqual(first);
  });
});
