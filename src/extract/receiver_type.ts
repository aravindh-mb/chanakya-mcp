/**
 * The declared type of a call's receiver, when the source writes it down.
 *
 * `service.create_user()` names no symbol by itself: `service` is a value. But
 * when `service` is declared `service: user_service`, or initialised with
 * `new user_service()`, the method being called is `user_service.create_user`
 * as surely as an editor's "go to definition" says so. This module finds that
 * declaration by walking outwards through the lexical scopes around the call.
 *
 * It answers only from what is written. The nearest declaration of the name
 * decides: if that declaration has no plain type (an untyped parameter, a
 * destructured binding, a value from a call), the answer is `undefined`, even
 * when an outer scope declares the same name with a type. Shadowing is
 * respected and nothing is inferred, so no edge is ever pointed at a guess.
 */

import type { syntax_node } from '../parser/types.js';

/** Nodes whose `parameters` introduce names for their body. */
const FUNCTION_TYPES: ReadonlySet<string> = new Set([
  'function_declaration',
  'function_expression',
  'function',
  'generator_function_declaration',
  'generator_function',
  'arrow_function',
  'method_definition',
]);

/** Nodes whose direct statements can declare block-scoped or hoisted names. */
const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'statement_block',
  'program',
  'switch_case',
  'class_static_block',
]);

const DECLARATION_TYPES: ReadonlySet<string> = new Set(['lexical_declaration', 'variable_declaration']);

/**
 * The type a call's receiver is declared with.
 *
 * `chain` is the callee as written (`['service', 'create_user']`,
 * `['this', 'orders', 'list']`). Returns the type name and how many leading
 * segments of the chain it replaces, or `undefined` when the receiver has no
 * plainly written type.
 */
export function receiver_type_of(
  callee: syntax_node,
  chain: readonly string[],
): { readonly type_name: string; readonly receiver_length: number } | undefined {
  if (chain[0] === 'this') {
    if (chain.length < 3) {
      return undefined;
    }
    const type_name = class_member_type(callee, chain[1]!);
    return type_name === undefined ? undefined : { type_name, receiver_length: 2 };
  }
  if (chain.length < 2) {
    return undefined;
  }
  const type_name = binding_type(callee, chain[0]!);
  return type_name === undefined ? undefined : { type_name, receiver_length: 1 };
}

/** The declared type of the nearest binding of `name` visible from `from`. */
function binding_type(from: syntax_node, name: string): string | undefined {
  for (let node = from.parent; node !== undefined; node = node.parent) {
    if (FUNCTION_TYPES.has(node.type)) {
      const found = parameter_declaring(node, name);
      if (found !== undefined) {
        return found.type_name;
      }
    } else if (BLOCK_TYPES.has(node.type)) {
      const found = block_declaring(node, name);
      if (found !== undefined) {
        return found.type_name;
      }
    } else if (
      node.type === 'catch_clause' ||
      node.type === 'for_statement' ||
      node.type === 'for_in_statement'
    ) {
      // Loop variables and caught errors are declared here, untyped for our
      // purposes; if one of them is `name`, it shadows anything further out.
      if (declares_name_outside_body(node, name)) {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * The declared type of `this.<name>` inside a class: a typed field, or a
 * constructor parameter property (`constructor(private users: user_repository)`).
 *
 * `this` means the class instance only inside its methods and the arrow
 * functions within them. A plain `function` or an object-literal method in
 * between rebinds `this`, so the answer there is `undefined`.
 */
function class_member_type(from: syntax_node, name: string): string | undefined {
  for (let node = from.parent; node !== undefined; node = node.parent) {
    if (node.type === 'method_definition' && node.parent?.type !== 'class_body') {
      return undefined;
    }
    if (
      FUNCTION_TYPES.has(node.type) &&
      node.type !== 'arrow_function' &&
      node.type !== 'method_definition'
    ) {
      return undefined;
    }
    if (node.type === 'class_body') {
      return member_type_in_class(node, name);
    }
  }
  return undefined;
}

function member_type_in_class(body: syntax_node, name: string): string | undefined {
  for (const member of body.named_children) {
    if (member.type === 'public_field_definition') {
      const field_name = member.child_by_field('name');
      if (field_name?.text === name) {
        return plain_type(member.child_by_field('type'));
      }
    }
    if (member.type === 'method_definition' && member.child_by_field('name')?.text === 'constructor') {
      for (const parameter of member.child_by_field('parameters')?.named_children ?? []) {
        const is_property =
          parameter.named_children.some(
            (child) => child.type === 'accessibility_modifier' || child.type === 'override_modifier',
          ) || parameter.children.some((child) => child.type === 'readonly');
        if (is_property && parameter.child_by_field('pattern')?.text === name) {
          return plain_type(parameter.child_by_field('type'));
        }
      }
    }
  }
  return undefined;
}

/** A parameter of `fn` named `name`, with its plain type if it has one. */
function parameter_declaring(
  fn: syntax_node,
  name: string,
): { readonly type_name: string | undefined } | undefined {
  // `x => x.go()`: a lone untyped parameter without parentheses.
  const lone = fn.child_by_field('parameter');
  if (lone !== undefined) {
    return lone.text === name ? { type_name: undefined } : undefined;
  }
  for (const parameter of fn.child_by_field('parameters')?.named_children ?? []) {
    const pattern = parameter.child_by_field('pattern') ?? parameter;
    if (pattern.type === 'identifier') {
      if (pattern.text === name) {
        return { type_name: plain_type(parameter.child_by_field('type')) };
      }
    } else if (pattern_binds(pattern, name)) {
      // Destructured: the parameter's type describes the whole object, not `name`.
      return { type_name: undefined };
    }
  }
  return undefined;
}

/** A `const`/`let`/`var` directly in `block` that declares `name`. */
function block_declaring(
  block: syntax_node,
  name: string,
): { readonly type_name: string | undefined } | undefined {
  for (const statement of block.named_children) {
    const declaration =
      statement.type === 'export_statement' ? statement.child_by_field('declaration') : statement;
    if (declaration === undefined || !DECLARATION_TYPES.has(declaration.type)) {
      continue;
    }
    for (const declarator of declaration.named_children) {
      if (declarator.type !== 'variable_declarator') {
        continue;
      }
      const pattern = declarator.child_by_field('name');
      if (pattern === undefined) {
        continue;
      }
      if (pattern.type === 'identifier' && pattern.text === name) {
        return { type_name: declarator_type(declarator) };
      }
      if (pattern.type !== 'identifier' && pattern_binds(pattern, name)) {
        return { type_name: undefined };
      }
    }
  }
  return undefined;
}

/** `const x: T = …` gives `T`; `const x = new T(…)` gives `T`; anything else, nothing. */
function declarator_type(declarator: syntax_node): string | undefined {
  const annotated = plain_type(declarator.child_by_field('type'));
  if (annotated !== undefined) {
    return annotated;
  }
  const value = declarator.child_by_field('value');
  if (value?.type === 'new_expression') {
    const constructor = value.child_by_field('constructor');
    if (constructor?.type === 'identifier') {
      return constructor.text;
    }
  }
  return undefined;
}

/**
 * The type name in a `type_annotation`, when it is a plain named type: `T`, or
 * the base of a generic `T<U>`. Unions, arrays, qualified names (`ns.T`) and
 * everything else are not plain, so they give nothing.
 */
function plain_type(annotation: syntax_node | undefined): string | undefined {
  const type = annotation?.named_children[0];
  if (type === undefined) {
    return undefined;
  }
  if (type.type === 'type_identifier') {
    return type.text;
  }
  if (type.type === 'generic_type') {
    const base = type.child_by_field('name') ?? type.named_children[0];
    return base?.type === 'type_identifier' ? base.text : undefined;
  }
  return undefined;
}

/** True when a destructuring pattern binds `name` anywhere inside it. */
function pattern_binds(pattern: syntax_node, name: string): boolean {
  for (const node of pattern.walk()) {
    if (
      (node.type === 'identifier' || node.type === 'shorthand_property_identifier_pattern') &&
      node.text === name
    ) {
      return true;
    }
  }
  return false;
}

/**
 * For `for` / `for…in/of` / `catch`: does the declaring part declare `name`?
 * Only that part is checked — `for (const x of service.items)` declares `x`,
 * and its mention of `service` is a use, not a declaration.
 */
function declares_name_outside_body(node: syntax_node, name: string): boolean {
  const field =
    node.type === 'catch_clause' ? 'parameter' : node.type === 'for_statement' ? 'initializer' : 'left';
  const declaring = node.child_by_field(field);
  if (declaring === undefined) {
    return false;
  }
  if (DECLARATION_TYPES.has(declaring.type)) {
    // Only the declared names, not their initial values.
    return declaring.named_children.some((declarator) => {
      const pattern = declarator.child_by_field('name');
      return pattern !== undefined && pattern_binds(pattern, name);
    });
  }
  if (node.type === 'for_statement') {
    // `for (i = 0; …)` assigns an outer variable; it declares nothing.
    return false;
  }
  return pattern_binds(declaring, name);
}
