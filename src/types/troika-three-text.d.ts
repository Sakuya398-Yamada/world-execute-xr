// troika-three-text の同梱型(dist/types)は JSDoc からの自動生成で、Text が Mesh を継承していないなど
// three と組み合わせると使えないため、このプロジェクトで使う範囲だけ宣言する。
declare module 'troika-three-text' {
  import { Mesh, type ColorRepresentation } from 'three';

  export type TextAnchorX = number | `${number}%` | 'left' | 'center' | 'right';
  export type TextAnchorY =
    | number
    | `${number}%`
    | 'top'
    | 'top-baseline'
    | 'top-cap'
    | 'top-ex'
    | 'middle'
    | 'bottom-baseline'
    | 'bottom';

  export class Text extends Mesh {
    text: string;
    /** .ttf / .otf / .woff の URL。null だと既定フォントを CDN から取得する */
    font: string | null;
    fontSize: number;
    letterSpacing: number;
    color: ColorRepresentation | null;
    anchorX: TextAnchorX;
    anchorY: TextAnchorY;
    textAlign: 'left' | 'right' | 'center' | 'justify';
    fillOpacity: number;
    /** プロパティ変更をジオメトリに反映する(非同期、Worker で処理される) */
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
