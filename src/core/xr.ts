import { Matrix4, Quaternion, Vector3, type Group, type Object3D, type WebGLRenderer } from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import type { ArOverlay } from './ui';

export interface ArCallbacks {
  /** セッション開始直後(まだステージ原点は決まっていない) */
  onSessionStart(): void;
  /** タップでステージ原点が決まった */
  onPlaced(): void;
  onSessionEnd(): void;
}

const UP = new Vector3(0, 1, 0);

/**
 * immersive-ar セッションの開始と、hit-test による机の検出 → タップした位置をステージ原点に確定する処理。
 * anchors が使える環境では原点を anchor に紐づけ、トラッキングの補正に追従させる。
 */
export class ArStageController {
  readonly button: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly stage: Group;
  private readonly reticle: Object3D;
  private readonly callbacks: ArCallbacks;

  private session: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private placeRequested = false;
  private placed = false;
  private anchor: XRAnchor | null = null;
  /** anchor の姿勢 → ステージの姿勢 への変換 */
  private readonly anchorToStage = new Matrix4();
  private readonly tmp = new Matrix4();

  constructor(renderer: WebGLRenderer, stage: Group, reticle: Object3D, overlay: ArOverlay, callbacks: ArCallbacks) {
    this.renderer = renderer;
    this.stage = stage;
    this.reticle = reticle;
    this.callbacks = callbacks;

    this.button = ARButton.createButton(renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors', 'plane-detection'],
      domOverlay: { root: overlay.root },
    });

    renderer.xr.addEventListener('sessionstart', () => {
      this.onSessionStart().catch((error: unknown) => {
        console.warn('hit-test を開始できませんでした', error);
      });
    });
    renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
  }

  /** anchors が有効になっているか(デバッグ表示用) */
  get anchorState(): 'tracking' | 'fixed' | 'none' {
    if (!this.placed) return 'none';
    return this.anchor === null ? 'fixed' : 'tracking';
  }

  get isPlaced(): boolean {
    return this.placed;
  }

  endSession(): void {
    void this.session?.end();
  }

  /** XR のフレームごとに呼ぶ */
  update(frame: XRFrame): void {
    const refSpace = this.renderer.xr.getReferenceSpace();
    if (refSpace === null) return;

    if (this.placed) {
      this.followAnchor(frame, refSpace);
      return;
    }
    if (this.hitTestSource === null) return;

    const hit = frame.getHitTestResults(this.hitTestSource)[0];
    const pose = hit?.getPose(refSpace);
    if (hit === undefined || pose === undefined) {
      this.reticle.visible = false;
      this.placeRequested = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.matrix.fromArray(pose.transform.matrix);

    // createAnchor は有効なフレームの中でしか呼べないので、select イベントではなくここで配置する
    if (this.placeRequested) {
      this.placeRequested = false;
      this.place(frame, refSpace, hit, pose);
    }
  }

  private async onSessionStart(): Promise<void> {
    const session = this.renderer.xr.getSession();
    if (session === null) return;
    this.session = session;
    session.addEventListener('select', this.onSelect);
    this.callbacks.onSessionStart();

    const viewerSpace = await session.requestReferenceSpace('viewer');
    const source = await session.requestHitTestSource?.({ space: viewerSpace });
    if (source === undefined) {
      throw new Error('requestHitTestSource が使えません');
    }
    if (this.session !== session) {
      // 待っている間にセッションが終わった
      source.cancel();
      return;
    }
    this.hitTestSource = source;
  }

  private onSessionEnd(): void {
    this.session?.removeEventListener('select', this.onSelect);
    this.session = null;
    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.anchor?.delete();
    this.anchor = null;
    this.placed = false;
    this.placeRequested = false;
    this.reticle.visible = false;
    this.stage.position.set(0, 0, 0);
    this.stage.quaternion.identity();
    this.stage.scale.set(1, 1, 1);
    this.callbacks.onSessionEnd();
  }

  private readonly onSelect = (): void => {
    if (!this.placed && this.reticle.visible) {
      this.placeRequested = true;
    }
  };

  private place(frame: XRFrame, refSpace: XRReferenceSpace, hit: XRHitTestResult, pose: XRPose): void {
    const hitMatrix = new Matrix4().fromArray(pose.transform.matrix);
    const position = new Vector3().setFromMatrixPosition(hitMatrix);

    // 机は水平とみなし、鉛直軸まわりだけ回して、ステージの手前(+Z)が見ている人の方を向くようにする
    const viewer = frame.getViewerPose(refSpace)?.transform.position;
    const yaw = viewer === undefined ? 0 : Math.atan2(viewer.x - position.x, viewer.z - position.z);
    const stageMatrix = new Matrix4().compose(
      position,
      new Quaternion().setFromAxisAngle(UP, yaw),
      new Vector3(1, 1, 1),
    );
    stageMatrix.decompose(this.stage.position, this.stage.quaternion, this.stage.scale);

    this.placed = true;
    this.reticle.visible = false;
    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.callbacks.onPlaced();
    void this.attachAnchor(hit, hitMatrix, stageMatrix);
  }

  /** anchors が使えない環境では何もしない(配置した時点の姿勢で固定される) */
  private async attachAnchor(hit: XRHitTestResult, hitMatrix: Matrix4, stageMatrix: Matrix4): Promise<void> {
    const session = this.session;
    let anchor: XRAnchor | undefined;
    try {
      // await より前の同期部分で呼ぶので、まだ有効なフレームの中にいる
      anchor = await hit.createAnchor?.();
    } catch (error) {
      console.warn('anchor を作成できなかったため、配置した時点の姿勢で固定します', error);
      return;
    }
    if (anchor === undefined) return;
    if (this.session !== session || !this.placed) {
      anchor.delete();
      return;
    }
    this.anchor = anchor;
    this.anchorToStage.copy(hitMatrix).invert().multiply(stageMatrix);
  }

  private followAnchor(frame: XRFrame, refSpace: XRReferenceSpace): void {
    if (this.anchor === null || frame.trackedAnchors?.has(this.anchor) !== true) return;
    const pose = frame.getPose(this.anchor.anchorSpace, refSpace);
    if (pose === undefined) return;
    this.tmp.fromArray(pose.transform.matrix).multiply(this.anchorToStage);
    this.tmp.decompose(this.stage.position, this.stage.quaternion, this.stage.scale);
  }
}
