# Search

Two entry points, both returning locations and signatures — never file contents.

## search_symbols

`search_symbols` matches symbol names. It runs exact, prefix and substring comparisons as separate
queries in that order, rather than one combined query: `name = ?` and `name LIKE 'q%'` can use the name
index while `LIKE '%q%'` cannot, so the cheap comparisons run first and an exact hit never pays for a
full scan. That ordering is also the ranking.

Filters: kind, language, path, exported-only, and exclude-ambient (to drop `.d.ts` noise).

## search_code

`search_code` searches file contents, reading from disk rather than storing source — the index would
double in size for data already on the filesystem, and go stale the moment a file changed. What the
index _does_ supply is the file list, already filtered by ignore rules, `.gitignore` and size limits, so
a search never wanders into `node_modules` or a minified bundle.

Every code match is annotated with **the symbol whose body encloses it**, innermost first. That is the
part a plain grep cannot give you, and it is often enough to decide without opening the file:

```
src/search/pattern.ts:104  in method find
   // Long lines are the amplifier for catastrophic backtracking, and are
```

## Regex safety

Regex search is supported, and the limits are worth stating precisely rather than waving at.

JavaScript's regex engine backtracks and has no timeout, so a pattern nesting one unbounded quantifier
inside another — `(a+)+`, `(\w*)*` — takes exponential time. This was **measured, not assumed**:
`(a+)+$` against a _30 character_ line takes 15 seconds, and every extra character roughly doubles it.

That measurement rules out the obvious mitigations. A line-length cap does not help, because the blowup
happens two orders of magnitude below any useful cap. Neither does a wall-clock budget checked between
lines or files, because the engine never yields during a single failing match.

So regex matching runs in a **worker thread**, and the time budget can **terminate** that thread. The
engine cannot be interrupted from the main thread, but terminating the thread is not an interruption —
it stops the whole worker, backtrace and all. A pathological pattern is therefore bounded: the search
stops at the budget and reports `timed_out` instead of hanging the server.

The nested-quantifier family is still **rejected before it runs**, because refusing costs less than a
worker and gives a better error than a timeout. That check is a heuristic and is documented as one: it
catches what gets written by accident, while the worker terminates everything it misses — an overlapping
alternation like `(a|a)+` backtracks just as badly, and it is bounded by the same budget.

Separately, all SQL is parameterised and `LIKE` wildcards in user queries are escaped, so searching for
`%` finds the literal character instead of returning the entire index.
