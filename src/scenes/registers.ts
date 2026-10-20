import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, Vector3 } from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { crc32, float32Bits, float32Bytes, toFloat32 } from '../sim/bits';
import { seededRandom } from '../sim/random';
import { Fader, PALETTE, Y_INK, beatPulse, clamp01, defineScene, floorLabel, progress, setText, smoothstep, standLabel, titleBlock } from './kit';

/**
 * #4 初期化: パラメータのレジスタ。値を IEEE 754 binary32 のビット(符号・指数・仮数)で見せる。2小節(8拍)。
 * - 0〜4拍: 名前が打たれ、ビットと値がでたらめに回る(まだ初期化されていない)
 * - 4〜6.5拍(キーワード): 半拍ごとに1行ずつ、ビットが上の桁から確定する。確定した値はデータバスを通って手前の口へ送られる
 * - 7拍目: 24バイト全体の CRC32 を計算して表示する
 * 値はこの作品の中で実際に使うもの(整流回路の定数と、次のシーン #5 のスピン格子の定数)。
 */

const PARAMS = [
  { name: 'V_p', value: 10 },
  { name: 'f', value: 130 / 120 },
  { name: 'R', value: 1000 },
  { name: 'C', value: 0.006 },
  { name: 'D', value: 1.4 },
  { name: 'B', value: 0.45 },
] as const;
/** i 行目が確定する拍 */
const lockAt = (i: number): number => 4 + i * 0.5;
/** 1行のビットが上の桁から確定していくのにかける拍数 */
const SWEEP = 0.3;
/** でたらめな値が切り替わる速さ [回/拍] */
const FLICKER = 8;
const CRC_AT = 7;

const PANEL = { x0: -0.19, x1: 0.178, y0: 0.018, y1: 0.142, z: -0.07 } as const;
const ROW = { top: 0.118, height: 0.0158 } as const;
const BIT = { x0: PANEL.x0 + 0.04, pitch: 0.0068, w: 0.0054, h: 0.0098 } as const;
const VALUE_X = BIT.x0 + 32 * BIT.pitch + 0.006;
/** 手前の口(次のシーンへ渡す) */
const PORT = new Vector3(0, 0, 0.07);

const rowY = (i: number): number => ROW.top - i * ROW.height;
const bitX = (bit: number): number => BIT.x0 + (31 - bit) * BIT.pitch + BIT.pitch / 2;

const ZERO = new Color(0x1a2a42);
const SIGN = new Color(PALETTE.warm);
const EXPONENT = new Color(PALETTE.cyan);
const MANTISSA = new Color(PALETTE.glow);

function hex32(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
}

/** 表示する値(binary32 に丸めて、意味のある桁まで) */
function formatValue(value: number): string {
  const f = toFloat32(value);
  return Number.isInteger(f) ? f.toFixed(1) : String(Number(f.toPrecision(6)));
}

/** 確定する前の、でたらめな値の表示(確定値と同じ形) */
function scramble(text: string, random: () => number): string {
  return text.replace(/[0-9A-F]/g, (ch, offset: number) => (text.startsWith('0x') && offset < 2 ? ch : '0123456789ABCDEF'[Math.floor(random() * 16)] ?? ch));
}

export const registers = defineScene('registers', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- パネル: 枠、足、ビットの区切り、見出し ----
  const { x0, x1, y0, y1, z } = PANEL;
  const frame = new LineBuilder()
    .polyline([new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)], true)
    .segment(new Vector3(x0, 0, z), new Vector3(x0, y0, z))
    .segment(new Vector3(x1, 0, z), new Vector3(x1, y0, z));
  const frameMaterial = fader.line(PALETTE.gridMajor, 0.6);
  root.add(frame.build(frameMaterial));
  const bottom = rowY(PARAMS.length - 1) - ROW.height / 2;
  const top = rowY(0) + ROW.height / 2;
  const fields = new LineBuilder();
  for (const bit of [31, 23, 0]) {
    // 符号 | 指数 | 仮数 の境目(bit の左)
    const x = bitX(bit) - BIT.pitch / 2;
    fields.segment(new Vector3(x, bottom, z), new Vector3(x, top + 0.004, z));
  }
  fields.segment(new Vector3(bitX(0) + BIT.pitch / 2, bottom, z), new Vector3(bitX(0) + BIT.pitch / 2, top + 0.004, z));
  root.add(fields.build(fader.line(PALETTE.gridMinor, 0.35)));
  const header = (text: string, x: number, color: number): void => {
    root.add(standLabel(fader, text, x, top + 0.006, z, { anchorX: 'left', anchorY: 'bottom', size: 0.0052, color }));
  };
  header('s', bitX(31) - 0.0015, PALETTE.warm);
  header('exponent (8)', bitX(30) - 0.002, PALETTE.cyan);
  header('mantissa (23)', bitX(22) - 0.002, PALETTE.glow);
  header('binary32', VALUE_X, PALETTE.label);

  // ---- 行: 名前、32 ビット、値 ----
  const bits = new InstancedMesh(
    new PlaneGeometry(BIT.w, BIT.h),
    fader.add(new MeshBasicMaterial({ color: 0xffffff, depthWrite: false })),
    PARAMS.length * 32,
  );
  const matrix = new Matrix4();
  PARAMS.forEach((_, row) => {
    for (let bit = 0; bit < 32; bit++) {
      bits.setMatrixAt(row * 32 + bit, matrix.makeTranslation(bitX(bit), rowY(row), z + 0.0004));
      bits.setColorAt(row * 32 + bit, ZERO);
    }
  });
  root.add(bits);
  const names: Text[] = PARAMS.map((_, row) => {
    const label = standLabel(fader, '', x0 + 0.006, rowY(row), z, { anchorX: 'left', size: 0.0068 });
    root.add(label);
    return label;
  });
  const values: Text[] = PARAMS.map((_, row) => {
    const label = standLabel(fader, '', VALUE_X, rowY(row), z, { anchorX: 'left', size: 0.0054, color: PALETTE.glow });
    root.add(label);
    return label;
  });
  const finalBits = PARAMS.map((p) => float32Bits(p.value));
  const finalText = PARAMS.map((p, row) => `${formatValue(p.value).padEnd(8)}${hex32(finalBits[row] ?? 0)}`);
  const checksum = crc32(float32Bytes(PARAMS.map((p) => p.value)));
  const crcLabel = standLabel(fader, `CRC32 = ${hex32(checksum)}   INIT OK`, x0 + 0.006, y0 + 0.004, z, { anchorX: 'left', anchorY: 'bottom', size: 0.0052, color: PALETTE.warm }, 0);
  root.add(crcLabel);

  // 確定させる行を指すカーソル
  const cursorMaterial = fader.line(PALETTE.warm, 0);
  const cursor = new LineBuilder()
    .segment(new Vector3(-0.007, 0, 0), new Vector3(0, 0, 0))
    .segment(new Vector3(-0.003, 0.0025, 0), new Vector3(0, 0, 0))
    .segment(new Vector3(-0.003, -0.0025, 0), new Vector3(0, 0, 0))
    .build(cursorMaterial);
  root.add(cursor);

  // ---- データバス: パネルの下から手前の口へ。確定した値が光の点になって流れる ----
  const busPaths = PARAMS.map((_, row) => {
    const x = -0.12 + row * 0.04;
    return [new Vector3(x, Y_INK, z + 0.002), new Vector3(x, Y_INK, 0.03), new Vector3(PORT.x + (row - 2.5) * 0.004, Y_INK, PORT.z - 0.012)];
  });
  const bus = new LineBuilder();
  for (const path of busPaths) bus.polyline(path);
  root.add(bus.build(fader.line(PALETTE.ink, 0.45)));
  root.add(
    new LineBuilder()
      .polyline([new Vector3(-0.016, Y_INK, PORT.z - 0.012), new Vector3(0.016, Y_INK, PORT.z - 0.012), new Vector3(0.016, Y_INK, PORT.z + 0.01), new Vector3(-0.016, Y_INK, PORT.z + 0.01)], true)
      .build(fader.line(PALETTE.ink, 0.8)),
  );
  root.add(floorLabel(fader, '-> FIG.05', PORT.x, PORT.z + 0.002, { size: 0.0052, color: PALETTE.label }));
  const pulsePositions = new BufferAttribute(new Float32Array(PARAMS.length * 3), 3);
  pulsePositions.setUsage(DynamicDrawUsage);
  const pulseGeometry = new BufferGeometry();
  pulseGeometry.setAttribute('position', pulsePositions);
  const pulseMaterial = fader.add(new PointsMaterial({ color: PALETTE.warm, size: 0.006, depthWrite: false }));
  const pulses = new Points(pulseGeometry, pulseMaterial);
  pulses.frustumCulled = false;
  root.add(pulses);

  root.add(titleBlock(fader, 4, 'PARAMETER REGISTERS', 'IEEE 754 binary32  s|exp|mantissa'));

  const color = new Color();
  const tmp = new Vector3();
  return {
    root,
    fader,
    update(beat, ctx) {
      // 同じ拍の位置では同じでたらめになるよう、時刻から乱数の種を決める
      const tick = Math.floor(beat * FLICKER);
      const pulse = beatPulse(ctx, 0.35);

      PARAMS.forEach((param, row) => {
        // 名前は最初の小節で打つ
        const nameLabel = names[row];
        if (nameLabel !== undefined) setText(nameLabel, param.name.slice(0, Math.floor(param.name.length * clamp01((beat - row * 0.25) / 0.4))));

        const random = seededRandom(tick * 131 + row * 7 + 1);
        const scrambled = Math.floor(random() * 0x100000000) >>> 0;
        const locked = beat - lockAt(row);
        for (let bit = 31; bit >= 0; bit--) {
          const fixedAt = ((31 - bit) / 31) * SWEEP;
          const isFixed = locked >= fixedAt;
          const on = ((isFixed ? (finalBits[row] ?? 0) : scrambled) >>> bit) & 1;
          const field = bit === 31 ? SIGN : bit >= 23 ? EXPONENT : MANTISSA;
          if (on === 1) {
            // 確定した直後は明るく、確定前はくすませる
            const flash = isFixed ? 0.75 + 0.25 * Math.exp(-(locked - fixedAt) / 0.3) : 0.45;
            color.copy(ZERO).lerp(field, flash);
          } else {
            color.copy(ZERO);
          }
          bits.setColorAt(row * 32 + bit, color);
        }

        const valueLabel = values[row];
        if (valueLabel !== undefined) {
          const full = finalText[row] ?? '';
          setText(valueLabel, locked >= SWEEP ? full : beat < 0.5 ? '' : scramble(full, random));
          valueLabel.color = locked >= SWEEP ? (locked < SWEEP + 0.6 ? PALETTE.warm : PALETTE.glow) : PALETTE.dim;
        }

        // データバスの光の点: 確定してから半拍で手前の口に着く
        const path = busPaths[row] ?? [];
        const k = smoothstep(progress(locked, [SWEEP, SWEEP + 0.6]));
        const a = path[0] ?? tmp;
        const b = path[1] ?? a;
        const cEnd = path[2] ?? b;
        if (k < 0.7) tmp.copy(a).lerp(b, k / 0.7);
        else tmp.copy(b).lerp(cEnd, (k - 0.7) / 0.3);
        pulsePositions.setXYZ(row, tmp.x, tmp.y + 0.002, tmp.z);
      });
      if (bits.instanceColor !== null) bits.instanceColor.needsUpdate = true;
      pulsePositions.needsUpdate = true;
      const travelling = PARAMS.filter((_, row) => {
        const locked = beat - lockAt(row);
        return locked >= SWEEP && locked < SWEEP + 0.6;
      }).length;
      fader.set(pulseMaterial, travelling > 0 ? 1 : 0);

      // カーソルは、次に確定する行へ移る
      const next = Math.min(Math.max(Math.floor((beat - 3.5) / 0.5), 0), PARAMS.length - 1);
      const k = smoothstep(progress(beat, [lockAt(next) - 0.4, lockAt(next) - 0.15]));
      const from = rowY(Math.max(next - 1, 0));
      cursor.position.set(BIT.x0 - 0.004, from + (rowY(next) - from) * k, z + 0.001);
      fader.set(cursorMaterial, beat >= 3 && beat < lockAt(PARAMS.length - 1) + 0.6 ? 0.9 : 0);

      fader.set(crcLabel, smoothstep(progress(beat, [CRC_AT, CRC_AT + 0.4])));
      fader.set(frameMaterial, 0.6 + (beat >= CRC_AT ? 0.3 * pulse : 0));
    },
  };
});
