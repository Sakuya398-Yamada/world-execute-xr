import type { BeatGrid } from './beats';

export interface BarMark {
  readonly bar: number;
  readonly beat: number;
  /** キーを押した時刻 [s](丸める前) */
  readonly time: number;
}

/**
 * 小節の記録(開発用。`?debug` のときだけ使う)。
 * 曲を聴きながら歌詞の頭でキーを押すと、その位置を一番近い拍に丸めて記録する。timeline.json の下書きに使う。
 *
 * - M: 記録する
 * - Backspace: 最後の記録を取り消す
 * - C: 記録を JSON でクリップボードにコピーする
 * - ← / →: 1小節戻る / 進む(聴き直し用)
 */
export class BarMarker {
  private readonly beats: BeatGrid;
  private readonly now: () => number;
  private readonly seek: (t: number) => void;
  private readonly marks: BarMark[] = [];

  /**
   * @param now 映像の時刻 [s](耳に届いている位置。`?latency=` の補正を含む)
   * @param seek 映像の時刻 [s] で再生位置を移す
   */
  constructor(beats: BeatGrid, now: () => number, seek: (t: number) => void) {
    this.beats = beats;
    this.now = now;
    this.seek = seek;
  }

  readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'm':
      case 'M':
        this.mark();
        break;
      case 'Backspace':
        this.marks.pop();
        this.print();
        break;
      case 'c':
      case 'C':
        this.copy();
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const { bar } = this.beats.positionAt(this.now());
        this.seek(Math.max(this.beats.timeOf(bar + (event.key === 'ArrowLeft' ? -1 : 1)), 0));
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  /** debug HUD に出す行 */
  hudLines(): string[] {
    const last = this.marks.slice(-4).map((m) => `${m.bar}.${m.beat}`);
    return [`marks  ${this.marks.length}${last.length > 0 ? `  (${last.join(' ')})` : ''}  [M / BS / C / <- ->]`];
  }

  toJson(): string {
    return JSON.stringify(this.marks.map(({ bar, beat }) => ({ bar, beat })));
  }

  private mark(): void {
    const time = this.now();
    this.marks.push({ ...this.beats.nearestBeat(time), time });
    this.print();
  }

  private print(): void {
    console.log(
      `marks (${this.marks.length})\n` +
        this.marks.map((m, i) => `${String(i + 1).padStart(3)}: { "bar": ${m.bar}, "beat": ${m.beat} }   // ${m.time.toFixed(2)} s`).join('\n'),
    );
  }

  private copy(): void {
    navigator.clipboard.writeText(this.toJson()).catch((error: unknown) => {
      console.warn('クリップボードにコピーできませんでした。上のログからコピーしてください', error);
    });
  }
}
