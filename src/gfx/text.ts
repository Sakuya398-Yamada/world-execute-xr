import fontUrl from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff?url';
import { MeshBasicMaterial, type ColorRepresentation } from 'three';
import { Text, type TextAnchorX, type TextAnchorY } from 'troika-three-text';

/**
 * troika の既定マテリアルは深度を書き込むので、半透明のラベルが先に描かれると、奥の床やグリッドが文字の形に抜けてしまう。
 * それを避けるため depthWrite: false のマテリアルを渡す。
 * 色はラベルごとに troika が uniform で持つので、全ラベルで共有してよい(Text.dispose() はマテリアルを破棄しない)。
 */
const BASE_MATERIAL = new MeshBasicMaterial({ transparent: true, depthWrite: false });

export interface LabelOptions {
  /** 文字の高さ [m] */
  readonly size: number;
  readonly color: ColorRepresentation;
  readonly anchorX?: TextAnchorX;
  readonly anchorY?: TextAnchorY;
}

/**
 * troika のラベル。フォントは同梱の IBM Plex Mono(latin)を使う。
 * troika の既定フォントは CDN から取得するため、オフラインや CDN に届かない環境でも表示できるようにしている。
 * latin サブセットなので ASCII 以外の文字は表示できない。
 */
export function createLabel(text: string, options: LabelOptions): Text {
  const label = new Text();
  label.text = text;
  label.font = fontUrl;
  label.material = BASE_MATERIAL;
  label.fontSize = options.size;
  label.color = options.color;
  label.anchorX = options.anchorX ?? 'center';
  label.anchorY = options.anchorY ?? 'middle';
  label.sync();
  return label;
}
