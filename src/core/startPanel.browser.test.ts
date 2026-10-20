import { afterEach, describe, expect, it } from 'vitest';
import { REFERENCE_VIDEO, StartPanel } from './startPanel';

const noop = (): void => undefined;

afterEach(() => {
  document.querySelector('.start-panel')?.remove();
});

describe('StartPanel', () => {
  it('参考にした映像へのリンクを、音源を選んだあとも出しておく', () => {
    const panel = new StartPanel({ onFile: noop, onSilent: noop });
    const link = document.querySelector<HTMLAnchorElement>('.start-panel .start-credit a');
    expect(link?.href).toBe(REFERENCE_VIDEO.url);
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');

    panel.showChosen('track.mp3', 212.25, null, false);
    expect(link?.closest('[hidden]')).toBeNull();
    expect(link?.getClientRects().length).toBeGreaterThan(0);
  });
});
