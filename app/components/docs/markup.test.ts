import { describe, expect, it } from 'vitest';
import { parseInline, slugify, stripInline } from './markup';

describe('parseInline', () => {
  it('splits code, bold, link and text in order', () => {
    expect(parseInline('a `b` **c** [d](/e) f')).toEqual([
      { k: 'text', v: 'a ' },
      { k: 'code', v: 'b' },
      { k: 'text', v: ' ' },
      { k: 'bold', v: 'c' },
      { k: 'text', v: ' ' },
      { k: 'link', v: 'd', href: '/e' },
      { k: 'text', v: ' f' },
    ]);
  });
  it('returns plain text untouched and never interprets HTML', () => {
    expect(parseInline('<script>x</script>')).toEqual([{ k: 'text', v: '<script>x</script>' }]);
    expect(parseInline('')).toEqual([]);
  });
  it('leaves unmatched markers as text', () => {
    expect(stripInline('2 * 3 and `open')).toBe('2 * 3 and `open');
  });
});

describe('slugify', () => {
  it('makes stable ids', () => {
    expect(slugify('What is a `Walk`?')).toBe('what-is-a-walk');
    expect(slugify('  The three waits ')).toBe('the-three-waits');
  });
});
