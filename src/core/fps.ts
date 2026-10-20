/** 表示を書き換える間隔 [ms] */
const REPORT_INTERVAL = 500;

/**
 * fps と1フレームの時間の表示(実機での確認用)。`?fps` で使えるようにし、デスクトップでは F キーで表示と非表示を切り替える。
 * 0.5 秒ごとに、その間の平均 fps、フレーム間隔の最大、CPU 時間(シーンの更新と描画の呼び出し)の平均を出す。
 * CPU 時間が短いのに fps が低ければ、GPU(描画そのもの)が重いと見当がつく。
 */
export class FpsMeter {
  private readonly el: HTMLElement;
  private shown: boolean;
  private windowStart = 0;
  private lastFrame = 0;
  /** 区間の頭のフレーム(前の区間の終わり)も含めた数。fps はフレームの間隔の数 frames - 1 から出す */
  private frames = 0;
  private maxInterval = 0;
  /** CPU 時間を足したフレームの数 */
  private samples = 0;
  private updateSum = 0;
  private renderSum = 0;

  constructor(shown: boolean) {
    this.shown = shown;
    this.el = document.createElement('pre');
    this.el.className = 'fps-meter';
    this.el.hidden = !shown;
    document.body.appendChild(this.el);
  }

  /** AR 中は DOM overlay の root の中にないと表示されないので、親を付け替える */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.shown = !this.shown;
    this.el.hidden = !this.shown;
  }

  /**
   * 1フレームを記録する
   * @param now performance.now() [ms]
   * @param updateMs シーンの更新にかかった時間 [ms]
   * @param renderMs 描画の呼び出しにかかった時間 [ms]
   */
  frame(now: number, updateMs: number, renderMs: number): void {
    if (this.lastFrame > 0) {
      this.maxInterval = Math.max(this.maxInterval, now - this.lastFrame);
    } else {
      this.windowStart = now;
    }
    this.lastFrame = now;
    this.frames += 1;
    this.samples += 1;
    this.updateSum += updateMs;
    this.renderSum += renderMs;

    const elapsed = now - this.windowStart;
    if (elapsed < REPORT_INTERVAL) return;
    if (this.shown) {
      const fps = ((this.frames - 1) * 1000) / elapsed;
      this.el.textContent =
        `${fps.toFixed(0).padStart(3)} fps  max ${this.maxInterval.toFixed(1)} ms\n` +
        `cpu  update ${(this.updateSum / this.samples).toFixed(1)} ms  render ${(this.renderSum / this.samples).toFixed(1)} ms`;
    }
    this.windowStart = now;
    this.frames = 1;
    this.maxInterval = 0;
    this.samples = 0;
    this.updateSum = 0;
    this.renderSum = 0;
  }
}
