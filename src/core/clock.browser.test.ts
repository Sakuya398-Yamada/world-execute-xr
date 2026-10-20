import { describe, expect, it } from 'vitest';
import { loadBeatGrid } from './beats';
import { loadAudioClock } from './clock';

/**
 * 実際の <audio> で再生位置を確かめる(vitest のブラウザーモード)。
 * 音源はリポジトリに無いので、無音の WAV をその場で作る。
 */

/** 無音の WAV(8 kHz、8 bit、モノラル) */
function silentWav(seconds: number): Blob {
  const rate = 8000;
  const samples = Math.ceil(seconds * rate);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // モノラル
  header.setUint32(24, rate, true);
  header.setUint32(28, rate, true); // 1秒あたりのバイト数
  header.setUint16(32, 1, true); // 1サンプルのバイト数
  header.setUint16(34, 8, true); // ビット数
  ascii(36, 'data');
  header.setUint32(40, samples, true);
  // 8 bit の PCM は 128 が無音
  return new Blob([header.buffer, new Uint8Array(samples).fill(128)], { type: 'audio/wav' });
}

describe('AudioClock(<audio>)', () => {
  it('小節の頭へシークしても、読み返した再生位置がその手前にならない', async () => {
    const beats = await loadBeatGrid('/beats.json');
    const url = URL.createObjectURL(silentWav(80));
    const clock = await loadAudioClock(url);
    expect(clock).not.toBeNull();
    if (clock === null) return;

    // <audio> の再生位置はマイクロ秒単位に丸められるので、そのままだと頭のわずかに手前になる小節がある(9 小節目など)
    for (let bar = 1; bar <= 40; bar++) {
      const t = beats.timeOf(bar);
      clock.seek(t);
      expect(clock.time, `${bar} 小節目`).toBeGreaterThanOrEqual(t);
      expect(clock.time - t, `${bar} 小節目`).toBeLessThan(0.005);
    }
    URL.revokeObjectURL(url);
  });
});
