/**
 * ストロボで回転体を見たときの見かけの回転(車輪の逆回転現象、時間方向のエイリアシング)。three.js には依存しない。
 *
 * N 本のスポークの車輪が回転数 f_rot で回り、周波数 f_s で光るとき、
 * 見た目が同じになる周期は 1/N 回転なので、スポークの周波数 f = N f_rot が f_s の整数倍だけずれて見える。
 * 見かけの周波数は f − k f_s(k は −f_s/2 〜 f_s/2 に収まる整数)。
 */

/** 見かけの周波数 [Hz]。(−f_s/2, f_s/2] に折り返した値。負なら逆回転に見える */
export function aliasFrequency(f: number, fs: number): number {
  const k = Math.round(f / fs);
  let alias = f - k * fs;
  if (alias <= -fs / 2) alias += fs;
  return alias;
}

/** 角度を (−period/2, period/2] に折り返す */
export function wrapSymmetric(angle: number, period: number): number {
  let a = angle - Math.round(angle / period) * period;
  if (a <= -period / 2) a += period;
  return a;
}
