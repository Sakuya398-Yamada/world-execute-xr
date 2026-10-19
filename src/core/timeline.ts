export interface TimelineEntry {
  readonly scene: string;
  /** 曲の再生位置 [s] */
  readonly start: number;
  readonly end: number;
}

export type Timeline = readonly TimelineEntry[];

export async function loadTimeline(url: string): Promise<Timeline> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`timeline.json を読み込めません (${res.status})`);
  }
  const data: unknown = await res.json();
  return parseTimeline(data);
}

export function parseTimeline(data: unknown): Timeline {
  if (!Array.isArray(data)) {
    throw new Error('timeline.json: ルートは配列にしてください');
  }
  const entries = data.map((item: unknown, index) => parseEntry(item, index));
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

function parseEntry(item: unknown, index: number): TimelineEntry {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`timeline.json[${index}]: オブジェクトではありません`);
  }
  const { scene, start, end } = item as Record<string, unknown>;
  if (typeof scene !== 'string' || scene === '') {
    throw new Error(`timeline.json[${index}]: scene は空でない文字列にしてください`);
  }
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`timeline.json[${index}]: start / end は数値にしてください`);
  }
  if (start < 0 || end <= start) {
    throw new Error(`timeline.json[${index}]: 0 <= start < end にしてください`);
  }
  return { scene, start, end };
}

/** 再生位置 t を含むエントリ(start <= t < end) */
export function entryAt(timeline: Timeline, t: number): TimelineEntry | undefined {
  return timeline.find((e) => t >= e.start && t < e.end);
}

export function timelineEnd(timeline: Timeline): number {
  return timeline.reduce((max, e) => Math.max(max, e.end), 0);
}
