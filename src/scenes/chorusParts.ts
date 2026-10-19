import { Vector3, type LineBasicMaterial, type LineSegments } from 'three';
import { LineBuilder } from '../gfx/lines';

/**
 * サビのシーン(sweep / descent / maze)で使う、小さな描画の部品。
 */

/** 立てたパネル(グラフ用)の枠と、床までの足。XY 面で、z の位置に立てる */
export function panelFrame(x0: number, x1: number, y0: number, y1: number, z: number, material: LineBasicMaterial): LineSegments {
  return new LineBuilder()
    .polyline([new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)], true)
    .segment(new Vector3(x0, 0, z), new Vector3(x0, y0, z))
    .segment(new Vector3(x1, 0, z), new Vector3(x1, y0, z))
    .build(material);
}

/** 矢印の先(tip から back の向きへ、side の向きに開く2本の線) */
export function arrowHead(builder: LineBuilder, tip: Vector3, back: Vector3, side: Vector3, size: number): LineBuilder {
  const base = tip.clone().addScaledVector(back, size);
  return builder.segment(tip, base.clone().addScaledVector(side, size * 0.5)).segment(tip, base.clone().addScaledVector(side, -size * 0.5));
}

/** 床に描く、矢印つきの軸 */
export function floorAxis(from: Vector3, to: Vector3, material: LineBasicMaterial): LineSegments {
  const dir = to.clone().sub(from).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  return arrowHead(new LineBuilder().segment(from, to), to, dir.clone().negate(), side, 0.006).build(material);
}

/** 床に描く、角だけの括弧(選択のカーソル)。中心が原点、幅 w・奥行き d */
export function cornerBrackets(w: number, d: number, arm: number, y: number, material: LineBasicMaterial): LineSegments {
  const builder = new LineBuilder();
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const corner = new Vector3((sx * w) / 2, y, (sz * d) / 2);
    builder.segment(corner, corner.clone().add(new Vector3(-sx * arm, 0, 0))).segment(corner, corner.clone().add(new Vector3(0, 0, -sz * arm)));
  }
  return builder.build(material);
}
