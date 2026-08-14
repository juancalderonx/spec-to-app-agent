# Generalization: the agent against a second specification

The brief names memorization as a red flag and says the specification may be
changed to test for it. This is that test, run once and written down as it came
out.

`specs/variant.md` changes both the domain and the requirements: a vinyl record
collection instead of a car inventory, a decade filter and a detail view that
the primary specification does not ask for, and no create form, which the
primary specification does. An agent carrying a fixed catalogue fails here
visibly rather than subtly.

## The run

| | |
| --- | --- |
| Specification | `specs/variant.md` |
| Agent build | `ab51d97` — the tree at T-15B, unmodified |
| Command | `npm start -- --spec specs/variant.md --output /tmp/variant-app` |
| Run id | `2026-08-14T22-04-19-235Z` |
| Artifacts | `agent/runs/2026-08-14T22-04-19-235Z/` |
| Provider | Anthropic — `claude-opus-5` planning and coding, `claude-sonnet-5` reviewing |
| Result | 18 tasks · 18 done · 0 failed · 0 unresolved · 21 calls · **$1.9440** · exit 0 |

Nothing in the agent was changed for this run. The only differences from the
primary run are the two arguments above. A prompt or a pack edited to make the
variant pass would have invalidated the question the run exists to ask, so the
build is the one already committed, and what follows is what it produced.

The generated application is **not committed**. The repository ships one sample
application, the one from the primary specification; this one lives at
`/tmp/variant-app` and is reproducible from the command above. What is committed
is the run: plan, tool trace, error log, token ledger and summary.

### Compared with the primary run

| | primary (`2026-08-14T20-57-19-479Z`) | variant (`2026-08-14T22-04-19-235Z`) |
| --- | --- | --- |
| Tasks | 17 | 18 |
| Done / failed | 15 / 2 | 18 / 0 |
| Repair cycles | 2 tasks × 2 attempts | 1 task × 1 attempt |
| Review rounds | 2 | 1 |
| Calls | 25 | 21 |
| Cost | $4.2584 | $1.9440 |
| Exit | 1 | 0 |

The variant run is larger by one task and costs 54% less. Most of that gap is
not the specification: the primary run's two failures were defects in the agent,
fixed in T-15B, and each burnt two repair attempts on a task that had nothing
wrong with it. This run is what the same loop costs once it stops manufacturing
its own failures.

## What the planner produced

18 tasks, decomposed from the specification alone. The three checks the ticket
asks for, against `agent/runs/2026-08-14T22-04-19-235Z/plan.json`:

**The requirements unique to the variant each got a task.**

| Requirement | Task | File |
| --- | --- | --- |
| "Let assistants narrow by decade" | `decade-filter` | `src/components/DecadeFilter.tsx` |
| | `record-filters` | `src/records/filters.ts` (decade helper + decade list) |
| | `test-decade-filter` | `src/__tests__/decadeFilter.test.tsx` |
| "Show a single record in detail" | `record-detail-page` | `src/pages/RecordDetailPage.tsx` |
| | `record-browser` | `src/RecordBrowser.tsx` (owns the selection, swaps the screens) |
| | `use-records` | `src/hooks/useRecords.ts` (`useRecord(id)`, fetched on its own) |

**Nothing was planned for the primary specification's create form.** No task
targets a form, no task mentions creating a record, and the trace confirms it
from the other side: `tools.jsonl` records 18 `writeFile` targets, exactly the 18
planned files. The primary run's `add-car-form` task has no counterpart here.

**The plan follows the variant's structure, not the primary's.** The primary
specification produced a single `InventoryPage` holding everything; this one
produced two pages and a container between them, because this specification asks
for two screens and a way back. The one file both runs write with the same name
is `src/App.tsx`, which is the boilerplate's entry point.

## What came out green

Run inside `/tmp/variant-app`, after the agent finished:

```
$ npm run typecheck
> tsc --noEmit
$ echo $?
0

$ npm run test
 ✓ src/__tests__/collectionRenders.test.tsx (1 test) 87ms
 ✓ src/__tests__/decadeFilter.test.tsx (1 test) 163ms
 ✓ src/__tests__/artistFilter.test.tsx (1 test) 166ms
 ✓ src/__tests__/combinedFilters.test.tsx (1 test) 222ms
 ✓ src/__tests__/sorting.test.tsx (2 tests) 302ms

 Test Files  5 passed (5)
      Tests  6 passed (6)
```

All five test files were written by the agent, one per behaviour the
specification requires tested. The suite covers the collection rendering once
data arrives, the artist filter, the decade filter, the two combined, and
sorting by year and by title.

One repair cycle is in the log, and it is a real one:

```
[generate] wrote: test-artist-filter → src/__tests__/artistFilter.test.tsx · 2916 bytes · 1439 uncached input, 4771 cached read, 0 cache write · via claude-opus-5
[validate] typecheck: exit 0 · 0 errors
[validate] tests: exit 1 · 1 errors
[repair] rewrote: test-artist-filter → src/__tests__/artistFilter.test.tsx · attempt 1 · 1 errors sent · 3919 bytes · via claude-opus-5
[validate] typecheck: exit 0 · 0 errors
[validate] tests: exit 0 · 0 errors
```

Nothing failed. `errors.jsonl` is empty and the reviewer reported no gaps in a
single round.

## The leftover domain, which is not what was predicted

T-16 was written expecting the previous domain to survive unevenly: that
`src/graphql/queries.ts`, `src/mocks/handlers.ts` and `src/mocks/data.ts` are
each rewritten by some task, that nothing ties their contents together, and that
a run keeping an operation in one and dropping it from another would ship an
application issuing a request nothing answers.

That is not what happened, and the reason it did not is worth stating exactly:

**No task claimed those files.** All three are byte-identical to
`boilerplate/`, along with `src/types.ts`:

```
$ diff boilerplate/src/graphql/queries.ts /tmp/variant-app/src/graphql/queries.ts   # identical
$ diff boilerplate/src/mocks/handlers.ts  /tmp/variant-app/src/mocks/handlers.ts    # identical
$ diff boilerplate/src/mocks/data.ts      /tmp/variant-app/src/mocks/data.ts        # identical
$ diff boilerplate/src/types.ts           /tmp/variant-app/src/types.ts             # identical
```

They still hold `GetCars`, `GetCar` and `AddCar`, the `Car` type, and five seed
entities. The incoherence the ticket warned about cannot arise in this run,
because the two files that could have disagreed were never opened.

**Instead, the agent adapted at the hook boundary.** The planner's very first
task decided it, in its own description:

> `record-types` — Defines the VinylRecord domain type (id, title, artist, year,
> genre, mobile/tablet/desktop sleeve image URLs) and a mapper that converts the
> API's Car shape from src/types.ts into a VinylRecord (make→artist,
> model→title, color→genre).

`src/records/types.ts` holds the new domain type and `toVinylRecord`;
`src/hooks/useRecords.ts` runs the existing `GET_CARS` and `GET_CAR` operations
and returns `toVinylRecords(data.cars)`. Everything above the hook is written in
the variant's vocabulary and never sees the API's. The result is an application
about vinyl records running on the car API, with one translation in one file.

**This is the defensible reading of a specification whose premise is false.**
`specs/variant.md` states that "the collection data already exists behind the
project's GraphQL API, together with the operations needed to read it", and it
does not: the API serves cars. The same sentence tells the agent to "use what is
already there rather than inventing a second source of truth". Faced with a
contradiction between a false claim about the API and an instruction about what
to do with it, the agent honoured the instruction. Replacing the mock would have
been the other reading, and it is the one the specification's next clause argues
against.

It is also the reading that avoided the failure the ticket predicted. Rewriting
those three files piecemeal is exactly how an operation ends up in `queries.ts`
with no handler behind it.

**What this costs, stated plainly.** The application is structurally correct and
semantically absurd. It renders five records whose artists are Toyota, Honda,
Ford, Tesla and BMW, whose genres are Silver, Blue, White, Red and Black, and
whose sleeve artwork is a placeholder image captioned with a car model. Every year is between 2023 and
2025, so the decade filter — implemented, tested and working — offers exactly
one decade against the real seed data. The agent's own tests do not show this,
because each supplies its own fixtures: `decadeFilter.test.tsx` builds four
entities in `Car` shape with Nina Simone, Bill Withers, Stevie Wonder and Kate
Bush in them, spanning three decades, and asserts against those.

**A note on what the suite could have caught.** Had the coherence failure the
ticket predicted actually occurred, this run would not have detected it. The
generated tests mock above the network with Apollo's `MockedProvider`, a
deliberate decision from `763d366`; MSW starts in `test-setup.ts` with
`onUnhandledRequest: "error"` but never receives a request, so a `queries.ts`
operation missing from `handlers.ts` leaves the suite green. In the browser
`main.tsx` starts the worker with `onUnhandledRequest: "bypass"`, so the request
would leave for a server that is not there and surface as the application's
error state. Neither signal reaches the run's exit code. The risk the ticket
identified is real; the run's green verdict is not evidence against it.

Removing the leftovers deliberately is not this ticket's decision to make: it
would mean giving the planner authority to delete files it was not asked to
write, which is a larger change than a verification pass.

## What this proves, and what it does not

Two questions the ticket treats as one, and the run separates them.

**Structural generalization: proven.** A different domain with different
requirements produced a different decomposition, correct dependency edges, and
knowledge packs that carried across without a word of either domain in them. The
loop planned, ordered, generated, validated, repaired once and reviewed clean,
on a specification it had never seen, with no edit to the agent.

**Data-layer generalization: not proven, because this specification did not put
it to the test.** The interesting case is a specification whose entities the
mock API cannot express — one that needs a field with no counterpart in `Car`,
or an operation the mock does not serve. The variant does not create that case:
its record maps onto a car one field at a time, which is why a field-for-field
adapter was enough. What would have exercised it is either a specification that
states what the API actually serves and asks for the mock to be extended, or a
domain whose shape does not fit in eight fields. That is a limitation of this
experiment, not a finding about the agent.

## What the run says about cost

From `summary.md`, per task type:

| type | tasks | share of tasks | output tokens | share of output | output tokens per byte written |
| --- | --- | --- | --- | --- | --- |
| test | 5 | 27.8% | 41,191 | 59.4% | 2.25 |
| component | 8 | 44.4% | 13,836 | 19.9% | 0.89 |
| data-layer | 3 | 16.7% | 4,893 | 7.1% | 0.78 |
| hook | 1 | 5.6% | 1,879 | 2.7% | 0.95 |
| wiring | 1 | 5.6% | 739 | 1.1% | 1.27 |

Output tokens are 88.8% of this run's bill, so the output column is very nearly
the cost column. Five test tasks are 28% of the work and 59% of the spend, and
a test costs about two and a half times as many output tokens per byte it leaves
on disk as a component does — it reasons about behaviour it cannot see, and the
one repair of the run was a test as well.

Those five tasks share a dependency level: every one of them depends on
`collection-page` and on nothing else, and no task depends on any of them. They
run strictly one after another today because the queue advances one task at a
time. Executing a topological level concurrently would cut the wall clock of
this run by most of its longest stretch, and it is the majority of the spend
that would move. The agent generates sequentially for a reason — each task is
shown the surface the previous ones left, which is what keeps the coder honest
about signatures — so levelling is a design change, not a flag. It is the
measurement, not the change, that belongs to this ticket.

## No domain vocabulary in the prompts

Neither specification's nouns appear in the agent's prompts or knowledge packs.
The evidence is a test rather than a shell command, so it runs with the rest of
the suite and fails the build if a pack ever picks up a noun:

```
$ npm test
✔ the guard flags a specification's nouns, singular and plural
✔ the guard passes words that merely contain a forbidden noun
✔ no prompt or knowledge pack carries vocabulary from either specification
ℹ tests 122
ℹ pass 122
ℹ fail 0
```

`agent/src/__tests__/no-domain-vocabulary.test.ts` scans every `.md` and `.ts`
file under `agent/knowledge/` and `agent/src/prompts/` for nine terms — `car`,
`vehicle`, `make`, `model`, `dealership`, `vinyl`, `record`, `artist`, `sleeve`
— case-insensitively, singular and plural, bounded to whole words. It is the
union of the two greps `TICKETS.md` names as acceptance criteria.

> **Footnote on the literal grep.** T-16's acceptance criterion spells the check
> as `grep -riE "car|vehicle|dealership|vinyl|record|artist|sleeve"` over the
> same two directories, and asks for no output. That command cannot return
> nothing, because it has no word boundaries and `car` is a substring of
> ordinary English. It returns four lines today, all of them the verb *carry*:
> three comments in `agent/src/prompts/packs.ts` and `agent/src/prompts/coder.ts`
> about what a prompt *carries*, and one line of the coder's instruction
> containing *cannot*. There is no domain vocabulary in any of them. The prompts
> were left exactly as they are: editing English prose to satisfy a substring
> match would be a change made to pass a check, which is the thing this ticket
> forbids.

## Incidental: the T-15B fixes, exercised end to end

T-15B's note says this run is its validation, since its four fixes had never run
against a real specification. All four held.

- **The suite runs for a test file, not for a task type.** `app-wiring` writes
  `src/App.tsx`, a file the runner does not collect, and the log shows
  `tests-skipped: app-wiring touched no test file and others remain queued`
  rather than a `no-test-files` failure. No task in this run was failed for a
  file it does not own.
- **A repair does not assume the file is there.** No `ENOENT` appears in the
  run. The one repair read the file its task had just written.
- **A remediation settles the task it replaces.** No task failed, so no
  remediation was planned. Untested by this run.
- **A clean validation over nothing is not a task done.** Every one of the 18
  tasks wrote its file, so the guard was never the deciding vote. Untested by
  this run.

The exit code matched the state on disk: 18 green tasks, exit 0. The primary run
exited 1 with a complete application, which was the defect T-15B closed.
