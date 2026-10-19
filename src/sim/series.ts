/**
 * 円周率と級数の計算(#7 円周、#9 極限)。three.js には依存しない。
 */

export interface PiBounds {
  /** 多角形の辺の数 */
  readonly sides: number;
  /** 内接多角形の周 / 直径(π の下界) */
  readonly lower: number;
  /** 外接多角形の周 / 直径(π の上界) */
  readonly upper: number;
}

/**
 * アルキメデスの方法: 正六角形から辺の数を倍々にして、内接・外接多角形の周で π をはさむ。
 * 三角関数を使わず、調和平均と幾何平均の漸化式だけで求める。
 *   外接: C_2n = 2 C_n I_n / (C_n + I_n)、内接: I_2n = sqrt(C_2n I_n)
 * @param doublings 倍にする回数(0 なら六角形のみ。4 回で 96 角形)
 */
export function archimedesPi(doublings: number): PiBounds[] {
  let upper = 2 * Math.sqrt(3);
  let lower = 3;
  let sides = 6;
  const result: PiBounds[] = [{ sides, lower, upper }];
  for (let i = 0; i < doublings; i++) {
    upper = (2 * upper * lower) / (upper + lower);
    lower = Math.sqrt(upper * lower);
    sides *= 2;
    result.push({ sides, lower, upper });
  }
  return result;
}

/** バーゼル級数の部分和 S_n = Σ_{k=1}^{n} 1/k²(n = 1 〜 count) */
export function baselPartialSums(count: number): number[] {
  const sums: number[] = [];
  let sum = 0;
  for (let k = 1; k <= count; k++) {
    sum += 1 / (k * k);
    sums.push(sum);
  }
  return sums;
}

/** バーゼル級数の極限 π²/6 */
export const BASEL_LIMIT = Math.PI ** 2 / 6;
