import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  Points,
  Vector3,
  type ColorRepresentation,
  type Material,
  type Object3D,
} from 'three';
import { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { createLabel, type LabelOptions } from '../gfx/text';
import type { SceneContext, SceneModule } from './types';

/** シーン共通の色(ブループリント調) */
export const PALETTE = {
  floor: 0x7fb4ff,
  gridMinor: 0x8fc4ff,
  gridMajor: 0xa9d4ff,
  ink: 0xa9d4ff,
  dim: 0x5f8fc8,
  idle: 0x3a5a82,
  glow: 0xf2fdff,
  cyan: 0x9ff3ff,
  /** 強調(debug HUD の1拍目と同じ系統の色) */
  warm: 0xffc478,
  label: 0xcfe6ff,
} as const;

/** 床に描く線の高さ(床面との z-fighting を避ける) */
export const Y_INK = 0.0008;

export const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
export const progress = (t: number, [from, to]: readonly [number, number]): number => clamp01((t - from) / (to - from));
export const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
export const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
export const smoothstep = (x: number): number => x * x * (3 - 2 * x);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export function lineMaterial(color: ColorRepresentation, opacity = 1): LineBasicMaterial {
  return new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

/** 拍に合わせた明滅。拍の頭で 1、そこから減衰する */
export function beatPulse(ctx: SceneContext, decayBeats = 0.35): number {
  return Math.exp(-ctx.beat.phase / decayBeats);
}

/**
 * シーン全体のフェードを受け持つ。登録したマテリアルとラベルの不透明度に、共通の係数をかける。
 * 各要素の「本来の」不透明度は set で変えられ、apply でフェードの係数をかけて反映する。
 */
export class Fader {
  private readonly materials = new Map<Material, number>();
  private readonly labels = new Map<Text, number>();
  private k = 1;

  line(color: ColorRepresentation, opacity = 1): LineBasicMaterial {
    return this.add(lineMaterial(color, opacity));
  }

  add<T extends Material>(material: T): T {
    material.transparent = true;
    this.materials.set(material, material.opacity);
    material.opacity *= this.k;
    return material;
  }

  label(text: string, options: LabelOptions, opacity = 1): Text {
    const label = createLabel(text, options);
    this.labels.set(label, opacity);
    label.fillOpacity = opacity * this.k;
    return label;
  }

  /** 本来の不透明度を変える */
  set(target: Material | Text, opacity: number): void {
    if (target instanceof Text) {
      this.labels.set(target, opacity);
      target.fillOpacity = opacity * this.k;
    } else {
      this.materials.set(target, opacity);
      target.opacity = opacity * this.k;
    }
  }

  apply(k: number): void {
    this.k = k;
    for (const [material, opacity] of this.materials) material.opacity = opacity * k;
    for (const [label, opacity] of this.labels) label.fillOpacity = opacity * k;
  }
}

/** 毎フレーム頂点を書き換える折れ線 */
export class DynamicLine {
  readonly line: Line;
  readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;

  constructor(capacity: number, material: Material) {
    this.positions = new Float32Array(capacity * 3);
    // Float32BufferAttribute は配列をコピーするので、同じ配列を共有する BufferAttribute を使う
    this.attribute = new BufferAttribute(this.positions, 3);
    this.attribute.setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);
    this.line = new Line(geometry, material);
    // 位置を毎フレーム書き換えるので、バウンディングスフィアによるカリングはしない
    this.line.frustumCulled = false;
  }

  set(i: number, x: number, y: number, z: number): void {
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
  }

  /** 先頭から count 点を描く */
  commit(count: number): void {
    this.attribute.needsUpdate = true;
    this.line.geometry.setDrawRange(0, count);
  }
}

/** root 以下のジオメトリ・マテリアル・ラベルを破棄する */
export function disposeTree(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Text) {
      object.dispose();
    } else if (object instanceof Mesh || object instanceof Line || object instanceof Points) {
      object.geometry.dispose();
      const material: Material | Material[] = object.material;
      for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    }
  });
}

/** 1つのシーンの表示。defineScene に渡す */
export interface SceneView {
  readonly root: Object3D;
  readonly fader: Fader;
  /**
   * @param beat シーン開始からの経過拍数
   * @param ctx 小節・拍(ctx.beat)などを使う
   */
  update(beat: number, ctx: SceneContext): void;
}

/**
 * シーンの切り替えのクロスフェードにかける拍数。
 * 次のシーンはこの拍数でフェードインし、前のシーンは終わったあとこの拍数だけ残ってフェードアウトする(SceneManager の tail)。
 */
export const TRANSITION_BEATS = 0.75;

/**
 * SceneView を作る関数から SceneModule を作る。enter で作り、exit で破棄する。
 * 時刻は拍に直して渡し、シーンの頭と終わりは自動でフェードさせる。
 * 終わったあとも TRANSITION_BEATS の間は update が呼ばれる(beat > length)ので、view はそれを想定しておく。
 * @param create length はシーンの長さ [拍]
 */
export function defineScene(id: string, create: (ctx: SceneContext, length: number) => SceneView): SceneModule {
  let view: SceneView | null = null;
  let length = 0;
  return {
    id,
    enter(ctx, duration) {
      length = duration / ctx.beats.secondsPerBeat;
      view = create(ctx, length);
      ctx.stage.add(view.root);
    },
    update(ctx, t) {
      if (view === null) return;
      const beat = t / ctx.beats.secondsPerBeat;
      const fadeIn = smoothstep(clamp01(beat / TRANSITION_BEATS));
      const fadeOut = 1 - smoothstep(clamp01((beat - length) / TRANSITION_BEATS));
      view.fader.apply(Math.min(fadeIn, fadeOut));
      view.update(beat, ctx);
    },
    exit(ctx) {
      if (view === null) return;
      ctx.stage.remove(view.root);
      disposeTree(view.root);
      view = null;
    },
    warmup(ctx) {
      return create(ctx, WARMUP_LENGTH).root;
    },
  };
}

/** 事前コンパイル用に作るときのシーンの長さ [拍](見た目は使わないので、ふつうの2小節) */
const WARMUP_LENGTH = 8;

/** ステージの大きさ [m](机の上の約 40cm × 30cm) */
export const STAGE = { width: 0.4, depth: 0.3 } as const;

/**
 * 図面の表題欄(ステージの右下)。シーンごとに図番と題名を入れて、全シーンを1冊の図面集のように見せる。
 * @param fig 図番(歌詞の行の番号)
 */
export function titleBlock(fader: Fader, fig: number, title: string, subtitle: string): Group {
  const { width: w, depth: d } = STAGE;
  const inset = 0.006;
  const box = { x0: 0.07, x1: w / 2 - inset, z0: 0.108, z1: d / 2 - inset };
  const group = new Group();
  const frame = new LineBuilder()
    .polyline([new Vector3(box.x0, Y_INK, box.z0), new Vector3(box.x1, Y_INK, box.z0), new Vector3(box.x1, Y_INK, box.z1), new Vector3(box.x0, Y_INK, box.z1)], true)
    .segment(new Vector3(box.x0, Y_INK, (box.z0 + box.z1) / 2), new Vector3(box.x1, Y_INK, (box.z0 + box.z1) / 2));
  group.add(frame.build(fader.line(PALETTE.gridMajor, 0.42)));
  // 等幅フォントなので、文字数から幅を見積もり、欄に収まらないときは文字を小さくする
  const room = box.x1 - box.x0 - 0.016;
  const fit = (text: string, size: number): number => Math.min(size, room / (text.length * MONO_ADVANCE));
  const heading = `FIG.${String(fig).padStart(2, '0')}  ${title}`;
  group.add(floorLabel(fader, heading, box.x0 + 0.008, 0.1175, { anchorX: 'left', size: fit(heading, 0.0058) }));
  group.add(floorLabel(fader, subtitle, box.x0 + 0.008, 0.1345, { anchorX: 'left', size: fit(subtitle, 0.0048) }));
  return group;
}

/** IBM Plex Mono の1文字の送り幅(文字の高さに対する比) */
const MONO_ADVANCE = 0.6;

/** 床に寝かせたラベル(手前から読める向き) */
export function floorLabel(fader: Fader, text: string, x: number, z: number, options: Partial<LabelOptions> = {}, opacity = 1): Text {
  const label = fader.label(text, { size: 0.006, color: PALETTE.label, ...options }, opacity);
  label.rotation.x = -Math.PI / 2;
  label.position.set(x, Y_INK * 2, z);
  return label;
}

/** 立てたラベル(手前 +Z を向く) */
export function standLabel(fader: Fader, text: string, x: number, y: number, z: number, options: Partial<LabelOptions> = {}, opacity = 1): Text {
  const label = fader.label(text, { size: 0.006, color: PALETTE.label, ...options }, opacity);
  label.position.set(x, y, z);
  return label;
}

/** troika のラベルの文字を変える(同じなら何もしない。sync は重いので毎フレーム呼ばない) */
export function setText(label: Text, text: string): void {
  if (label.text !== text) {
    label.text = text;
    label.sync();
  }
}
