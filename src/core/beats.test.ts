import { describe, expect, it } from 'vitest';
import { parseBeatGrid, SOURCE_DURATION_TOLERANCE } from './beats';

// 120 BPM(1拍 0.5 s)、拍 0 が 0.25 s、拍 1 が最初の下拍 → 1小節目の1拍目は 0.75 s
const grid = parseBeatGrid({ bpm: 120, offset: 0.25, beatsPerBar: 4, downbeat: 1, source: { duration: 100 } });

describe('BeatGrid', () => {
  it('1拍と1小節の長さ', () => {
    expect(grid.secondsPerBeat).toBe(0.5);
    expect(grid.secondsPerBar).toBe(2);
  });

  it('小節・拍 → 秒', () => {
    expect(grid.timeOf(1)).toBeCloseTo(0.75);
    expect(grid.timeOf(2)).toBeCloseTo(2.75);
    expect(grid.timeOf(1, 3)).toBeCloseTo(1.75);
    expect(grid.timeOf(1, 2.5)).toBeCloseTo(1.5);
    expect(grid.timeOf(0, 4)).toBeCloseTo(0.25);
  });

  it('秒 → 小節・拍', () => {
    expect(grid.positionAt(0.75)).toMatchObject({ bar: 1, beat: 1, phase: 0 });
    expect(grid.positionAt(1.0)).toMatchObject({ bar: 1, beat: 1, phase: 0.5 });
    expect(grid.positionAt(2.5)).toMatchObject({ bar: 1, beat: 4, phase: 0.5 });
    expect(grid.positionAt(2.75)).toMatchObject({ bar: 2, beat: 1, phase: 0 });
  });

  it('最初の下拍より前は 0 小節目以下', () => {
    expect(grid.positionAt(0.5)).toMatchObject({ bar: 0, beat: 4, phase: 0.5 });
    expect(grid.positionAt(0.25)).toMatchObject({ bar: 0, beat: 4, phase: 0 });
    expect(grid.positionAt(0)).toMatchObject({ bar: 0, beat: 3, phase: 0.5 });
    expect(grid.positionAt(-1.25)).toMatchObject({ bar: 0, beat: 1, phase: 0 });
    expect(grid.positionAt(-1.5)).toMatchObject({ bar: -1, beat: 4, phase: 0.5 });
  });

  it('timeOf で求めた時刻は、浮動小数の誤差があってもその小節・拍に入る', () => {
    const real = parseBeatGrid({ bpm: 130, offset: 0.2651, beatsPerBar: 4, downbeat: 0, source: { duration: 212.254 } });
    for (let bar = 1; bar <= 120; bar++) {
      for (let beat = 1; beat <= 4; beat++) {
        expect(real.positionAt(real.timeOf(bar, beat))).toMatchObject({ bar, beat });
      }
    }
  });

  it('一番近い拍に丸める', () => {
    expect(grid.nearestBeat(0.75)).toEqual({ bar: 1, beat: 1 });
    expect(grid.nearestBeat(0.99)).toEqual({ bar: 1, beat: 1 });
    expect(grid.nearestBeat(1.01)).toEqual({ bar: 1, beat: 2 });
    expect(grid.nearestBeat(2.6)).toEqual({ bar: 2, beat: 1 });
    expect(grid.nearestBeat(0.3)).toEqual({ bar: 0, beat: 4 });
  });

  it('音源の長さのチェック', () => {
    expect(grid.checkSource(100)).toBeNull();
    expect(grid.checkSource(100 + SOURCE_DURATION_TOLERANCE * 0.9)).toBeNull();
    expect(grid.checkSource(100.5)).toContain('+0.500 s');
    expect(grid.checkSource(98)).toContain('-2.000 s');
  });
});

describe('parseBeatGrid', () => {
  const valid = { bpm: 130, offset: 0.2, beatsPerBar: 4, downbeat: 0, source: { duration: 200 } };

  it.each([
    ['ルートが配列', []],
    ['bpm が 0', { ...valid, bpm: 0 }],
    ['offset が負', { ...valid, offset: -0.1 }],
    ['beatsPerBar が小数', { ...valid, beatsPerBar: 3.5 }],
    ['downbeat が beatsPerBar 以上', { ...valid, downbeat: 4 }],
    ['source が無い', { ...valid, source: undefined }],
    ['source.duration が文字列', { ...valid, source: { duration: '200' } }],
  ])('%s ならエラー', (_name, data) => {
    expect(() => parseBeatGrid(data)).toThrow(/beats\.json/);
  });
});
