export interface StartPanelCallbacks {
  /** ファイルが選ばれた(ファイル選択、またはドラッグ&ドロップ) */
  onFile(file: File): void;
  /** 「音源なしで見る」が選ばれた */
  onSilent(): void;
}

/**
 * 起動画面。音源は同梱していないので、見る人に音源ファイルを選んでもらう。
 * - ファイル選択と、ページへのドラッグ&ドロップで選べる
 * - 選んだ音源の名前と長さを出し、解析した音源と長さが違えば警告する
 * - 音源なしで見ることもできる
 * 再生ボタン(PLAY / START AR)の出し入れは main が行う。
 */
export class StartPanel {
  private readonly root: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly status: HTMLElement;
  private readonly choose: HTMLButtonElement;
  private readonly input: HTMLInputElement;

  constructor(callbacks: StartPanelCallbacks) {
    this.root = document.createElement('section');
    this.root.className = 'start-panel';

    const title = document.createElement('h1');
    title.textContent = 'world.execute(me);';
    this.root.appendChild(title);

    this.intro = document.createElement('div');
    this.intro.className = 'start-intro';
    this.intro.append(
      paragraph('Mili「world.execute(me);」に合わせて動く、机の上の AR の映像作品です。音源は同梱していないので、お持ちの音源ファイルを選んでください。'),
      paragraph('This piece plays along with "world.execute(me);" by Mili. The song is not included; please choose your own audio file.', 'start-en'),
      paragraph('選んだファイルはこのブラウザの中にだけ保存され、どこにも送信されません。', 'start-note'),
    );
    this.root.appendChild(this.intro);

    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.accept = 'audio/*';
    this.input.hidden = true;
    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0];
      if (file !== undefined) callbacks.onFile(file);
      this.input.value = '';
    });
    this.root.appendChild(this.input);

    this.status = document.createElement('p');
    this.status.className = 'start-status';
    this.status.hidden = true;
    this.root.appendChild(this.status);

    const actions = document.createElement('div');
    actions.className = 'start-actions';
    this.choose = button('音源ファイルを選ぶ / CHOOSE AUDIO', 'start-choose', () => this.input.click());
    const silent = button('音源なしで見る / WATCH WITHOUT AUDIO', 'start-silent', () => callbacks.onSilent());
    actions.append(this.choose, silent);
    this.root.appendChild(actions);

    // ページのどこにドロップしても選べるようにする。再生中(この画面を隠している間)は受け付けない。
    // そのときもブラウザーがファイルを開いてページを離れないよう、既定の動作は止める
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!this.root.hidden) this.root.classList.add('dragging');
    });
    window.addEventListener('dragleave', () => this.root.classList.remove('dragging'));
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      this.root.classList.remove('dragging');
      const file = event.dataTransfer?.files[0];
      if (file !== undefined && !this.root.hidden) callbacks.onFile(file);
    });

    document.body.appendChild(this.root);
  }

  /** 音源が決まった。restored は前に選んだものを読み出したとき */
  showChosen(name: string, duration: number, warning: string | null, restored: boolean): void {
    this.status.hidden = false;
    this.status.classList.toggle('warn', warning !== null);
    this.status.textContent =
      `${restored ? '前回の音源' : '音源'}: ${name}(${formatDuration(duration)})` +
      (warning === null ? '' : `\n${warning}`);
    this.compact('別の音源を選ぶ / CHANGE AUDIO');
  }

  showSilent(): void {
    this.status.hidden = false;
    this.status.classList.remove('warn');
    this.status.textContent = '音源なしで再生します(映像だけ、曲の長さぶん進みます)';
    this.compact('音源ファイルを選ぶ / CHOOSE AUDIO');
  }

  showError(message: string): void {
    this.status.hidden = false;
    this.status.classList.add('warn');
    this.status.textContent = message;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** 音源が決まったら説明を畳んで、選び直すボタンだけ残す */
  private compact(chooseLabel: string): void {
    this.root.classList.add('compact');
    this.intro.hidden = true;
    this.choose.textContent = chooseLabel;
  }
}

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  if (className !== undefined) p.className = className;
  return p;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** 秒を m:ss.ss にする */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '?';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
