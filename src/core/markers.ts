import { Group, LineBasicMaterial, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/** シーンが無い時間にステージ原点を示す小さな十字 */
export function createOriginMarker(): Group {
  const group = new Group();
  group.name = 'origin-marker';
  const y = 0.0005;
  const lines = new LineBuilder()
    .segment(new Vector3(-0.015, y, 0), new Vector3(0.015, y, 0))
    .segment(new Vector3(0, y, -0.015), new Vector3(0, y, 0.015))
    .circle(new Vector3(0, y, 0), 0.008, X, Z, 32)
    .build(new LineBasicMaterial({ color: 0x8fc4ff, transparent: true, opacity: 0.7 }));
  group.add(lines);
  return group;
}

/** AR で机の面を指すレティクル。姿勢は hit-test の結果を matrix に直接入れる */
export function createReticle(): Group {
  const group = new Group();
  group.name = 'reticle';
  group.matrixAutoUpdate = false;
  group.visible = false;
  const lines = new LineBuilder()
    .circle(new Vector3(), 0.03, X, Z, 48)
    .circle(new Vector3(), 0.033, X, Z, 48)
    .segment(new Vector3(-0.01, 0, 0), new Vector3(0.01, 0, 0))
    .segment(new Vector3(0, 0, -0.01), new Vector3(0, 0, 0.01))
    .build(new LineBasicMaterial({ color: 0xffffff }));
  group.add(lines);
  return group;
}
