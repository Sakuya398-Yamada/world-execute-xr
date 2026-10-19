import { Color, ConeGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { SpinLattice, type SpinParams } from '../sim/spinLattice';
import { PALETTE, type Fader } from './kit';

/**
 * スピン格子(src/sim/spinLattice)を、机に敷いた矢印の格子として描く。#5 と #14 で使う。
 * 格子の面は机(XZ 面)で、スピンの c 成分(面に垂直)が +Y。
 */

/** 1拍あたりの緩和のステップ数 */
export const SPIN_STEPS_PER_BEAT = 40;

const UP = new Vector3(0, 1, 0);
const COLOR_UP = new Color(PALETTE.dim);
const COLOR_FLAT = new Color(PALETTE.glow);
const COLOR_DOWN = new Color(PALETTE.warm);

export class SpinField {
  readonly mesh: InstancedMesh;
  readonly material: MeshBasicMaterial;
  readonly lattice: SpinLattice;
  private readonly pitch: number;
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly direction = new Vector3();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly color = new Color();

  /**
   * @param pitch 格子の間隔 [m]
   * @param center 格子の中心(ステージ座標)
   */
  constructor(nx: number, ny: number, params: SpinParams, seed: number, pitch: number, center: Vector3, fader: Fader) {
    this.lattice = new SpinLattice(nx, ny, params, seed);
    this.pitch = pitch;
    const cone = new ConeGeometry(pitch * 0.28, pitch * 0.85, 6);
    this.material = fader.add(new MeshBasicMaterial({ color: 0xffffff, depthWrite: false }));
    this.mesh = new InstancedMesh(cone, this.material, nx * ny);
    this.mesh.position.copy(center);
    this.mesh.frustumCulled = false;
  }

  /** 経過拍数に応じて格子を進める。巻き戻されたら最初から計算し直す */
  advanceTo(beat: number): void {
    const target = Math.max(0, Math.floor(beat * SPIN_STEPS_PER_BEAT));
    if (target < this.lattice.steps) this.lattice.reset();
    while (this.lattice.steps < target) this.lattice.step();
  }

  /**
   * 矢印の向きと色を更新する。
   * @param reveal 中心からの距離(格子の間隔を単位)がこれより遠い矢印は出さない。広がっていく演出に使う
   */
  draw(reveal = Infinity): void {
    const { nx, ny, m } = this.lattice;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = x + y * nx;
        const a = m[i * 3] ?? 0;
        const b = m[i * 3 + 1] ?? 0;
        const c = m[i * 3 + 2] ?? 1;
        // 格子の a → +X、b → −Z(奥)、c → +Y
        this.direction.set(a, c, -b).normalize();
        this.quaternion.setFromUnitVectors(UP, this.direction);
        const gx = x - (nx - 1) / 2;
        const gy = y - (ny - 1) / 2;
        const shown = Math.hypot(gx, gy) <= reveal ? 1 : 0;
        this.position.set(gx * this.pitch, this.pitch * 0.45, -gy * this.pitch);
        this.scale.setScalar(Math.max(shown, 1e-4));
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.mesh.setMatrixAt(i, this.matrix);
        // 面に垂直な成分で色分け: 上向き(磁場の向き)は暗い青、面内は白、下向き(スキルミオンの芯)は暖色
        this.color.copy(COLOR_FLAT).lerp(c >= 0 ? COLOR_UP : COLOR_DOWN, Math.abs(c));
        this.mesh.setColorAt(i, this.color);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }
}
