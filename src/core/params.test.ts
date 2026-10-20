import { describe, expect, it } from 'vitest';
import { readLaunchParams } from './params';

const DEFAULTS = { startTime: 0, startBar: null, latency: 0, scale: 1, debug: false, fps: false };

describe('readLaunchParams', () => {
  it('指定が無ければ先頭から、補正なし、等倍', () => {
    expect(readLaunchParams('')).toEqual(DEFAULTS);
  });

  it('?t= / ?bar= / ?latency= / ?scale= / ?debug / ?fps', () => {
    expect(readLaunchParams('?t=45.5&bar=25&latency=150&scale=0.7&debug&fps')).toEqual({
      startTime: 45.5,
      startBar: 25,
      latency: 0.15,
      scale: 0.7,
      debug: true,
      fps: true,
    });
  });

  it('数値でない値や負の開始位置は無視する', () => {
    expect(readLaunchParams('?t=-3&bar=abc&latency=&scale=x')).toEqual(DEFAULTS);
  });

  it('ステージの倍率は 0.25〜4 に収める', () => {
    expect(readLaunchParams('?scale=0.01').scale).toBe(0.25);
    expect(readLaunchParams('?scale=10').scale).toBe(4);
  });
});
