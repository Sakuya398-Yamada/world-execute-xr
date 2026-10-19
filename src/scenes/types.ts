import type { Group, PerspectiveCamera, WebGLRenderer } from 'three';
import type { BeatGrid, BeatPosition } from '../core/beats';

export interface SceneContext {
  /**
   * ステージ原点(机の上の、タップで決めた位置)。シーンのオブジェクトはすべてこの子に置く。
   * 単位はメートル。+Y が上、+Z が手前(観客側)。
   */
  readonly stage: Group;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  /** 曲全体の再生位置 [s](`?latency=` の補正を含む) */
  readonly songTime: number;
  /** 拍グリッド(public/beats.json)。1拍の長さや、小節 → 秒の変換に使う */
  readonly beats: BeatGrid;
  /** songTime の小節・拍 */
  readonly beat: BeatPosition;
}

export interface SceneModule {
  /** timeline.json の `scene` と一致させる */
  readonly id: string;
  enter(ctx: SceneContext): void;
  /**
   * @param t シーン開始からの経過秒(タイムラインの start が 0)
   * @param dt 前フレームからの再生位置の差分 [s]。停止中は 0
   */
  update(ctx: SceneContext, t: number, dt: number): void;
  exit(ctx: SceneContext): void;
}
