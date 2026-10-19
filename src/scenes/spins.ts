import { Group, Vector3 } from 'three';
import { Fader, PALETTE, defineScene, floorLabel, progress, setText, stageFloor, standLabel } from './kit';
import { SpinField } from './spinField';

/**
 * #5 シミュレーション開始: 机全面にスピン(矢印)の格子が広がり、ランダムな初期状態から緩和していく。
 * DM 相互作用と磁場の兼ね合いで、スキルミオン(芯が下を向いた渦)が現れる。2小節を想定。
 */

const NX = 32;
const NY = 24;
const PITCH = 0.01;
const PARAMS = { j: 1, d: 1.2, b: 0.5, rate: 0.15 } as const;
/** 格子が広がりきる拍。緩和はその後から始める */
const REVEAL: readonly [number, number] = [0, 1.5];

export const spins = defineScene('spins', () => {
  const fader = new Fader();
  const root = new Group();
  root.add(stageFloor(fader, 0.5));

  const field = new SpinField(NX, NY, PARAMS, 5, PITCH, new Vector3(0, 0, 0.01), fader);
  root.add(field.mesh);

  root.add(floorLabel(fader, 'E = -J m_i.m_j - D d_ij.(m_i x m_j) - B m_z', -0.19, -0.135, { anchorX: 'left', size: 0.0055 }));
  const counter = standLabel(fader, '', 0.19, 0.012, -0.13, { anchorX: 'right', anchorY: 'bottom', size: 0.0075, color: PALETTE.glow });
  root.add(counter);

  return {
    root,
    fader,
    update(beat) {
      const relax = Math.max(beat - REVEAL[1], 0);
      field.advanceTo(relax);
      const reveal = progress(beat, REVEAL) * Math.hypot(NX, NY) * 0.5 + 0.5;
      field.draw(reveal);
      setText(counter, `t = ${String(field.lattice.steps).padStart(4, '0')} dt`);
    },
  };
});
