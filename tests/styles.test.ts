import { describe, expect, test } from 'bun:test';
import { create, props, tokens, createTheme, darkTheme } from '../src/ui/styles';

describe('native styles', () => {
  test('last wins, including individual interaction properties; ignores conditionals', () => {
    const styles = create({
      base: { color: '#111111', padding: 8, hover: { color: '#333333', opacity: 0.8 } },
      active: { color: '#FFFFFF', hover: { color: '#EEEEEE' } },
    });
    expect(props(styles.base, false, null, undefined, styles.active)).toEqual({
      style: { color: '#FFFFFF', padding: 8, hover: { color: '#EEEEEE', opacity: 0.8 } },
    });
    expect(styles.base.hover.color).toBe('#333333');
  });
  test('themes override native values without mutating the token group', () => {
    expect(createTheme(tokens, { text: '#ABCDEF' }).text).toBe('#ABCDEF');
    expect(tokens.text).toBe('#202B3B');
    expect(darkTheme.canvas).toBe('#171C25');
  });
});
