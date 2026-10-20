/**
 * 年と Unix 時間の変換。three.js には依存しない。
 *
 * 年は天文学的な年(0 年 = 紀元前1年、−1 年 = 紀元前2年)で扱う。紀元前後の表記(AD / BC)には 0 年が無い。
 * 暦は 1582 年より前にもグレゴリオ暦をそのまま延ばした「先発グレゴリオ暦」で数える(Unix 時間の定義と同じ)。
 */

const SECONDS_PER_DAY = 86400;

/** 1970-01-01 からの日数(先発グレゴリオ暦)。H. Hinnant の days_from_civil */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 天文学的な年(小数可)の Unix 時間 [s]。
 * 整数部の年の 1月1日 0時(UTC)から、小数部の割合だけその年の中を進めた時刻。
 */
export function unixSecondsOfYear(year: number): number {
  const y = Math.floor(year);
  const start = daysFromCivil(y, 1, 1) * SECONDS_PER_DAY;
  const length = (isLeapYear(y) ? 366 : 365) * SECONDS_PER_DAY;
  return start + (year - y) * length;
}

/** 天文学的な年を AD / BC の表記にする(0 年 → BC 1) */
export function eraLabel(year: number): string {
  return year >= 1 ? `AD ${year}` : `BC ${1 - year}`;
}

/**
 * 符号付き 64 ビット整数の2の補数表現で、上位から i 番目(0 が符号ビット)のビット。
 * 負の Unix 時間(1970 年より前)では上位のビットがすべて 1 になる。
 */
export function int64Bits(value: number): boolean[] {
  const unsigned = BigInt.asUintN(64, BigInt(Math.trunc(value)));
  const bits: boolean[] = [];
  for (let i = 63; i >= 0; i--) bits.push(((unsigned >> BigInt(i)) & 1n) === 1n);
  return bits;
}
