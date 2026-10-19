/** AR セッション中だけ表示される DOM overlay の root。表示/非表示は ARButton が切り替える */
export class ArOverlay {
  readonly root: HTMLElement;
  private readonly hint: HTMLElement;

  constructor(onClose: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'xr-overlay';
    this.root.style.display = 'none';

    this.hint = document.createElement('p');
    this.hint.className = 'xr-hint';
    this.root.appendChild(this.hint);

    const close = document.createElement('button');
    close.className = 'xr-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'AR を終了');
    close.textContent = '×';
    close.addEventListener('click', onClose);
    // overlay のボタンを押したときに XR の select(= ステージ配置)が発火しないようにする
    close.addEventListener('beforexrselect', (event) => event.preventDefault());
    this.root.appendChild(close);

    document.body.appendChild(this.root);
  }

  setHint(text: string | null): void {
    this.hint.textContent = text ?? '';
    this.hint.hidden = text === null;
  }
}

/** デスクトップモードで再生を始めるボタン(自動再生の制限があるので、音を出すには1回クリックが要る) */
export class PlayOverlay {
  private readonly button: HTMLButtonElement;

  constructor(onPlay: () => void) {
    this.button = document.createElement('button');
    this.button.className = 'play-overlay';
    this.button.type = 'button';
    this.button.addEventListener('click', onPlay);
    document.body.appendChild(this.button);
    this.show('PLAY');
  }

  get visible(): boolean {
    return !this.button.hidden;
  }

  show(label: 'PLAY' | 'REPLAY'): void {
    this.button.textContent = `> ${label}`;
    this.button.hidden = false;
  }

  hide(): void {
    this.button.hidden = true;
  }
}

/** `?debug` のときだけ出す、再生位置などの表示 */
export class DebugHud {
  private readonly el: HTMLElement;
  private readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.el = document.createElement('pre');
    this.el.className = 'debug-hud';
    this.el.hidden = !enabled;
    document.body.appendChild(this.el);
  }

  /** AR 中は DOM overlay の root の中にないと表示されないので、親を付け替える */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.el);
  }

  update(lines: readonly string[]): void {
    if (this.enabled) {
      this.el.textContent = lines.join('\n');
    }
  }
}

export function showFatal(error: unknown): void {
  const el = document.createElement('pre');
  el.className = 'fatal';
  el.textContent = error instanceof Error ? error.message : String(error);
  document.body.appendChild(el);
  console.error(error);
}
