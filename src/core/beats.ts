/**
 * 拍グリッド。テンポが一定の曲の拍を、`offset + n × (60 / bpm)` の直線で表す。
 * 中身は public/beats.json(tools/beats で音源を解析して作る)。
 */
export interface BeatGridData {
  /** テンポ [拍/分] */
  readonly bpm: number;
  /** 拍 0 の時刻 [s]。0 <= offset < 1拍の長さ */
  readonly offset: number;
  /** 1小節の拍数 */
  readonly beatsPerBar: number;
  /** 曲で最初の下拍(1小節目の1拍目)になる拍の番号。0 <= downbeat < beatsPerBar */
  readonly downbeat: number;
  readonly source: {
    /** 解析した音源の長さ [s]。再生する音源が同じものか確かめるのに使う */
    readonly duration: number;
  };
}

export interface BeatPosition {
  /** 小節番号。曲で最初の下拍が 1 で、それより前は 0 以下 */
  readonly bar: number;
  /** 小節の中の拍(1 〜 beatsPerBar) */
  readonly beat: number;
  /** 拍の中の位置(0 <= phase < 1) */
  readonly phase: number;
  /** 1小節目の1拍目からの通算の拍数(小数)。それより前は負 */
  readonly beats: number;
}

/**
 * 再生する音源の長さが、解析した音源とこれ以上違えば別物とみなす [s]。
 * 同じ mp3 なら Chromium の `audio.duration` は解析時の長さと 1ms 未満で一致する。
 */
export const SOURCE_DURATION_TOLERANCE = 0.05;

/** 浮動小数の誤差で、ちょうど拍の頭の時刻が前の拍に入らないようにする */
const EPSILON = 1e-9;

export class BeatGrid {
  readonly bpm: number;
  readonly offset: number;
  readonly beatsPerBar: number;
  readonly downbeat: number;
  readonly sourceDuration: number;
  /** 1小節目の1拍目の時刻 [s] */
  private readonly origin: number;

  constructor(data: BeatGridData) {
    this.bpm = data.bpm;
    this.offset = data.offset;
    this.beatsPerBar = data.beatsPerBar;
    this.downbeat = data.downbeat;
    this.sourceDuration = data.source.duration;
    this.origin = data.offset + data.downbeat * this.secondsPerBeat;
  }

  get secondsPerBeat(): number {
    return 60 / this.bpm;
  }

  get secondsPerBar(): number {
    return this.secondsPerBeat * this.beatsPerBar;
  }

  /** 小節・拍(どちらも 1 始まり。小数も可)の時刻 [s] */
  timeOf(bar: number, beat = 1): number {
    return this.origin + ((bar - 1) * this.beatsPerBar + (beat - 1)) * this.secondsPerBeat;
  }

  /** 再生位置 t [s] の小節・拍 */
  positionAt(t: number): BeatPosition {
    const beats = (t - this.origin) / this.secondsPerBeat;
    const whole = Math.floor(beats + EPSILON);
    const inBar = ((whole % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
    return {
      bar: Math.floor(whole / this.beatsPerBar) + 1,
      beat: inBar + 1,
      phase: Math.max(beats - whole, 0),
      beats,
    };
  }

  /** 再生位置 t [s] に一番近い拍(小節・拍) */
  nearestBeat(t: number): { readonly bar: number; readonly beat: number } {
    const whole = Math.round((t - this.origin) / this.secondsPerBeat);
    const inBar = ((whole % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
    return { bar: Math.floor(whole / this.beatsPerBar) + 1, beat: inBar + 1 };
  }

  /** 再生する音源の長さが解析した音源と違えば、その説明を返す */
  checkSource(duration: number): string | null {
    const diff = duration - this.sourceDuration;
    if (Math.abs(diff) <= SOURCE_DURATION_TOLERANCE) return null;
    return (
      `音源の長さ ${duration.toFixed(3)} s が、beats.json の解析元 ${this.sourceDuration.toFixed(3)} s と ` +
      `${diff > 0 ? '+' : ''}${diff.toFixed(3)} s 違います。音源のバージョンが違うと拍がずれます`
    );
  }
}

export async function loadBeatGrid(url: string): Promise<BeatGrid> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`beats.json を読み込めません (${res.status})`);
  }
  const data: unknown = await res.json();
  return parseBeatGrid(data);
}

export function parseBeatGrid(data: unknown): BeatGrid {
  if (typeof data !== 'object' || data === null) {
    throw new Error('beats.json: ルートはオブジェクトにしてください');
  }
  const { bpm, offset, beatsPerBar, downbeat, source } = data as Record<string, unknown>;
  if (!isFiniteNumber(bpm) || bpm <= 0) {
    throw new Error('beats.json: bpm は正の数にしてください');
  }
  if (!isFiniteNumber(offset) || offset < 0) {
    throw new Error('beats.json: offset は 0 以上の数にしてください');
  }
  if (!isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new Error('beats.json: beatsPerBar は 1 以上の整数にしてください');
  }
  if (!isInteger(downbeat) || downbeat < 0 || downbeat >= beatsPerBar) {
    throw new Error('beats.json: downbeat は 0 以上 beatsPerBar 未満の整数にしてください');
  }
  const duration = typeof source === 'object' && source !== null ? (source as Record<string, unknown>).duration : undefined;
  if (!isFiniteNumber(duration) || duration <= 0) {
    throw new Error('beats.json: source.duration は正の数にしてください');
  }
  return new BeatGrid({ bpm, offset, beatsPerBar, downbeat, source: { duration } });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
