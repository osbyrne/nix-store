import type { StyleDesc } from '@gpuix/solid';

type StyleInput = Readonly<StyleDesc> | false | null | undefined;

/** Native StyleX-shaped API. No classes, CSS variables, or DOM involved. */
export function create<const T extends Record<string, StyleDesc>>(blocks: T): T {
  for (const block of Object.values(blocks)) {
    for (const key of ['hover', 'active', 'focusVisible'] as const) {
      if (block[key]) Object.freeze(block[key]);
    }
    Object.freeze(block);
  }
  return Object.freeze(blocks);
}

/** Last block wins per property; interaction states merge per property too. */
export function props(...blocks: StyleInput[]): { style: StyleDesc } {
  const style: StyleDesc = {};
  for (const block of blocks) {
    if (!block) continue;
    const states = { hover: style.hover, active: style.active, focusVisible: style.focusVisible };
    Object.assign(style, block);
    for (const key of ['hover', 'active', 'focusVisible'] as const) {
      if (block[key]) style[key] = { ...states[key], ...block[key] };
    }
  }
  return { style };
}

export function defineVars<const T extends Record<string, string | number>>(tokens: T): Readonly<T> {
  return Object.freeze({ ...tokens });
}
type TokenValues<T> = { readonly [K in keyof T]: T[K] extends number ? number : string };
export function createTheme<T extends Record<string, string | number>>(
  tokens: T,
  overrides: Partial<TokenValues<T>>,
): TokenValues<T> {
  return Object.freeze({ ...tokens, ...overrides }) as TokenValues<T>;
}

export const tokens = defineVars({
  canvas: '#F8F9FC', sidebar: '#ECF0F5D9', panel: '#FFFFFF',
  text: '#202B3B', muted: '#667386', subtle: '#8792A2', border: '#E1E6EE',
  accent: '#4266D5', wash: '#E9EEFC', accentText: '#FFFFFF',
});
export const lightTheme = createTheme(tokens, {});
export const darkTheme = createTheme(tokens, {
  canvas: '#171C25', sidebar: '#202735ED', panel: '#242C3A',
  text: '#EDF1FA', muted: '#A5B1C5', subtle: '#8997AF', border: '#354155',
  accent: '#9DB5FF', wash: '#303E61', accentText: '#172239',
});
export type Theme = typeof lightTheme;
