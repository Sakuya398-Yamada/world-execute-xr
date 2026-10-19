import type { BeatGrid } from './beats';

export interface TimelineEntry {
  readonly scene: string;
  /** 曲の再生位置 [s] */
  readonly start: number;
  readonly end: number;
}

export type Timeline = readonly TimelineEntry[];

export async function loadTimeline(url: string, beats: BeatGrid): Promise<Timeline> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`timeline.json を読み込めません (${res.status})`);
  }
  const data: unknown = await res.json();
  return parseTimeline(data, beats);
}

/**
 * start / end は、秒(数値)か小節(`{ "bar": 25 }`、`{ "bar": 25, "beat": 3 }`)で書く。
 * 小節で書いたものは拍グリッドで秒に直す。
 */
export function parseTimeline(data: unknown, beats: BeatGrid): Timeline {
  if (!Array.isArray(data)) {
    throw new Error('timeline.json: ルートは配列にしてください');
  }
  const entries = data.map((item: unknown, index) => parseEntry(item, index, beats));
  entries.sort((a, b) => a.start - b.start);
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (prev !== undefined && cur !== undefined && cur.start < prev.end) {
      throw new Error(`timeline.json: "${prev.scene}" と "${cur.scene}" の区間が重なっています`);
    }
  }
  return entries;
}

function parseEntry(item: unknown, index: number, beats: BeatGrid): TimelineEntry {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`timeline.json[${index}]: オブジェクトではありません`);
  }
  const { scene, start, end } = item as Record<string, unknown>;
  if (typeof scene !== 'string' || scene === '') {
    throw new Error(`timeline.json[${index}]: scene は空でない文字列にしてください`);
  }
  const startTime = parseTime(start, beats, `timeline.json[${index}].start`);
  const endTime = parseTime(end, beats, `timeline.json[${index}].end`);
  if (startTime < 0 || endTime <= startTime) {
    throw new Error(`timeline.json[${index}]: 0 <= start < end にしてください`);
  }
  return { scene, start: startTime, end: endTime };
}

function parseTime(value: unknown, beats: BeatGrid, where: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const { bar, beat = 1 } = value as Record<string, unknown>;
    if (typeof bar !== 'number' || !Number.isInteger(bar)) {
      throw new Error(`${where}: bar は整数にしてください`);
    }
    if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 1 || beat >= beats.beatsPerBar + 1) {
      throw new Error(`${where}: beat は 1 以上 ${beats.beatsPerBar + 1} 未満の数にしてください`);
    }
    return beats.timeOf(bar, beat);
  }
  throw new Error(`${where}: 秒(数値)か { "bar": 小節, "beat": 拍 } にしてください`);
}

/** 再生位置 t を含むエントリ(start <= t < end) */
export function entryAt(timeline: Timeline, t: number): TimelineEntry | undefined {
  return timeline.find((e) => t >= e.start && t < e.end);
}

export function timelineEnd(timeline: Timeline): number {
  return timeline.reduce((max, e) => Math.max(max, e.end), 0);
}
