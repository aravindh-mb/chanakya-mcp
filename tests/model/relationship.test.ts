import { describe, expect, it } from 'vitest';
import {
  build_relationship_id,
  is_relationship_kind,
  is_resolved,
  RELATIONSHIP_KINDS,
  type relationship,
} from '../../src/model/relationship.js';

function make_edge(overrides: Partial<relationship> = {}): relationship {
  return {
    id: 'edge',
    kind: 'calls',
    from_id: 'src/a.ts#function:caller',
    to_name: 'create_user',
    confidence: 'certain',
    file_path: 'src/a.ts',
    line: 10,
    ...overrides,
  };
}

describe('build_relationship_id', () => {
  it('encodes kind, endpoints and location', () => {
    const id = build_relationship_id({
      kind: 'calls',
      from_id: 'src/a.ts#function:caller',
      to_name: 'create_user',
      file_path: 'src/a.ts',
      line: 10,
    });

    expect(id).toBe('src/a.ts#calls:src/a.ts#function:caller->create_user@10');
  });

  it('distinguishes two calls to the same target on different lines', () => {
    const base = { kind: 'calls', from_id: 'f', to_name: 'g', file_path: 'a.ts' } as const;

    expect(build_relationship_id({ ...base, line: 1 })).not.toBe(build_relationship_id({ ...base, line: 2 }));
  });

  it('distinguishes edges of different kinds between the same symbols', () => {
    const base = { from_id: 'f', to_name: 'g', file_path: 'a.ts', line: 1 } as const;

    expect(build_relationship_id({ ...base, kind: 'calls' })).not.toBe(
      build_relationship_id({ ...base, kind: 'references' }),
    );
  });
});

describe('is_resolved', () => {
  it('is true only when the edge points at a known symbol', () => {
    expect(is_resolved(make_edge({ to_id: 'src/b.ts#function:create_user' }))).toBe(true);
    expect(is_resolved(make_edge())).toBe(false);
  });

  it('keeps the written name on an unresolved edge', () => {
    // An unresolved edge is a normal outcome, not an error. It must still carry
    // what the source said so the information is not lost.
    const edge = make_edge({ to_name: 'container.get("svc").run' });

    expect(is_resolved(edge)).toBe(false);
    expect(edge.to_name).toBe('container.get("svc").run');
  });
});

describe('is_relationship_kind', () => {
  it('accepts every declared kind', () => {
    for (const kind of RELATIONSHIP_KINDS) {
      expect(is_relationship_kind(kind)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(is_relationship_kind('inherits')).toBe(false);
    expect(is_relationship_kind(undefined)).toBe(false);
    expect(is_relationship_kind(3)).toBe(false);
  });

  it('covers the kinds the specification requires', () => {
    expect([...RELATIONSHIP_KINDS].sort()).toEqual(
      ['calls', 'contains', 'exports', 'extends', 'implements', 'imports', 'references'].sort(),
    );
  });
});
