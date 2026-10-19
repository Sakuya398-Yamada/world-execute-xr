import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type LineBasicMaterial } from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../../gfx/lines';
import { PALETTE, standLabel, type Fader } from '../kit';

/**
 * 机に立てたオシロスコープ風のパネル(XY 面、手前 +Z を向く)。枠、目盛り、床までの足、題名。
 * 波形はパネルの座標 (u, v) ∈ [0, 1]² で指定し、at でステージ座標に直して描く。
 */

export interface ScopeSpec {
  readonly x0: number;
  readonly x1: number;
  /** パネルの下端と上端の高さ [m] */
  readonly y0: number;
  readonly y1: number;
  readonly z: number;
  /** 目盛りの分割数 */
  readonly cols: number;
  readonly rows: number;
  readonly title: string;
}

export interface ScopePanel {
  readonly group: Group;
  readonly frameMaterial: LineBasicMaterial;
  readonly title: Text;
  /** パネルの座標 (u, v) を、ステージ座標に直す(波形が目盛りより少し手前に来るようにする) */
  at(u: number, v: number, target: Vector3): Vector3;
}

export function scopePanel(fader: Fader, spec: ScopeSpec): ScopePanel {
  const { x0, x1, y0, y1, z, cols, rows } = spec;
  const group = new Group();

  const back = new Mesh(
    new PlaneGeometry(x1 - x0, y1 - y0),
    fader.add(new MeshBasicMaterial({ color: PALETTE.floor, opacity: 0.07, depthWrite: false, side: DoubleSide })),
  );
  back.position.set((x0 + x1) / 2, (y0 + y1) / 2, z - 0.0003);
  group.add(back);

  const frameMaterial = fader.line(PALETTE.gridMajor, 0.7);
  const frame = new LineBuilder()
    .polyline([new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)], true)
    .segment(new Vector3(x0, 0, z), new Vector3(x0, y0, z))
    .segment(new Vector3(x1, 0, z), new Vector3(x1, y0, z));
  group.add(frame.build(frameMaterial));

  const graticule = new LineBuilder();
  for (let i = 1; i < cols; i++) {
    const x = x0 + ((x1 - x0) * i) / cols;
    graticule.segment(new Vector3(x, y0, z), new Vector3(x, y1, z));
  }
  for (let i = 1; i < rows; i++) {
    const y = y0 + ((y1 - y0) * i) / rows;
    graticule.segment(new Vector3(x0, y, z), new Vector3(x1, y, z));
  }
  group.add(graticule.build(fader.line(PALETTE.gridMinor, 0.16)));

  const title = standLabel(fader, spec.title, x0, y1 + 0.003, z, { anchorX: 'left', anchorY: 'bottom', size: 0.0058 });
  group.add(title);

  return {
    group,
    frameMaterial,
    title,
    at: (u, v, target) => target.set(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, z + 0.0005),
  };
}
