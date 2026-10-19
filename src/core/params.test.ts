import { describe, expect, it } from 'vitest';
import { readLaunchParams } from './params';

describe('readLaunchParams', () => {
  it('指定が無ければ先頭から、補正なし', () => {
    expect(readLaunchParams('')).toEqual({ startTime: 0, startBar: null, latency: 0, debug: false });
  });

  it('?t= / ?bar= / ?latency= / ?debug', () => {
    expect(readLaunchParams('?t=45.5&bar=25&latency=150&debug')).toEqual({
      startTime: 45.5,
      startBar: 25,
      latency: 0.15,
      debug: true,
    });
  });

  it('数値でない値や負の開始位置は無視する', () => {
    expect(readLaunchParams('?t=-3&bar=abc&latency=')).toEqual({ startTime: 0, startBar: null, latency: 0, debug: false });
  });
});
