export interface LaunchParams {
  /** `?t=45` で指定する再生開始位置 [s] */
  readonly startTime: number;
  /** `?debug` で開発用の表示を出す */
  readonly debug: boolean;
}

export function readLaunchParams(search: string): LaunchParams {
  const query = new URLSearchParams(search);
  const raw = query.get('t');
  const t = raw === null ? 0 : Number(raw);
  return {
    startTime: Number.isFinite(t) && t >= 0 ? t : 0,
    debug: query.has('debug'),
  };
}
