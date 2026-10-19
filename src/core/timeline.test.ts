import { describe, expect, it } from 'vitest';
import { parseBeatGrid } from './beats';
import { entryAt, parseTimeline, timelineEnd } from './timeline';

// 60 BPM、1小節目の1拍目が 0.5 s → n 小節目の頭は 0.5 + (n - 1) * 4 s
const beats = parseBeatGrid({ bpm: 60, offset: 0.5, beatsPerBar: 4, downbeat: 0, source: { duration: 100 } });

describe('parseTimeline', () => {
  it('秒と小節の書き方を混ぜられ、開始順に並ぶ', () => {
    const timeline = parseTimeline(
      [
        { scene: 'b', start: { bar: 3, beat: 2 }, end: 12 },
        { scene: 'a', start: 1, end: { bar: 2 } },
      ],
      beats,
    );
    expect(timeline).toEqual([
      { scene: 'a', start: 1, end: 4.5 },
      { scene: 'b', start: 9.5, end: 12 },
    ]);
    expect(entryAt(timeline, 4.4)?.scene).toBe('a');
    expect(entryAt(timeline, 4.5)).toBeUndefined();
    expect(timelineEnd(timeline)).toBe(12);
  });

  it.each([
    ['区間が重なる', [{ scene: 'a', start: { bar: 1 }, end: { bar: 3 } }, { scene: 'b', start: { bar: 2 }, end: { bar: 4 } }], /重なって/],
    ['bar が小数', [{ scene: 'a', start: { bar: 1.5 }, end: 20 }], /bar は整数/],
    ['beat が 1 未満', [{ scene: 'a', start: { bar: 1, beat: 0 }, end: 20 }], /beat は/],
    ['beat が小節の外', [{ scene: 'a', start: { bar: 1, beat: 5 }, end: 20 }], /beat は/],
    ['時刻が文字列', [{ scene: 'a', start: '1', end: 20 }], /秒\(数値\)か/],
    ['end が start より前', [{ scene: 'a', start: { bar: 2 }, end: { bar: 1 } }], /start < end/],
    ['start が負(1小節目より前の小節)', [{ scene: 'a', start: { bar: 0 }, end: 20 }], /0 <= start/],
  ])('%s ならエラー', (_name, data, message) => {
    expect(() => parseTimeline(data, beats)).toThrow(message);
  });
});
