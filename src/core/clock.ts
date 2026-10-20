/** 再生位置の供給元。音源があれば <audio>、無ければ無音のタイマー */
export interface PlaybackClock {
  readonly kind: 'audio' | 'silent';
  /** 再生位置 [s] */
  readonly time: number;
  /** 長さ [s] */
  readonly duration: number;
  readonly playing: boolean;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
  seek(t: number): void;
}

/**
 * <audio> の再生位置はマイクロ秒単位に丸められ、読み返すとシークした位置のわずかに手前になることがある。
 * 小節の頭ちょうどへシークすると、前のシーンの最後の一瞬が映ってしまうので、この分だけ後ろへシークする [s]
 */
const SEEK_NUDGE = 1e-3;

class AudioClock implements PlaybackClock {
  readonly kind = 'audio';
  private readonly audio: HTMLAudioElement;

  constructor(audio: HTMLAudioElement) {
    this.audio = audio;
  }

  get time(): number {
    return this.audio.currentTime;
  }

  get duration(): number {
    return this.audio.duration;
  }

  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  get ended(): boolean {
    return this.audio.ended;
  }

  play(): Promise<void> {
    return this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  seek(t: number): void {
    this.audio.currentTime = t + SEEK_NUDGE;
  }
}

export class SilentClock implements PlaybackClock {
  readonly kind = 'silent';
  readonly duration: number;
  private offset = 0;
  /** 再生中なら、offset の時点に対応する performance.now() */
  private startedAt: number | null = null;

  constructor(duration: number) {
    this.duration = duration;
  }

  get time(): number {
    const elapsed = this.startedAt === null ? 0 : (performance.now() - this.startedAt) / 1000;
    return Math.min(this.offset + elapsed, this.duration);
  }

  get playing(): boolean {
    return this.startedAt !== null && !this.ended;
  }

  get ended(): boolean {
    return this.time >= this.duration;
  }

  play(): Promise<void> {
    if (this.startedAt === null) {
      this.startedAt = performance.now();
    }
    return Promise.resolve();
  }

  pause(): void {
    if (this.startedAt !== null) {
      this.offset = this.time;
      this.startedAt = null;
    }
  }

  seek(t: number): void {
    this.offset = Math.min(Math.max(t, 0), this.duration);
    if (this.startedAt !== null) {
      this.startedAt = performance.now();
    }
  }
}

/**
 * 音源を読み込めれば AudioClock を返し、読み込めなければ null を返す。
 * src は URL のほか、見る人が選んだファイルの object URL でもよい。
 * Vite の開発サーバーは存在しないファイルにも index.html を返すことがあるので、
 * HTTP ステータスではなく <audio> の error イベントで判定する。
 */
export async function loadAudioClock(src: string): Promise<PlaybackClock | null> {
  const audio = await tryLoadAudio(src);
  return audio === null ? null : new AudioClock(audio);
}

function tryLoadAudio(src: string): Promise<HTMLAudioElement | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('loadedmetadata', () => resolve(audio), { once: true });
    audio.addEventListener('error', () => resolve(null), { once: true });
    audio.src = src;
  });
}
