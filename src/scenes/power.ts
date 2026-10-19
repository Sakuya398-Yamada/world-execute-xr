import { BoxGeometry, EdgesGeometry, Group, LineSegments, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import {
  DynamicLine,
  Fader,
  PALETTE,
  Y_INK,
  clamp01,
  defineScene,
  easeOutCubic,
  floorLabel,
  progress,
  setText,
  smoothstep,
  standLabel,
} from './kit';

/**
 * #1 電源を入れる: 机の上のトグルスイッチが倒れ、配線を電流が走り、RC 回路の充電曲線 v = V(1 − e^(−t/RC)) が立ち上がる。
 * 2小節を想定し、後半の頭(4拍目)でスイッチが入る。
 */

/** スイッチが入る拍 */
const FLIP = 4;
/** 充電曲線のパネルに描く時間幅 [拍]。RC はその 1/4 なので、端でほぼ満充電になる */
const CURVE_BEATS = 4;
const RC = CURVE_BEATS / 4;
const V_SOURCE = 5;
const LEVER_ANGLE = 0.55;

const SWITCH_AT = new Vector3(-0.12, 0, 0.07);
const PANEL = { x0: -0.03, x1: 0.15, y0: 0.012, y1: 0.09, z: -0.07 } as const;
const CURVE_SAMPLES = 120;

export const power = defineScene('power', () => {
  const fader = new Fader();
  const root = new Group();

  // トグルスイッチ: 台座と、支点まわりに倒れるレバー
  const base = new LineSegments(new EdgesGeometry(new BoxGeometry(0.05, 0.012, 0.028)), fader.line(PALETTE.ink, 0.9));
  base.position.copy(SWITCH_AT).setY(0.006);
  root.add(base);
  const lever = new Group();
  lever.position.copy(SWITCH_AT).setY(0.012);
  const leverMaterial = fader.line(PALETTE.ink, 1);
  lever.add(
    new LineBuilder()
      .cylinder(new Vector3(0, 0, 0), new Vector3(0, 0.03, 0), 0.0028, { longitudes: 6, rings: [0.5] })
      .build(leverMaterial),
  );
  root.add(lever);
  root.add(floorLabel(fader, 'OFF', SWITCH_AT.x - 0.035, SWITCH_AT.z + 0.026, { size: 0.0055 }));
  root.add(floorLabel(fader, 'ON', SWITCH_AT.x + 0.035, SWITCH_AT.z + 0.026, { size: 0.0055 }));

  // 配線: スイッチから充電曲線のパネルの足元まで。スイッチが入ると光が走る
  const path = [
    new Vector3(SWITCH_AT.x + 0.025, Y_INK, SWITCH_AT.z),
    new Vector3(0.06, Y_INK, SWITCH_AT.z),
    new Vector3(0.06, Y_INK, PANEL.z + 0.02),
    new Vector3(PANEL.x0, Y_INK, PANEL.z + 0.02),
    new Vector3(PANEL.x0, Y_INK, PANEL.z),
  ];
  const wire = new LineBuilder().polyline(path).build(fader.line(PALETTE.dim, 0.7));
  root.add(wire);
  const current = new LineBuilder().polyline(path).build(fader.line(PALETTE.glow, 1));
  current.geometry.setDrawRange(0, 0);
  root.add(current);
  const currentVertices = current.geometry.getAttribute('position').count;

  // 充電曲線のパネル(枠、目盛り、漸近線 V)
  const { x0, x1, y0, y1, z } = PANEL;
  const yAt = (v: number): number => y0 + (v / V_SOURCE) * (y1 - y0) * 0.85;
  const frame = new LineBuilder()
    .polyline([new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)], true)
    .segment(new Vector3(x0, 0, z), new Vector3(x0, y0, z))
    .segment(new Vector3(x1, 0, z), new Vector3(x1, y0, z));
  root.add(frame.build(fader.line(PALETTE.gridMajor, 0.6)));
  const asymptote = new LineBuilder();
  for (let x = x0; x < x1; x += 0.008) {
    asymptote.segment(new Vector3(x, yAt(V_SOURCE), z), new Vector3(Math.min(x + 0.004, x1), yAt(V_SOURCE), z));
  }
  root.add(asymptote.build(fader.line(PALETTE.warm, 0.6)));
  const curve = new DynamicLine(CURVE_SAMPLES, fader.line(PALETTE.cyan, 1));
  curve.line.position.z = 0.0005;
  root.add(curve.line);
  root.add(standLabel(fader, 'v = V(1 - e^(-t/RC))', x0, y1 + 0.004, z, { anchorX: 'left', anchorY: 'bottom' }));
  root.add(standLabel(fader, 'V', x1 + 0.004, yAt(V_SOURCE), z, { anchorX: 'left', color: PALETTE.warm }));
  const readout = standLabel(fader, '', x1, y1 + 0.004, z, { anchorX: 'right', anchorY: 'bottom', color: PALETTE.glow });
  root.add(readout);

  return {
    root,
    fader,
    update(beat) {
      const on = smoothstep(progress(beat, [FLIP - 0.3, FLIP]));
      lever.rotation.z = LEVER_ANGLE * (1 - 2 * on);
      leverMaterial.color.set(beat >= FLIP ? PALETTE.glow : PALETTE.ink);

      const run = easeOutCubic(progress(beat, [FLIP, FLIP + 1]));
      current.geometry.setDrawRange(0, Math.floor((run * currentVertices) / 2) * 2);

      const tau = clamp01((beat - FLIP) / CURVE_BEATS) * CURVE_BEATS;
      const drawn = Math.round((tau / CURVE_BEATS) * (CURVE_SAMPLES - 1)) + 1;
      for (let i = 0; i < drawn; i++) {
        const s = (i / (CURVE_SAMPLES - 1)) * CURVE_BEATS;
        curve.set(i, x0 + (s / CURVE_BEATS) * (x1 - x0), yAt(V_SOURCE * (1 - Math.exp(-s / RC))), z);
      }
      curve.commit(beat >= FLIP ? drawn : 0);
      setText(readout, `v = ${(beat >= FLIP ? V_SOURCE * (1 - Math.exp(-tau / RC)) : 0).toFixed(2)} V`);
    },
  };
});
