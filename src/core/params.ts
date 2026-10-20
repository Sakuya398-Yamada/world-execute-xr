export interface LaunchParams {
  /** `?t=45` で指定する再生開始位置 [s] */
  readonly startTime: number;
  /** `?bar=25` で指定する再生開始位置 [小節]。指定があれば `?t=` より優先する */
  readonly startBar: number | null;
  /**
   * `?latency=150` で指定する、音の出力の遅れ [s](URL では ms で書く)。
   * `audio.currentTime` は耳に届いている位置より先に進むので、映像の時刻をこの分だけ遅らせる。
   * 有線ならほぼ 0 でよく、Bluetooth イヤホンだと 100ms を超えることが多い。
   */
  readonly latency: number;
  /** `?scale=0.7` で指定する、ステージ全体の大きさの倍率(狭い机用) */
  readonly scale: number;
  /** `?debug` で開発用の表示を出す */
  readonly debug: boolean;
  /** `?fps` で fps の表示を出す */
  readonly fps: boolean;
}

/** ステージの倍率として受け付ける範囲 */
const SCALE_RANGE = [0.25, 4] as const;

export function readLaunchParams(search: string): LaunchParams {
  const query = new URLSearchParams(search);
  const t = readNumber(query, 't');
  const latencyMs = readNumber(query, 'latency');
  const scale = readNumber(query, 'scale');
  return {
    startTime: t !== null && t >= 0 ? t : 0,
    startBar: readNumber(query, 'bar'),
    latency: latencyMs === null ? 0 : latencyMs / 1000,
    scale: scale === null ? 1 : Math.min(Math.max(scale, SCALE_RANGE[0]), SCALE_RANGE[1]),
    debug: query.has('debug'),
    fps: query.has('fps'),
  };
}

function readNumber(query: URLSearchParams, key: string): number | null {
  const raw = query.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
