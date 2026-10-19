import { rectifier } from './rectifier';
import type { SceneModule } from './types';

/** timeline.json の `scene` から引くシーンの一覧 */
export const sceneRegistry: ReadonlyMap<string, SceneModule> = new Map(
  [rectifier].map((scene) => [scene.id, scene]),
);
