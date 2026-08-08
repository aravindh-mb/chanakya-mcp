# Benchmarks

How much does this actually help an AI agent? The honest answer needs a fair test, so this page
describes exactly what was measured, on what, and where the result does **not** hold.

## The sample project

`bench/sample-project` is a small full-stack monorepo built for this benchmark — not this repository,
which is unusual code (a parser and an indexer) and would not be representative:

```
apps/api/        Express-shaped routes, services and repositories
apps/web/        React components and hooks
packages/shared/ types and validation used by both
```

16 files, 51 symbols. Indexing it takes **63 ms** and produces a **4 KB** database.

## What was compared

Both paths run in-process on the same machine, median of 11 runs:

- **With the MCP** — one `tools/call` round-trip through the same code path a client drives over stdio.
- **Without the MCP** — ripgrep (the binary editors bundle), **then reading the files it matched**.

That second half matters, and getting it wrong is the easiest way to produce a flattering number. A wall
of `path:line:text` does not tell an agent which match is the _declaration_, which is a _call_, and which
is a string in a comment. To find out, it opens the files — and those bytes land in its context just the
same. Measuring raw grep output alone understates the naive path by roughly 5×, so the comparison here
counts the follow-up reads.

Tokens are approximated as bytes ÷ 4, which is rough and labelled as rough.

<BenchChart />

## Reading the result

The pattern is consistent: **the more a question is about relationships, the more the index wins.**

- _"What breaks if I change the shared types?"_ — 8 files opened without the index, one 23-token answer
  with it. Cross-package impact is exactly what grep cannot answer.
- _"Who calls create_user?"_ — grep finds the string in both the definition and the call sites and cannot
  tell them apart. `get_callers` returns only callers.

And one row goes the other way, which is worth stating plainly rather than hiding:

- _"Structure of the user service"_ — `get_file_structure` returns **73% more** than simply reading the
  file. On a 1.2 KB file, structured JSON describing 11 symbols is larger than the source it describes.
  The tool earns its place on large files, not small ones.

## Where this does not hold

- **Small projects.** On 16 files, grep is already cheap. The savings grow with the number of files a
  question touches, because that is what the index removes.
- **First run.** Indexing costs 63 ms here, but a large repository costs seconds to minutes. The index is
  amortised across many questions; a single question is faster without it.
- **Questions grep is genuinely good at.** Finding a literal string that appears once has little room for
  improvement.
- **Latency is the less interesting axis.** The median 69× speedup is real but mostly reflects process
  startup: ripgrep pays ~20 ms to spawn, the index answers from an open handle. Context, not
  milliseconds, is the number that matters for an agent.

## Reproducing it

```bash
pnpm run bench:sample   # this page's numbers, on bench/sample-project
pnpm run bench          # the same questions against this repository
```

Both write JSON into `docs/.vitepress/`, which the chart above reads directly — so the published figures
move with the benchmark rather than being copied into prose and going stale.

## Full data

| Question                                  | With MCP  | Without   | grep only | Files opened | Saved     |
| ----------------------------------------- | --------- | --------- | --------- | ------------ | --------- |
| Where is `create_user` defined?           | 119       | 680       | 57        | 2            | 82.5%     |
| Everything that uses `format_money`       | 150       | 569       | 115       | 3            | 73.7%     |
| Who calls `user_service.create_user`?     | 23        | 680       | 57        | 2            | 96.7%     |
| What does the user service depend on?     | 167       | 298       | –         | 1            | 44.0%     |
| What breaks if I change the shared types? | 23        | 1,568     | 254       | 8            | 98.5%     |
| Structure of the user service             | 517       | 298       | –         | 1            | −73.5%    |
| Which components use the orders hook?     | 143       | 389       | 88        | 2            | 63.3%     |
| Full working context for `user_service`   | 582       | 1,006     | –         | 4            | 42.2%     |
| **Total**                                 | **1,723** | **5,487** |           |              | **68.6%** |

Token counts are approximate (bytes ÷ 4). "grep only" is the raw ripgrep output for the questions that
used it, shown to make the difference between the two baselines visible.
