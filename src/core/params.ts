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
  /** `?debug` で開発用の表示を出す */
  readonly debug: boolean;
}

export function readLaunchParams(search: string): LaunchParams {
  const query = new URLSearchParams(search);
  const t = readNumber(query, 't');
  const latencyMs = readNumber(query, 'latency');
  return {
    startTime: t !== null && t >= 0 ? t : 0,
    startBar: readNumber(query, 'bar'),
    latency: latencyMs === null ? 0 : latencyMs / 1000,
    debug: query.has('debug'),
  };
}

function readNumber(query: URLSearchParams, key: string): number | null {
  const raw = query.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
