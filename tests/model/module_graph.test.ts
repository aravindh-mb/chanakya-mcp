import { describe, expect, it } from 'vitest';
import { is_internal_specifier } from '../../src/model/module_graph.js';

describe('is_internal_specifier', () => {
  it.each(['./user.service', '../shared/db', './a/b/c.js', '.', '..', '/abs/path'])(
    'treats %s as internal',
    (specifier) => {
      expect(is_internal_specifier(specifier)).toBe(true);
    },
  );

  it.each(['react', 'react-dom/client', '@scope/pkg', '@scope/pkg/sub', 'node:fs', 'lodash'])(
    'treats %s as external',
    (specifier) => {
      expect(is_internal_specifier(specifier)).toBe(false);
    },
  );

  it('does not mistake a scoped package for a relative path', () => {
    // Both start with a non-alphanumeric character; only one is relative.
    expect(is_internal_specifier('@scope/pkg')).toBe(false);
    expect(is_internal_specifier('./scope/pkg')).toBe(true);
  });

  it('treats an alias-looking specifier as external', () => {
    // `~/x` and `@/x` are bundler aliases, not relative paths. Resolving them
    // needs tsconfig paths, which is not attempted here, so claiming they are
    // internal would be a guess.
    expect(is_internal_specifier('~/components/button')).toBe(false);
    expect(is_internal_specifier('@/lib/db')).toBe(false);
  });
});
