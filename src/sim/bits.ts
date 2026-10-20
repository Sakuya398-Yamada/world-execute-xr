/** 数値のビット表現(three.js には依存しない) */

/** IEEE 754 binary32 にしたときの 32 ビット(符号なし整数) */
export function float32Bits(value: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return view.getUint32(0);
}

/** binary32 に丸めた値(表示用) */
export function toFloat32(value: number): number {
  return Math.fround(value);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32(IEEE 802.3。zip や PNG と同じもの) */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** binary32 の列をビッグエンディアンのバイト列にする */
export function float32Bytes(values: readonly number[]): Uint8Array {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  values.forEach((v, i) => view.setFloat32(i * 4, v));
  return new Uint8Array(view.buffer);
}
