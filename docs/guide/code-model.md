# Code Model & Extraction

Between the grammar and the index sits a small, language-independent model. It is **not** a unified AST:
it does not try to represent every construct in every language, only the facts an agent asks for.

| Type             | What it records                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| `code_file`      | path, language, size, content hash, package (for monorepos)                      |
| `code_symbol`    | name, kind, location, parent, signature, export kind                             |
| `relationship`   | `contains`, `imports`, `exports`, `calls`, `references`, `extends`, `implements` |
| `code_import`    | specifier, imported/local name, resolved path, internal vs package               |
| `code_export`    | exported name, local name, re-export source                                      |
| `code_reference` | every occurrence of a name, with its enclosing symbol                            |

Symbol kinds: `function`, `class`, `method`, `interface`, `type`, `variable`, `constant`, `enum`, `module`.

Two rules shape everything here:

**Never invent a relationship.** When a call target cannot be resolved, the edge is stored with the name
that was actually written and _no_ target id, rather than pointed at a plausible-looking symbol. Edges
carry a confidence of `certain` (derived from syntax alone) or `resolved` (followed across an import).
There is deliberately no "guessed" level. An agent acting on a fabricated `calls` edge edits the wrong
function, so a missing edge is much cheaper than a wrong one.

**Symbol ids exclude line numbers.** An id is `<file>#<kind>:<container.path>`, for example
`src/user.ts#method:user_service.create_user`. Editing one function therefore does not change the id of
every symbol below it, which is what lets incremental indexing diff a file instead of rewriting it.

## Symbol extraction

Every declaration becomes a symbol with its kind, 1-based location, containment parent, export kind,
ambient flag, and a one-line signature with the body stripped
(`async create_user(u: user): Promise<void>`). Containment produces `contains` edges, the one
relationship kind that is certain from syntax alone.

Three judgement calls are worth stating, because they shape what you get back:

**`const f = () => {}` is recorded as a function, not a constant.** It is the dominant declaration style
in React and modern TypeScript, and someone searching for a function has to find it.

**Function-local data variables are not indexed.** Names like `stack`, `index` or `base` are meaningless
to search for and would bury real results — on this repository, excluding them took the constant count
from 312 to 37. Functions and classes declared inside a function _are_ kept, since a named callable is
worth looking up however it is scoped.

**Nothing is named by guesswork.** A destructuring binding (`const { a, b } = obj`) binds several names
at once, so no symbol is recorded rather than one invented name; the bindings stay visible as references.
Class and interface _properties_ are not symbols either, because the model has no kind for them and
inventing one would be a deviation. `export default function () {}` is recorded under the name `default`,
which is how consumers actually address it.
