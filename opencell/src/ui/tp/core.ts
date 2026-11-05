// Shared pendant types: screens, keys, and the services a screen can use (entry, choice popups, confirm).
import type { CellState } from '../../state';
import type { Interpreter } from '../../tp/interp';
import type { Jogger } from '../../jog';

export type Key = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'ENTER' | 'BKSP' | 'ITEM' | 'PREV'
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '-' | ',';

export interface Screen {
  id: string;
  title(): string;
  titleRight?(): string;
  /** Function key labels for the current page (5 entries; '' = unused). */
  fkeys(page: number): string[];
  /** Number of F-key pages (NEXT cycles). */
  pages?(): number;
  render(body: HTMLElement): void;
  fkey(i: number, shift: boolean, page: number): void;
  key(k: Key, shift: boolean): boolean;
  show?(): void;
}

export interface PendantApi {
  s: CellState;
  interp: Interpreter;
  jog: Jogger;
  /** Ask for a number; `initial` shown as hint. */
  askNumber(prompt: string, cb: (v: number) => void, first?: string): void;
  askText(prompt: string, initial: string, cb: (v: string) => void): void;
  choose(title: string, items: string[], cb: (i: number) => void, sel?: number): void;
  confirm(msg: string, cb: () => void): void;
  prompt(msg: string, level?: 'info' | 'warn'): void;
  open(id: string, arg?: unknown): void;
  back(): void;
  redraw(): void;
  readonly shift: boolean;
}

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const fmt = (v: number, d = 3) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(d);

/** Keep a cursor row inside a scrolling list. */
export function scrollIntoView(body: HTMLElement) {
  const cur = body.querySelector('.cur') as HTMLElement | null;
  if (cur) {
    const top = cur.offsetTop, bot = top + cur.offsetHeight;
    if (top < body.scrollTop) body.scrollTop = top - 4;
    else if (bot > body.scrollTop + body.clientHeight) body.scrollTop = bot - body.clientHeight + 4;
  }
}
