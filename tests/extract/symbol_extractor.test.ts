import { describe, expect, it } from 'vitest';
import { extract_symbols } from '../../src/extract/symbol_extractor.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { code_symbol, symbol_kind } from '../../src/model/symbol.js';

function extract(source: string, relative_path = 'src/a.ts') {
  const parsed = parse_source({ source, file_path: relative_path });
  return extract_symbols({ parsed, relative_path });
}

/** [name, kind] pairs, which is what most assertions care about. */
function names_and_kinds(symbols: readonly code_symbol[]): Array<[string, symbol_kind]> {
  return symbols.map((symbol) => [symbol.name, symbol.kind]);
}

function find(symbols: readonly code_symbol[], name: string): code_symbol {
  const found = symbols.find((symbol) => symbol.name === name);
  if (found === undefined) {
    throw new Error(`no symbol named ${name} in [${symbols.map((s) => s.name).join(', ')}]`);
  }
  return found;
}

describe('extract_symbols: declaration kinds', () => {
  it('extracts a function declaration', () => {
    const { symbols } = extract('function foo() {}');

    expect(names_and_kinds(symbols)).toEqual([['foo', 'function']]);
  });

  it('extracts a class declaration', () => {
    const { symbols } = extract('class user {}');

    expect(names_and_kinds(symbols)).toEqual([['user', 'class']]);
  });

  it('extracts a method inside a class', () => {
    const { symbols } = extract('class user { create_user() {} }');

    expect(names_and_kinds(symbols)).toEqual([
      ['user', 'class'],
      ['create_user', 'method'],
    ]);
  });

  it('extracts an interface', () => {
    const { symbols } = extract('interface user {}');

    expect(names_and_kinds(symbols)).toEqual([['user', 'interface']]);
  });

  it('extracts a type alias', () => {
    const { symbols } = extract('type user_id = string;');

    expect(names_and_kinds(symbols)).toEqual([['user_id', 'type']]);
  });

  it('extracts an enum', () => {
    const { symbols } = extract('enum color { red, blue }');

    expect(names_and_kinds(symbols)).toEqual([['color', 'enum']]);
  });

  it('extracts a namespace as a module', () => {
    const { symbols } = extract('namespace ns { }');

    expect(names_and_kinds(symbols)).toEqual([['ns', 'module']]);
  });

  it('distinguishes const from let and var', () => {
    const { symbols } = extract('const a = 1; let b = 2; var c = 3;');

    expect(names_and_kinds(symbols)).toEqual([
      ['a', 'constant'],
      ['b', 'variable'],
      ['c', 'variable'],
    ]);
  });

  it('extracts an object literal binding as a constant', () => {
    const { symbols } = extract('const user = {};');

    expect(names_and_kinds(symbols)).toEqual([['user', 'constant']]);
  });

  it('extracts an abstract class and its abstract method', () => {
    const { symbols } = extract('abstract class base { abstract run(): void; }');

    expect(names_and_kinds(symbols)).toEqual([
      ['base', 'class'],
      ['run', 'method'],
    ]);
  });

  it('extracts interface methods', () => {
    const { symbols } = extract('interface repo { find(id: string): user; }');

    expect(names_and_kinds(symbols)).toEqual([
      ['repo', 'interface'],
      ['find', 'method'],
    ]);
  });

  it('extracts a generator function', () => {
    const { symbols } = extract('function* gen() {}');

    expect(names_and_kinds(symbols)).toEqual([['gen', 'function']]);
  });
});

describe('extract_symbols: arrow functions', () => {
  it('records a const arrow function as a function, not a constant', () => {
    // The dominant declaration style in React and modern TypeScript. Someone
    // searching for a function must find it.
    const { symbols } = extract('const handler = (a: number) => a;');

    expect(names_and_kinds(symbols)).toEqual([['handler', 'function']]);
  });

  it('records a const function expression as a function', () => {
    const { symbols } = extract('const handler = function () { return 1; };');

    expect(names_and_kinds(symbols)).toEqual([['handler', 'function']]);
  });

  it('still records a non-function const as a constant', () => {
    const { symbols } = extract('const max_retries = 3;');

    expect(names_and_kinds(symbols)).toEqual([['max_retries', 'constant']]);
  });
});

describe('extract_symbols: nesting and containment', () => {
  it('records nested functions', () => {
    const { symbols } = extract('function outer() { function inner() {} }');

    expect(names_and_kinds(symbols)).toEqual([
      ['outer', 'function'],
      ['inner', 'function'],
    ]);
  });

  it('links a method to its class through parent_id', () => {
    const { symbols } = extract('class user_service { create_user() {} }');
    const parent = find(symbols, 'user_service');
    const method = find(symbols, 'create_user');

    expect(method.parent_id).toBe(parent.id);
    expect(parent.parent_id).toBeUndefined();
  });

  it('encodes the container path in nested ids', () => {
    const { symbols } = extract('class svc { run() {} }', 'src/svc.ts');

    expect(find(symbols, 'run').id).toBe('src/svc.ts#method:svc.run');
  });

  it('handles three levels of nesting', () => {
    const { symbols } = extract('namespace ns { class c { m() {} } }', 'a.ts');

    expect(find(symbols, 'm').id).toBe('a.ts#method:ns.c.m');
  });

  it('emits a contains relationship for each nested symbol', () => {
    const { symbols, relationships } = extract('class svc { run() {} }');
    const contains = relationships.filter((edge) => edge.kind === 'contains');

    expect(contains).toHaveLength(1);
    expect(contains[0]?.from_id).toBe(find(symbols, 'svc').id);
    expect(contains[0]?.to_id).toBe(find(symbols, 'run').id);
    expect(contains[0]?.confidence).toBe('certain');
  });

  it('emits no contains relationship for a top-level symbol', () => {
    expect(extract('function foo() {}').relationships).toEqual([]);
  });

  it('separates two same-named methods on different classes', () => {
    const { symbols } = extract('class a { run() {} } class b { run() {} }');
    const ids = symbols.filter((symbol) => symbol.name === 'run').map((symbol) => symbol.id);

    expect(new Set(ids).size).toBe(2);
  });
});

describe('extract_symbols: exports', () => {
  it('marks a named export', () => {
    const { symbols } = extract('export function foo() {}');

    expect(find(symbols, 'foo').export_kind).toBe('named');
  });

  it('marks a default export', () => {
    const { symbols } = extract('export default class user {}');

    expect(find(symbols, 'user').export_kind).toBe('default');
  });

  it('names an anonymous default export "default"', () => {
    const { symbols } = extract('export default function () {}');

    expect(names_and_kinds(symbols)).toEqual([['default', 'function']]);
  });

  it('creates no symbol for a default export of an existing name', () => {
    // `export default foo` re-exports a symbol; it does not declare one.
    const { symbols } = extract('function foo() {}\nexport default foo;');

    expect(names_and_kinds(symbols)).toEqual([['foo', 'function']]);
  });

  it('does not name a nested function expression "default"', () => {
    // Only the export statement's direct value may become `default`. Without
    // that guard, every inline callback under a default export would be
    // recorded as the module's default export.
    const { symbols } = extract('export default { handler: function () {} };');

    expect(symbols.map((symbol) => symbol.name)).not.toContain('default');
  });

  it('does not name a callback inside a default-exported function "default"', () => {
    const { symbols } = extract('export default function () { [1].map(function () {}); }');

    expect(names_and_kinds(symbols)).toEqual([['default', 'function']]);
  });

  it('marks a non-exported declaration as none', () => {
    const { symbols } = extract('function internal_only() {}');

    expect(find(symbols, 'internal_only').export_kind).toBe('none');
  });

  it('does not treat a method as exported because its class is', () => {
    // `export class a { m() {} }` exports `a`, not `a.m` independently.
    const { symbols } = extract('export class a { m() {} }');

    expect(find(symbols, 'a').export_kind).toBe('named');
    expect(find(symbols, 'm').export_kind).toBe('none');
  });

  it('marks an exported const arrow function', () => {
    const { symbols } = extract('export const Button = () => null;', 'src/Button.tsx');

    expect(find(symbols, 'Button').export_kind).toBe('named');
    expect(find(symbols, 'Button').kind).toBe('function');
  });
});

describe('extract_symbols: ambient declarations', () => {
  it('marks declare statements as ambient', () => {
    const { symbols } = extract('declare function ambient_fn(): void;');

    expect(find(symbols, 'ambient_fn').is_ambient).toBe(true);
  });

  it('marks everything in a .d.ts file as ambient', () => {
    const { symbols } = extract('export interface user { id: string }', 'types/user.d.ts');

    expect(find(symbols, 'user').is_ambient).toBe(true);
  });

  it('does not mark ordinary declarations as ambient', () => {
    const { symbols } = extract('function normal() {}');

    expect(find(symbols, 'normal').is_ambient).toBe(false);
  });
});

describe('extract_symbols: locations', () => {
  it('records 1-based start and end lines', () => {
    const { symbols } = extract('const a = 1;\n\nfunction target() {\n  return 1;\n}');
    const target = find(symbols, 'target');

    expect(target.start_line).toBe(3);
    expect(target.end_line).toBe(5);
  });

  it('records 1-based columns', () => {
    const { symbols } = extract('  function indented() {}');

    expect(find(symbols, 'indented').start_column).toBe(3);
  });

  it('spans the whole declaration, not just the name', () => {
    const source = 'class svc {\n  run() {}\n}';
    const { symbols } = extract(source);
    const svc = find(symbols, 'svc');

    expect(svc.start_line).toBe(1);
    expect(svc.end_line).toBe(3);
  });
});

describe('extract_symbols: signatures', () => {
  it('captures a function signature without the body', () => {
    const { symbols } = extract('async function create_user(input: user_input): Promise<user> { return x; }');

    expect(find(symbols, 'create_user').signature).toBe(
      'async function create_user(input: user_input): Promise<user>',
    );
  });

  it('captures a method signature', () => {
    const { symbols } = extract('class s { async create_user(u: user): Promise<void> { await x(); } }');

    expect(find(symbols, 'create_user').signature).toBe('async create_user(u: user): Promise<void>');
  });

  it('includes the declaring keyword for an arrow function', () => {
    const { symbols } = extract('const handler = (a: number): number => a;');

    expect(find(symbols, 'handler').signature).toBe('const handler = (a: number): number =>');
  });

  it('captures class heritage', () => {
    const { symbols } = extract('class user_service extends base implements iface { }');

    expect(find(symbols, 'user_service').signature).toBe('class user_service extends base implements iface');
  });

  it('captures a type alias in full', () => {
    const { symbols } = extract('type user_id = string;');

    expect(find(symbols, 'user_id').signature).toBe('type user_id = string');
  });

  it('collapses a signature spread over several lines', () => {
    const { symbols } = extract('function f(\n  a: string,\n  b: number,\n) {}');

    expect(find(symbols, 'f').signature).toBe('function f( a: string, b: number, )');
  });

  it('truncates a very long signature', () => {
    const parameters = Array.from({ length: 60 }, (_unused, index) => `p${index}: string`).join(', ');
    const { symbols } = extract(`function f(${parameters}) {}`);
    const signature = find(symbols, 'f').signature ?? '';

    expect(signature.length).toBeLessThanOrEqual(200);
    expect(signature.endsWith('...')).toBe(true);
  });
});

describe('extract_symbols: function-local declarations', () => {
  it('does not index a data variable local to a function', () => {
    // Names like `stack` or `index` are meaningless to search for and would
    // bury real results.
    const { symbols } = extract('function run() { const stack = []; let index = 0; return index; }');

    expect(names_and_kinds(symbols)).toEqual([['run', 'function']]);
  });

  it('does not index a data variable local to a method', () => {
    const { symbols } = extract('class c { run() { const total = 1; } }');

    expect(names_and_kinds(symbols)).toEqual([
      ['c', 'class'],
      ['run', 'method'],
    ]);
  });

  it('does not index a data variable inside a callback', () => {
    // A callback is not a symbol, but its body is still function-local scope.
    const { symbols } = extract('items.map(() => { const scratch = 1; });');

    expect(symbols).toEqual([]);
  });

  it('still indexes a function declared inside a function', () => {
    const { symbols } = extract('function outer() { function inner() {} }');

    expect(names_and_kinds(symbols)).toEqual([
      ['outer', 'function'],
      ['inner', 'function'],
    ]);
  });

  it('still indexes an arrow function declared inside a function', () => {
    // A named callable is worth looking up however it is scoped.
    const { symbols } = extract('function outer() { const helper = () => 1; }');

    expect(names_and_kinds(symbols)).toEqual([
      ['outer', 'function'],
      ['helper', 'function'],
    ]);
  });

  it('still indexes a class declared inside a function', () => {
    const { symbols } = extract('function factory() { class built {} }');

    expect(names_and_kinds(symbols)).toEqual([
      ['factory', 'function'],
      ['built', 'class'],
    ]);
  });

  it('indexes module-level constants', () => {
    const { symbols } = extract('const max_retries = 3;');

    expect(names_and_kinds(symbols)).toEqual([['max_retries', 'constant']]);
  });

  it('indexes constants declared inside a namespace', () => {
    // A namespace body is not a function body.
    const { symbols } = extract('namespace config { export const timeout = 5; }');

    expect(names_and_kinds(symbols)).toEqual([
      ['config', 'module'],
      ['timeout', 'constant'],
    ]);
  });

  it('indexes a constant inside a block that is not a function', () => {
    const { symbols } = extract('if (flag) { const level = 1; }');

    expect(names_and_kinds(symbols)).toEqual([['level', 'constant']]);
  });
});

describe('extract_symbols: things it deliberately does not claim', () => {
  it('does not invent a name for a destructuring binding', () => {
    // Several names are bound at once; reporting one invented name would be
    // worse than reporting none. They remain visible as references.
    const { symbols } = extract('const { a, b: renamed } = obj;');

    expect(symbols).toEqual([]);
  });

  it('does not invent a name for an array destructuring binding', () => {
    expect(extract('const [first, second] = arr;').symbols).toEqual([]);
  });

  it('still descends into a destructured declaration', () => {
    const { symbols } = extract('const { handler = () => { function inner() {} } } = opts;');

    expect(symbols.map((symbol) => symbol.name)).toContain('inner');
  });

  it('does not record class fields as symbols', () => {
    // There is no symbol kind for a property, and inventing one would deviate
    // from the model. Fields remain reachable as references.
    const { symbols } = extract('class c { private db: string; run() {} }');

    expect(names_and_kinds(symbols)).toEqual([
      ['c', 'class'],
      ['run', 'method'],
    ]);
  });

  it('does not record interface properties as symbols', () => {
    const { symbols } = extract('interface user { id: string; name: string; }');

    expect(names_and_kinds(symbols)).toEqual([['user', 'interface']]);
  });
});

describe('extract_symbols: unusual but valid code', () => {
  it('keeps the source form of a computed method name', () => {
    const { symbols } = extract('class c { [Symbol.iterator]() {} }');

    expect(symbols.map((symbol) => symbol.name)).toEqual(['c', '[Symbol.iterator]']);
  });

  it('unquotes a string method name', () => {
    const { symbols } = extract('class c { "str-key"() {} }');

    expect(symbols.map((symbol) => symbol.name)).toEqual(['c', 'str-key']);
  });

  it('keeps a private method name including the hash', () => {
    const { symbols } = extract('class c { #secret() {} }');

    expect(symbols.map((symbol) => symbol.name)).toEqual(['c', '#secret']);
  });

  it('unquotes an ambient module name', () => {
    const { symbols } = extract("declare module 'my-package' { }");

    expect(names_and_kinds(symbols)).toEqual([['my-package', 'module']]);
  });

  it('disambiguates two overloads of the same name', () => {
    const { symbols } = extract('function f(a: string): void;\nfunction f(a: number): void;');
    const ids = symbols.map((symbol) => symbol.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).not.toContain('~');
    expect(ids[1]).toContain('~2');
  });

  it('gives colliding contains edges distinct ids', () => {
    // A getter/setter pair on one line produces two edges identical in kind,
    // endpoints, file and line. Without a disambiguator these collide, which
    // only surfaced as a UNIQUE constraint failure when indexing real code.
    const { relationships } = extract('class c { get x() {} set x(v: number) {} }');
    const ids = relationships.map((edge) => edge.id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('gives colliding overload edges distinct ids', () => {
    const { relationships } = extract('interface i { f(): void; f(a: string): void }');
    const ids = relationships.map((edge) => edge.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the clean edge id when there is no collision', () => {
    const { relationships } = extract('class d { m() {} }');

    expect(relationships[0]?.id).not.toContain('~');
  });

  it('extracts from a file with syntax errors', () => {
    // Error tolerance has to survive all the way through extraction.
    const { symbols } = extract('function ok() {}\nclass !!! {}\nfunction also_ok() {}');

    expect(symbols.map((symbol) => symbol.name)).toEqual(['ok', 'also_ok']);
  });

  it('returns nothing for an empty file', () => {
    expect(extract('').symbols).toEqual([]);
  });

  it('returns nothing for a comment-only file', () => {
    expect(extract('// nothing here\n/* at all */').symbols).toEqual([]);
  });
});

describe('extract_symbols: javascript and jsx', () => {
  it('extracts from plain JavaScript', () => {
    const { symbols } = extract('export function foo(a) { return a; }', 'src/a.js');

    expect(names_and_kinds(symbols)).toEqual([['foo', 'function']]);
  });

  it('extracts a React component from a jsx file', () => {
    const { symbols } = extract('export const Button = ({ label }) => <button>{label}</button>;', 'a.jsx');
    const button = find(symbols, 'Button');

    expect(button.kind).toBe('function');
    expect(button.export_kind).toBe('named');
  });

  it('extracts a React component from a tsx file', () => {
    const source = 'export function Card({ title }: { title: string }) { return <div>{title}</div>; }';
    const { symbols } = extract(source, 'src/Card.tsx');

    expect(find(symbols, 'Card').kind).toBe('function');
    expect(find(symbols, 'Card').language).toBe('tsx');
  });

  it('extracts a class component with methods', () => {
    const source = 'export default class App extends React.Component { render() { return <div />; } }';
    const { symbols } = extract(source, 'src/App.jsx');

    expect(names_and_kinds(symbols)).toEqual([
      ['App', 'class'],
      ['render', 'method'],
    ]);
    expect(find(symbols, 'App').export_kind).toBe('default');
  });
});

describe('extract_symbols: file metadata', () => {
  it('stamps every symbol with the relative path and language', () => {
    const { symbols } = extract('function a() {} class b {}', 'apps/api/src/x.ts');

    for (const symbol of symbols) {
      expect(symbol.file_path).toBe('apps/api/src/x.ts');
      expect(symbol.language).toBe('typescript');
    }
  });

  it('produces ids unique within a file', () => {
    const source = `
      export class svc { run() {} stop() {} }
      export function run() {}
      const run_handler = () => {};
      interface run {}
    `;
    const { symbols } = extract(source);
    const ids = symbols.map((symbol) => symbol.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
