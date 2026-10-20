import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type ColorRepresentation } from 'three';
import { LineBuilder } from '../../gfx/lines';
import { PALETTE, Y_INK, floorLabel, type Fader } from '../kit';

/**
 * B セクション(#6〜#9)で共有する図面の部品。
 * パネル(オシロスコープのような立てた枠)、破線、矢印、寸法線など。
 */

export interface PanelSpec {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z: number;
  /** 目盛りの分割数 [横, 縦]。0 なら目盛りなし */
  readonly divisions?: readonly [number, number];
  /** 床まで足を下ろすか */
  readonly legs?: boolean;
}

/** 立てたパネル(薄い面、枠、目盛り、足)。z の位置に XY 平面で立てる */
export function panel(fader: Fader, spec: PanelSpec, opacity = 1): Group {
  const { x0, x1, y0, y1, z, divisions = [10, 4], legs = true } = spec;
  const group = new Group();
  const back = new Mesh(
    new PlaneGeometry(x1 - x0, y1 - y0),
    fader.add(new MeshBasicMaterial({ color: PALETTE.floor, opacity: 0.06 * opacity, depthWrite: false, side: DoubleSide })),
  );
  back.position.set((x0 + x1) / 2, (y0 + y1) / 2, z - 0.0004);
  group.add(back);

  const frame = new LineBuilder().polyline([new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)], true);
  if (legs && y0 > 0) {
    frame.segment(new Vector3(x0, 0, z), new Vector3(x0, y0, z)).segment(new Vector3(x1, 0, z), new Vector3(x1, y0, z));
  }
  group.add(frame.build(fader.line(PALETTE.gridMajor, 0.7 * opacity)));

  const [nx, ny] = divisions;
  if (nx > 0 && ny > 0) {
    const grid = new LineBuilder();
    for (let i = 1; i < nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      grid.segment(new Vector3(x, y0, z), new Vector3(x, y1, z));
    }
    for (let j = 1; j < ny; j++) {
      const y = y0 + ((y1 - y0) * j) / ny;
      grid.segment(new Vector3(x0, y, z), new Vector3(x1, y, z));
    }
    group.add(grid.build(fader.line(PALETTE.gridMinor, 0.16 * opacity)));
  }
  return group;
}

/** a から b への破線を builder に積む */
export function dashed(builder: LineBuilder, a: Vector3, b: Vector3, dash = 0.004, gap = 0.003): LineBuilder {
  const length = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  for (let s = 0; s < length; s += dash + gap) {
    builder.segment(a.clone().addScaledVector(dir, s), a.clone().addScaledVector(dir, Math.min(s + dash, length)));
  }
  return builder;
}

/**
 * from から to への矢印。矢じりは side の向き(from → to と直交させる)に開く。
 */
export function arrow(builder: LineBuilder, from: Vector3, to: Vector3, head: number, side: Vector3): LineBuilder {
  const dir = to.clone().sub(from).normalize();
  const s = side.clone().normalize().multiplyScalar(head * 0.45);
  const base = to.clone().addScaledVector(dir, -head);
  return builder.segment(from, to).segment(to, base.clone().add(s)).segment(to, base.clone().sub(s));
}

/** 小さな丸い印(normal に直交する面に描く) */
export function ring(builder: LineBuilder, center: Vector3, radius: number, u: Vector3, v: Vector3, segments = 16): LineBuilder {
  return builder.circle(center, radius, u, v, segments);
}

/**
 * 床の寸法線(両端の引き出し線、矢印、真ん中の寸法)。
 * offset は測る点から寸法線までのずらし(床の面内)。
 */
export function floorDimension(
  fader: Fader,
  a: Vector3,
  b: Vector3,
  text: string,
  offset: Vector3,
  color: ColorRepresentation = PALETTE.ink,
  labelSize = 0.0052,
): Group {
  const group = new Group();
  const p = a.clone().add(offset).setY(Y_INK);
  const q = b.clone().add(offset).setY(Y_INK);
  const dir = q.clone().sub(p).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  const out = offset.clone().normalize();
  const lines = new LineBuilder()
    .segment(a.clone().setY(Y_INK).addScaledVector(out, 0.002), p.clone().addScaledVector(out, 0.003))
    .segment(b.clone().setY(Y_INK).addScaledVector(out, 0.002), q.clone().addScaledVector(out, 0.003));
  arrow(lines, p.clone().lerp(q, 0.5), p, 0.005, side);
  arrow(lines, p.clone().lerp(q, 0.5), q, 0.005, side);
  group.add(lines.build(fader.line(color, 0.75)));
  const mid = p.clone().lerp(q, 0.5).addScaledVector(out, 0.0065);
  group.add(floorLabel(fader, text, mid.x, mid.z, { size: labelSize, color }));
  return group;
}

/** 0 → 1 を、count 段の階段にする(拍ごとに1段ずつ進む表示に使う) */
export function steps(k: number, count: number): number {
  return Math.min(count, Math.floor(k * count + 1e-9)) / count;
}
