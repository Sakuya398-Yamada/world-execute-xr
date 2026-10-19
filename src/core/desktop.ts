import type { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** XR セッション外で、机の上のステージを OrbitControls で眺めるモード */
export class DesktopView {
  private readonly controls: OrbitControls;

  constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
    camera.position.set(0.03, 0.26, 0.36);
    this.controls = new OrbitControls(camera, domElement);
    this.controls.target.set(0, 0.02, -0.01);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 2;
    this.controls.update();
  }

  /** XR セッション開始時に呼ぶ。セッション中はカメラ姿勢が XR に書き換えられるので、終了時に戻せるよう保存する */
  suspend(): void {
    this.controls.saveState();
    this.controls.enabled = false;
  }

  resume(): void {
    this.controls.reset();
    this.controls.enabled = true;
  }

  update(): void {
    if (this.controls.enabled) {
      this.controls.update();
    }
  }
}
