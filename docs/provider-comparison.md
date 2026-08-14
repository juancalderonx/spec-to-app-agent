# Provider comparison: one specification, two providers

The brief asks which models were used and why, and for an approximate cost per
run. This is the measurement that answers both, and it is also the evidence that
the provider abstraction works: the same agent build, the same specification,
one flag changed.

It is a measurement pass, not a tuning pass. Nothing was adjusted between the
two runs, and nothing was adjusted after seeing the numbers. What follows is
what came out.

## The two runs

| | Anthropic | OpenAI |
| --- | --- | --- |
| Specification | `specs/car-inventory.md` | `specs/car-inventory.md` |
| Agent build | `d638b13` | `d638b13` |
| Command | `npm start -- --spec specs/car-inventory.md --output /tmp/provider-anthropic --provider anthropic` | `npm start -- --spec specs/car-inventory.md --output /tmp/provider-openai --provider openai` |
| Run id | `2026-08-14T22-54-34-766Z` | `2026-08-14T22-54-40-230Z` |
| Artifacts | `agent/runs/2026-08-14T22-54-34-766Z/` | `agent/runs/2026-08-14T22-54-40-230Z/` |

**`--output` is the second difference, and it is unavoidable.** Two runs cannot
generate into the same directory without one overwriting the other, so the
comparison holds everything else fixed instead: same specification file, same
commit, same `--cache` default of `on`, same per-role model defaults, no
environment overrides. The generated applications are not committed — the
repository ships one sample application, from the primary run in T-15 — but both
are reproducible from the commands above.

**Neither run is the one already committed in T-15.** That run predates
`ab51d97`, which fixed four defects in the error loop. Comparing a new OpenAI
run against it would have measured the provider plus those four fixes and
reported the sum as a property of the provider. Both runs here are fresh, from
the same tree.

## The table

Every figure below is read out of the two `usage.json` ledgers and the two
`summary.md` files, except the last three rows, which are the generated
applications answering for themselves.

| | Anthropic | OpenAI |
| --- | --- | --- |
| Planner / coder model | `claude-opus-5` | `gpt-5.6-sol` |
| Reviewer model | `claude-sonnet-5` | `gpt-5.6-terra` |
| Tasks planned | 16 | 10 |
| Tasks executed, remediation included | 17 | 11 |
| Done / failed | 15 / 2 | 10 / 1 |
| Repair cycles | 2 | 8 |
| Review rounds | 2 | 2 |
| Model calls | 24 | 22 |
| Input tokens, uncached | 40,553 | 85,662 |
| Cached reads | 97,340 | 0 |
| Cache writes | 4,867 | 0 |
| Output tokens | 132,841 | 38,601 |
| **Cost** | **$3.5727** | **$1.5701** |
| Exit code | 1 — `gaps left open: remediation-1-1, test-sort` | 0 |
| Application: `typecheck` / `build` | exit 0 / exit 0 | exit 0 / exit 0 |
| Application: `test` | exit 0 — 3 files, 6 tests | exit 0 — 4 files, 5 tests |
| Application: files written under `src/` | 15 — 14 new, `src/App.tsx` rewritten | 10 — 9 new, `src/App.tsx` rewritten |

Every test file counted above was written by the agent: `prepare` removes the
boilerplate's `Example.tsx` and `Example.test.tsx` before the run starts, so
nothing in either suite is inherited.

### Reconciling the figures against the ledgers

The token and cost columns are not transcribed by hand. This reads them back out
of the two runs:

```
$ node --input-type=module -e '
const { readFile } = await import("node:fs/promises");
for (const dir of process.argv.slice(1)) {
  const u = JSON.parse(await readFile(`${dir}/usage.json`, "utf8"));
  const t = u.totals;
  const models = [...new Set(u.entries.map((e) => `${e.role}:${e.model}`))].join(" ");
  const repairs = u.entries.filter((e) => e.node === "repair").length;
  console.log(`${dir}\n  models      ${models}\n  calls       ${u.entries.length}\n  input       ${t.inputTokens}\n  cachedRead  ${t.cachedReadTokens}\n  cacheWrite  ${t.cacheWriteTokens}\n  output      ${t.outputTokens}\n  cost        $${t.costUsd.toFixed(4)}\n  repairCalls ${repairs}`);
}
' agent/runs/2026-08-14T22-54-34-766Z agent/runs/2026-08-14T22-54-40-230Z

agent/runs/2026-08-14T22-54-34-766Z
  models      planner:claude-opus-5 coder:claude-opus-5 reviewer:claude-sonnet-5
  calls       24
  input       40553
  cachedRead  97340
  cacheWrite  4867
  output      132841
  cost        $3.5727
  repairCalls 2
agent/runs/2026-08-14T22-54-40-230Z
  models      planner:gpt-5.6-sol coder:gpt-5.6-sol reviewer:gpt-5.6-terra
  calls       22
  input       85662
  cachedRead  0
  cacheWrite  0
  output      38601
  cost        $1.5701
  repairCalls 8
```

Both totals match the headline line of the corresponding `summary.md`, and the
per-role and per-node breakdowns in those files add back up to them.

## What the table says

**On this run, OpenAI came out cheaper and more complete.** It cost 56% less,
finished every requirement, and exited 0. Anthropic exited 1 with one
requirement uncovered and cost $3.57 to do it.

**The cost gap is volume, not price.** `gpt-5.6-sol` is the more expensive model
per output token — $30 per million against $25 for `claude-opus-5`. It still
cost less than half as much, because it emitted 38,601 output tokens against
132,841. Output is 92.7% of the Anthropic bill and 73.5% of the OpenAI one, so
in both runs the output column very nearly *is* the cost column.

**Plan granularity is upstream of most of the rest.** The Anthropic planner cut
the specification into 16 tasks; the OpenAI planner into 10. Each task is a
model call carrying the same standing context, and each one that touches a test
file triggers a suite run. A finer plan buys smaller, more reviewable units of
work and pays for them one call at a time.

**Each provider failed in its own direction, and the table carries both.**
Anthropic needed 2 repair cycles across 17 tasks; OpenAI needed 8 across 11.
One got it right the first time more often and failed expensively when it
failed; the other made more mistakes and corrected them. Neither pattern is
strictly better: 8 repairs is 8 extra calls, and a task abandoned after its
repair budget is a hole in the deliverable.

**Where the Anthropic money went.** The two failed tasks — `test-sort` and its
remediation — account for 64,000 output tokens and $1.6683, which is 47% of that
run's bill, spent on a file that was never written. Everything else — the plan,
both review rounds, and the 15 tasks that produced the working application —
cost $1.90 between them.

## The Anthropic failure, with its cause

`test-sort` never produced a file. The coder's structured answer came back
without the `contents` field the schema requires, twice; the task was abandoned;
the reviewer caught the gap; the remediation planned to close it failed the same
way, twice more:

```
[generate] rejected: attempt 1: the answer carried no "contents" field.
[generate] rejected: attempt 2: the answer carried no "contents" field.
[generate] failed: test-sort: the answer was unusable after 2 attempts: the answer carried no "contents" field.
[validate] typecheck: exit 0 · 0 errors
[validate] tests: exit 0 · 0 errors
[validate] stays-failed: test-sort owns src/components/__tests__/Inventory.sort.test.tsx, which generate never wrote · both signals are clean about a file that is not there · the task stays failed
```

The ledger names the cause. Both attempts spent exactly 16,000 output tokens —
`MAX_OUTPUT_TOKENS` in `agent/src/llm/factory.ts` — for a task total of 32,000.
The response was cut at the ceiling before the schema's required field was
complete. The four attempts across the task and its remediation each hit the
same wall.

**The consequence is a real gap, not a cosmetic one.** The specification asks
for a test that sorting reorders the inventory and that sorting a filtered list
keeps the filter applied. That test does not exist in the Anthropic application.
Its suite is green over 6 tests because the file is absent, not because it
passes — which is exactly why the run exited 1 and the green row above has to be
read next to the exit row.

**This is the first real run in which the guard fires.** The `stays-failed` line
is the fourth fix from T-15B, and until now it had only ever run against a unit
test. Without it, `validate` would have seen a clean typecheck and a clean suite,
settled `test-sort` as `done`, and the run would have exited 0 — reporting a
sorting test that does not exist as a met requirement, with no signal anywhere
saying otherwise. The guard is what turned a silent hole into an exit code.

## The OpenAI failure, with its cause

`inventory-add-test` failed too. Its assertion could not find the vehicle it had
just submitted; two repairs did not fix it, and the file was rolled back:

```
[validate] abandoned: inventory-add-test after 2 repairs · 1 files restored · last error · TestingLibraryElementError: rejects an empty submission and adds valid vehicle details: Unable to find an element with the text: Supra.
```

The difference is what happened next. The reviewer flagged the gap, the
remediation task rewrote the file, one repair settled it, and the second review
round came back with no gaps. The run exited 0 with all four test files present.
The same loop ran in both runs; it closed the gap in one and not in the other.

## Caching: asymmetric, and what the zero means

The Anthropic run read 97,340 cached tokens. The OpenAI run read none. That
column is a property of this comparison, not a finding about either provider,
and it needs three statements to be read correctly.

**We only ask one provider to cache.** The manual cache breakpoint in
`agent/src/llm/factory.ts` is placed only when the provider is `anthropic` — it
is a feature of the native adapter, and every other provider reaches the
OpenAI-compatible one, which has no breakpoint to place. So the OpenAI run was
never asked to cache anything.

**The ledger is not blind to it, though.** `@langchain/openai` maps
`prompt_tokens_details.cached_tokens` onto `input_token_details.cache_read`, and
`agent/src/llm/ledger.ts` reads exactly that field — the same field, from the
same place, for both adapters. The comment there records an OpenAI cached read
already measured during T-04. So the zero is not an instrument that cannot see:
it is the provider reporting no cached input on any of the 22 calls of this run.

**What it would take to measure it properly.** OpenAI's cache is automatic and
server-side, and its hit rate depends on requests landing on the same cache,
which is what the `promptCacheKey` parameter exists to control — the installed
adapter exposes it, and the agent does not send it. A comparison that meant to
measure caching would set a stable key per role, run each provider twice, and
compare the second run of each against its own first. This comparison does none
of that: it ran each provider once, cold. Read the row as "one provider was
asked to cache and did; the other was not asked and reported none".

## Which models, and why

Both providers use the stronger model for planning and coding and a cheaper one
for review. The reviewer reads the finished surface and answers a
schema-enforced question about coverage; it writes no code, and its two calls
cost $0.0453 and $0.0108 respectively — under 1.5% of either bill. Spending
coder-grade money there would buy nothing the run can use. The defaults live in
`agent/src/llm/factory.ts` and any of them can be overridden per role with
`--model` or a `*_MODEL` variable, which is how the same graph reaches a
provider that ships no defaults at all.

## What this does not establish

One run per provider is one sample. These models are not deterministic, two runs
of the same specification on the same provider have already produced different
plans in this project, and nothing here separates the provider from the draw. A
claim about which provider is cheaper or more reliable in general needs repeated
runs and a spread, and this is not that.

The two runs also did not build the same application. Different plans produced
different file layouts, different component boundaries and different test
suites, so the cost figures compare two ways of satisfying one specification
rather than the same work done twice. Wall-clock time was not recorded.

What the runs do establish is narrower and was the point of the exercise: the
same agent build, unmodified, drives two providers through the same
specification to a working application, and the ledger prices both.
