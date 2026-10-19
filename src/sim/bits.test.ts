import { describe, expect, it } from 'vitest';
import { crc32, float32Bits, float32Bytes, toFloat32 } from './bits';

describe('float32Bits', () => {
  it('よく知られた値の binary32', () => {
    expect(float32Bits(1)).toBe(0x3f800000);
    expect(float32Bits(10)).toBe(0x41200000);
    expect(float32Bits(-2)).toBe(0xc0000000);
    expect(float32Bits(0.1)).toBe(0x3dcccccd);
  });

  it('binary32 に丸めた値', () => {
    expect(toFloat32(0.1)).toBe(0.10000000149011612);
  });
});

describe('crc32', () => {
  it('標準のテストベクタ "123456789" は 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('binary32 の列のバイト列はビッグエンディアン', () => {
    expect([...float32Bytes([1, 10])]).toEqual([0x3f, 0x80, 0x00, 0x00, 0x41, 0x20, 0x00, 0x00]);
  });
});
