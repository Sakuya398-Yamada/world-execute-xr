import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import type { Timeline } from '../core/timeline';
import { LineBuilder } from '../gfx/lines';
import { Fader, PALETTE, STAGE, Y_INK, clamp01, smoothstep } from './kit';

const at = (x: number, z: number): Vector3 => new Vector3(x, Y_INK / 2, z);

/**
 * 全シーンに共通の床(ブループリントの台紙)。シーンをまたいで出しっぱなしにして、切り替えのたびに床が消えないようにする。
 * タイムラインのシーンが続いている区間だけ表示し、その頭と終わりでフェードする。表示は再生位置だけから決まる。
 */
export class StageBase {
  readonly root = new Group();
  private readonly fader = new Fader();
  /** シーンが途切れずに続く区間 [s] */
  private readonly spans: (readonly [number, number])[] = [];
  private readonly fade: number;

  /** @param fade 頭と終わりのフェードの長さ [s] */
  constructor(timeline: Timeline, fade: number) {
    this.fade = fade;
    for (const { start, end } of timeline) {
      const last = this.spans[this.spans.length - 1];
      if (last !== undefined && start - last[1] < 1e-6) {
        this.spans[this.spans.length - 1] = [last[0], end];
      } else {
        this.spans.push([start, end]);
      }
    }
    this.root.name = 'stage-base';
    this.build();
  }

  /**
   * @returns いまの不透明度(0〜1)
   */
  update(songTime: number): number {
    let k = 0;
    for (const [start, end] of this.spans) {
      const fadeIn = smoothstep(clamp01((songTime - start) / this.fade));
      const fadeOut = 1 - smoothstep(clamp01((songTime - end) / this.fade));
      if (songTime >= start) k = Math.max(k, Math.min(fadeIn, fadeOut));
    }
    this.fader.apply(k);
    this.root.visible = k > 0;
    return k;
  }

  private build(): void {
    const { width: w, depth: d } = STAGE;
    const plane = new Mesh(
      new PlaneGeometry(w, d),
      this.fader.add(new MeshBasicMaterial({ color: PALETTE.floor, opacity: 0.05, depthWrite: false, side: DoubleSide })),
    );
    plane.rotation.x = -Math.PI / 2;
    this.root.add(plane);

    const grid = new LineBuilder();
    for (let i = 1; i < Math.round(w / 0.05); i++) grid.segment(at(-w / 2 + i * 0.05, -d / 2), at(-w / 2 + i * 0.05, d / 2));
    for (let i = 1; i < Math.round(d / 0.05); i++) grid.segment(at(-w / 2, -d / 2 + i * 0.05), at(w / 2, -d / 2 + i * 0.05));
    this.root.add(grid.build(this.fader.line(PALETTE.gridMinor, 0.1)));

    // 外枠と、1cm ごとの目盛り(5cm ごとに長く)
    const frame = new LineBuilder().polyline([at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)], true);
    const ticks = new LineBuilder();
    for (let i = 0; i <= Math.round(w / 0.01); i++) {
      const x = -w / 2 + i * 0.01;
      const len = i % 5 === 0 ? 0.006 : 0.003;
      ticks.segment(at(x, -d / 2), at(x, -d / 2 + len)).segment(at(x, d / 2), at(x, d / 2 - len));
    }
    for (let i = 0; i <= Math.round(d / 0.01); i++) {
      const z = -d / 2 + i * 0.01;
      const len = i % 5 === 0 ? 0.006 : 0.003;
      ticks.segment(at(-w / 2, z), at(-w / 2 + len, z)).segment(at(w / 2, z), at(w / 2 - len, z));
    }
    this.root.add(frame.build(this.fader.line(PALETTE.gridMajor, 0.38)));
    this.root.add(ticks.build(this.fader.line(PALETTE.gridMajor, 0.3)));

    // 四隅の見当(トンボ)
    const marks = new LineBuilder();
    const m = 0.012;
    const o = 0.006;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const cx = sx * (w / 2 + o);
      const cz = sz * (d / 2 + o);
      marks.segment(at(cx, cz), at(cx - sx * m, cz)).segment(at(cx, cz), at(cx, cz - sz * m));
    }
    this.root.add(marks.build(this.fader.line(PALETTE.ink, 0.6)));
  }
}
