import { cage } from './cage';
import { circle } from './circle';
import { descent } from './descent';
import { dizzy } from './dizzy';
import { epoch } from './epoch';
import { heap } from './heap';
import { kuramoto } from './kuramoto';
import { limit } from './limit';
import { maze } from './maze';
import { pca } from './pca';
import { power } from './power';
import { rectifier } from './rectifier';
import { registers } from './registers';
import { spins } from './spins';
import { sweep } from './sweep';
import { tangent } from './tangent';
import type { SceneModule } from './types';

/** timeline.json の `scene` から引くシーンの一覧(1番の歌詞の順) */
export const sceneRegistry: ReadonlyMap<string, SceneModule> = new Map(
  [power, cage, heap, registers, spins, pca, circle, tangent, limit, rectifier, dizzy, epoch, kuramoto, sweep, descent, maze].map(
    (scene) => [scene.id, scene],
  ),
);
