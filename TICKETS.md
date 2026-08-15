# Tickets

> **Git is executed by a human.** No implementation session runs `git` commands
> that change state — staging and committing are done by hand, outside the
> session. When a ticket is finished, hand over the exact command block and
> stop.

One ticket, one commit. After every ticket the repository is in a consistent
state: the agent's type check passes and nothing is half-wired.

Work them in order — the order already respects the dependency graph, which is
acyclic. Field labels are fixed so a session can be handed a single ticket
without further context.

**Read `docs/ARCHITECTURE.md` first.** It holds the node contracts, the shared
state, and the reasoning behind each decision. Tickets say what to build;
the architecture document says why it is shaped that way.

---

### T-01 — Apply `npm audit fix` to the vendored boilerplate

- **Why:** A clean install of the provided boilerplate reports six advisories
  (one low, four high, one critical), all development-only and all fixable
  without forcing. Fixing them in a commit of their own — after the untouched
  import — shows the audit happened and the result was decided, rather than
  absorbing it silently into the import. Addresses *How You Work Matters*.
- **Depends on:** none
- **Files:** `boilerplate/package-lock.json`, `boilerplate/package.json` (if the
  fix touches it)
- **Scope:** Run `npm install` then `npm audit fix` inside `boilerplate/`.
  Commit only the resulting lockfile change. Does **not** use `--force`, does
  **not** upgrade anything the audit did not flag, and does **not** touch any
  file under `boilerplate/src/`.
- **Acceptance criteria:**
  - [ ] `cd boilerplate && npm audit` reports 0 vulnerabilities
  - [ ] `cd boilerplate && npm run typecheck` exits 0
  - [ ] `cd boilerplate && npm run test` reports 2 passing tests
  - [ ] `git diff --name-only` for this commit lists only lockfile and/or
        `package.json` — no source files
- **Commit:** `chore(boilerplate): apply npm audit fix for 6 dev-only advisories`

---

### T-02 — Declare vitest globals in the boilerplate TypeScript config

- **Why:** The provided vitest config enables globals but the TypeScript config
  does not declare the matching types, so a test file relying on them passes
  the test suite and fails the type check. Two validation signals that disagree
  by construction would make the agent's repair loop chase a defect it did not
  cause. The brief explicitly permits config changes. Addresses Output Quality.
- **Depends on:** T-01
- **Files:** `boilerplate/tsconfig.json`
- **Scope:** Add the vitest globals type declaration to `compilerOptions`. One
  line. Does **not** change any other compiler option — the strictness settings
  are deliberate constraints the agent must generate against, not obstacles to
  remove.
- **Acceptance criteria:**
  - [ ] A scratch test file using `describe`/`it`/`expect` without importing
        them passes both `npm run typecheck` and `npm run test`; the scratch
        file is deleted before committing
  - [ ] `cd boilerplate && npm run typecheck` exits 0
  - [ ] `git diff` for this commit shows exactly one added line
- **Commit:** `fix(boilerplate): declare vitest globals in tsconfig`

---

### T-03 — Scaffold the CLI and prove the state graph boots on this runtime

- **Why:** The orchestration library and the installed Node release are the one
  pairing in this design that cannot be verified by reading. Discovering an
  incompatibility late would cost the whole exercise, so the first ticket that
  installs the library also proves a graph compiles and runs on it. Addresses
  Agent Architecture and Code Quality.
- **Depends on:** none
- **Files:** `package.json`, `tsconfig.json`, `agent/src/cli.ts`,
  `agent/src/graph/state.ts`, `agent/src/graph/index.ts`, `agent/.gitkeep`
  (removed)
- **Scope:** Root `package.json` with every dependency pinned to an exact
  version — no ranges. CLI parses `--spec`, `--output`, `--provider`,
  `--model`, `--cache` and prints usage on `--help`. Defines the typed shared
  state from `docs/ARCHITECTURE.md` §3 and compiles a two-node placeholder
  graph. Adds a script that renders the compiled graph to Mermaid. Does **not**
  implement any real node and does **not** call a model.
- **Acceptance criteria:**
  - [ ] `npm install` completes without a native build step
  - [ ] `npm start -- --help` exits 0 and lists all five flags
  - [ ] `npm start -- --spec ./specs/car-inventory.md --output ./tmp-smoke`
        runs the placeholder graph to completion and exits 0
  - [ ] `npm run graph:mermaid` prints a Mermaid graph containing both
        placeholder node names
  - [ ] `npm run typecheck` exits 0
  - [ ] `grep -E '"\^|"~' package.json` returns nothing for the agent's own
        dependencies
- **Commit:** `feat(agent): scaffold CLI and LangGraph state graph`

---

### T-04 — Add the provider factory with a token and cost ledger

- **Why:** This is the first ticket that calls a model, so it is the ticket that
  instruments spend. Cost per run is a submission requirement and the same
  ledger is the evidence for context management; adding it later would mean
  every earlier run is unmeasured. Addresses Documentation and Code Quality.
- **Depends on:** T-03
- **Files:** `agent/src/llm/factory.ts`, `agent/src/llm/pricing.ts`,
  `agent/src/llm/ledger.ts`, `.env.example`
- **Scope:** One interface, two adapters — a native one and an
  OpenAI-compatible one whose base URL selects among the remaining providers.
  Resolves the credential for the selected provider only, and fails before any
  network call with a message naming the exact variable to define. Translates a
  model-access rejection into a message naming the model tried, the provider,
  and the flag that changes it. Records every call into the ledger: node, role,
  model, input, cached-read, cache-write and output tokens, and cost. Sends
  **no** sampling parameters. Does **not** implement any graph node.
- **Acceptance criteria:**
  - [ ] With the selected provider's key unset, the CLI exits non-zero and the
        message contains that provider's exact variable name
  - [ ] A minimal call against each of the two providers returns a response and
        appends one ledger entry with non-zero input and output tokens
  - [ ] The computed cost for a known token count matches the pricing table by
        hand calculation
  - [ ] `grep -rn "temperature\|top_p\|top_k" agent/src/` returns nothing
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): add provider factory with token and cost ledger`

---

### T-05 — Add sandboxed file and command tools

- **Why:** Tool Use is one of the five architecture concepts the brief lists,
  and the evidence for it is discrete, auditable actions with enforced limits —
  not a model with shell access. The path sandbox and command allowlist are
  guarantees this code owns. Addresses Tool Use and Code Quality.
- **Depends on:** T-03
- **Files:** `agent/src/tools/fs.ts`, `agent/src/tools/shell.ts`,
  `agent/src/tools/trace.ts`, `agent/src/tools/__tests__/sandbox.test.ts`
- **Scope:** Discrete functions for read, write, list and run-command. Every
  path resolves to absolute and is rejected unless it falls inside the output
  directory. Commands come from a fixed allowlist; the model never supplies a
  command string. Every invocation appends a line to the trace with tool,
  arguments, outcome and duration. Does **not** wire any of it into the graph.
- **Acceptance criteria:**
  - [ ] Unit tests reject `../../etc/passwd`, an absolute path outside the
        output directory, and a symlink escaping it
  - [ ] A unit test rejects a command outside the allowlist
  - [ ] Tests run and pass with no API key present
  - [ ] After a scripted sequence of calls, the trace file has exactly one line
        per invocation and each parses as JSON
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): add sandboxed file and command tools`

---

### T-06 — Prepare the workspace and read the boilerplate surface

- **Why:** This is what makes the agent read the provided project at runtime
  instead of assuming its shape from a prompt — the difference between reusing
  an operation the project already exposes and writing a duplicate that does
  not match the mocks. Addresses Output Quality and Context Management.
- **Depends on:** T-03, T-05
- **Files:** `agent/src/nodes/prepare.ts`, `agent/src/surface/manifest.ts`,
  `agent/src/surface/__tests__/manifest.test.ts`
- **Scope:** Copies `boilerplate/` to the output directory excluding
  `node_modules/` and `.DS_Store`, removes the two reference files, runs
  `npm install`, then parses `src/**` into a manifest of exports and
  signatures. Wires the node as the graph's entry point. Does **not** extract
  file bodies into the manifest, and does **not** generate anything.
- **Acceptance criteria:**
  - [ ] After a run, the output directory passes `npm run typecheck` and
        `npm run test`
  - [ ] Neither reference file exists in the output directory
  - [ ] The manifest lists the project's existing query and mutation operations
        with their names
  - [ ] A unit test asserts the manifest contains no file body — every value is
        a name or a signature
  - [ ] A setup failure routes to the report path and exits non-zero with a
        diagnosable message, instead of throwing
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): prepare workspace and read boilerplate surface`

---

### T-07 — Plan tasks from the spec with schema-enforced output

- **Why:** Task Decomposition is one of the five concepts, and the artifact that
  demonstrates it is a validated plan with explicit dependency edges that the
  evaluator can open and read without running anything. Schema enforcement is
  also the Prompt Engineering evidence. Addresses Task Decomposition and
  Prompt Engineering.
- **Depends on:** T-04, T-06
- **Files:** `agent/src/nodes/plan.ts`, `agent/src/schema/plan.ts`,
  `agent/src/prompts/planner.ts`
- **Scope:** Sends the specification plus the surface manifest's signatures and
  receives a task list validated against a schema: id, description, target
  path, task type, dependency ids, acceptance criteria. Task type comes from a
  fixed domain-neutral vocabulary. Retries once with the validation error
  appended, then fails terminally. Writes the plan as a run artifact. Does
  **not** ask the model for an execution order, and does **not** send file
  bodies.
- **Acceptance criteria:**
  - [ ] A run against the primary spec produces a plan that validates against
        the schema
  - [ ] Every `dependsOn` entry references an id present in the same plan
  - [ ] Every task's type is a member of the fixed vocabulary
  - [ ] The plan is written to `agent/runs/<runId>/plan.json` and is readable
        without running the agent
  - [ ] `grep -riE "car|vehicle|make|model" agent/src/prompts/` returns nothing
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): plan tasks from spec with schema-enforced output`

---

### T-08 — Order tasks by topological sort with cycle detection

- **Why:** This is the sharpest available evidence that ordering is a guarantee
  this code provides rather than a judgement delegated to the model — and it is
  provable by a unit test that needs no API key. Kept as its own node so it
  appears in the rendered diagram. Addresses Task Decomposition.
- **Depends on:** T-07
- **Files:** `agent/src/nodes/order.ts`, `agent/src/graph/routers.ts`,
  `agent/src/nodes/__tests__/order.test.ts`
- **Scope:** Kahn's algorithm over the dependency edges, ties broken by task id
  for reproducibility. Detects cycles and references to unknown ids, recording
  them rather than throwing. Adds `routeAfterOrder`. Does **not** execute any
  task.
- **Acceptance criteria:**
  - [ ] A unit test asserts that a known plan always yields the same order
        across repeated calls
  - [ ] A unit test with a cyclic plan returns a detected cycle and does not
        throw
  - [ ] A unit test with a dependency on an unknown id is reported
  - [ ] A cyclic plan routes the run to the report path and exits non-zero
  - [ ] Tests pass with no API key present
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): order tasks by topological sort with cycle detection`

---

### T-09 — Add the knowledge-pack library and its loader

- **Why:** Prompt Design is one of the five concepts. Packs make context
  management measurable rather than asserted, and give repeated repair failures
  a durable home — the fix goes in the pack, benefiting every future task of
  that type. The always-injected pack is also the stable prefix the cache
  depends on. Addresses Prompt Design and Context Management.
- **Depends on:** T-03
- **Files:** `agent/knowledge/*.md`, `agent/src/prompts/packs.ts`,
  `agent/src/prompts/__tests__/no-domain-vocabulary.test.ts`
- **Scope:** A short markdown pack per task type, plus one always-injected pack
  carrying the constraints of the provided project. The loader resolves a task
  type to its packs and falls back to the always-injected pack alone for an
  unknown type, recording the fallback. Packs contain rules and shapes; any
  example is in a domain unrelated to either specification. Does **not** contain
  a finished component, hook or test the model could copy, and does **not**
  contain vocabulary from either specification's domain.
- **Acceptance criteria:**
  - [ ] An automated test greps `agent/knowledge/` and `agent/src/prompts/` for
        the domain nouns of both specs and fails the build on any hit
  - [ ] The loader returns the always-injected pack alone for an unrecognised
        task type, and records the fallback
  - [ ] Manual review confirms no pack contains a complete, copyable artifact
  - [ ] Tests pass with no API key present
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): add knowledge packs for task-scoped context`

---

### T-10 — Generate code per task from dependency signatures only

- **Why:** This node produces the application, which carries the same weight as
  the loop itself. Restricting its context to the direct dependencies'
  signatures is what keeps per-task prompt size flat, and the ledger makes that
  checkable. Addresses Output Quality and Context Management.
- **Depends on:** T-05, T-07, T-08, T-09
- **Files:** `agent/src/nodes/generate.ts`, `agent/src/prompts/coder.ts`,
  `agent/src/graph/index.ts`
- **Scope:** Assembles the prompt as stable prefix then variable part, writes
  files through the sandboxed tool, snapshots every file before touching it,
  and updates the surface manifest from what it wrote. One task per visit. Does
  **not** receive the whole manifest — only the signatures of the current
  task's direct dependencies — and does **not** run validation.
- **Note:** T-09's follow-up fix widened what `dependsOn` carries. Besides the
  tasks whose exports a task imports, it now also carries the handler task for
  any operation the task issues at runtime — an ordering edge with no import
  behind it. This node injects the signatures of the direct dependencies only,
  so it has to decide which reading it uses: inject the handler file's signature
  alongside the rest, or filter out the edges that exist only for ordering.
  Decide it deliberately and say which in the commit. Deciding nothing means the
  hook's prompt carries `src/mocks/handlers.ts`, whose whole surface is one
  exported array — cheap, but arrived at by accident.
- **Acceptance criteria:**
  - [ ] A run over a reduced single-task spec writes the expected file and the
        output directory still passes `npm run typecheck`
  - [ ] The ledger shows input tokens for the last task within a stated
        tolerance of the first, with the figures recorded in the run summary
  - [ ] Every write appears in the tool trace with its resolved absolute path
  - [ ] A task whose target path falls outside the output directory is rejected
        by the sandbox and recorded, without writing
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): generate code per task from dependency signatures`

---

### T-11 — Cache the stable prompt prefix across tasks

- **Why:** The rules pack, knowledge packs and few-shot example are re-sent
  byte-identical on every task of a run — the exact case prompt caching exists
  for. This is the larger half of the cost story and the clearest bonus feature
  available. Addresses Documentation and *Creativity*.
- **Depends on:** T-10
- **Files:** `agent/src/llm/factory.ts`, `agent/src/prompts/coder.ts`,
  `agent/src/llm/ledger.ts`
- **Scope:** Places the cache breakpoint by hand on the last block of the
  stable prefix, ahead of the task-specific content. Surfaces cached-read and
  cache-write tokens in the ledger, priced separately from ordinary input.
  Does **not** use the adapter's automatic top-level cache setting, which would
  place the breakpoint on the variable task block and never produce a read.
- **Acceptance criteria:**
  - [ ] On a run with at least two tasks, the second task's ledger entry shows
        cached-read tokens greater than zero
  - [ ] The measured stable prefix exceeds the cacheable minimum for the coder
        model in use; if it does not, the run summary states so rather than the
        prefix being padded to clear the threshold
  - [ ] The run summary reports cached-read, cache-write and uncached input
        tokens as separate figures
  - [ ] Editing one character of the rules pack causes the next run's first
        task to record a cache write rather than a read
  - [ ] `npm run typecheck` exits 0
- **Commit:** `perf(agent): cache the stable prompt prefix across tasks`

---

### T-12 — Parse typecheck and test output into structured errors

- **Why:** Error Recovery is one of the five concepts, and the brief is explicit
  that the agent must read the error output and feed it back. Feeding back a
  raw dump is not reading it. Parsing to structured errors is also testable
  against captured output with no API key. Addresses Error Recovery and
  Code Quality.
- **Depends on:** T-05, T-06
- **Files:** `agent/src/nodes/validate.ts`, `agent/src/validate/parsers.ts`,
  `agent/src/validate/__tests__/parsers.test.ts`,
  `agent/src/validate/__tests__/fixtures/*.txt`
- **Scope:** Runs the type checker every visit and the test suite when the task
  touched a test file or is the last in the queue. Parses both outputs into
  `{ file, line, code, message, source }`. A command that fails to start is
  recorded as a synthetic error rather than swallowed. Does **not** attempt any
  repair.
- **Acceptance criteria:**
  - [ ] Unit tests parse captured type-checker output into the expected
        structured errors, using a real failure as a fixture
  - [ ] Unit tests parse captured test-runner output the same way
  - [ ] A deliberately broken generated file produces a non-empty structured
        error list naming the correct file and line
  - [ ] An unavailable command yields a synthetic runner error rather than an
        empty result
  - [ ] Parser tests pass with no API key present
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): parse typecheck and test output into structured errors`

---

### T-13 — Repair failures with bounded retries and rollback

- **Why:** Closes the loop the brief requires, and adds the part most
  submissions omit: what happens when repair does not converge. Rolling a
  failed task back keeps one bad task from cascading into every task after it,
  so a run ends with a mostly-working application rather than an unhandled
  exception. Addresses Error Recovery and *Error Handling*.
- **Depends on:** T-10, T-12
- **Files:** `agent/src/nodes/repair.ts`, `agent/src/graph/routers.ts`,
  `agent/src/nodes/__tests__/routers.test.ts`
- **Scope:** Sends the structured errors plus the failing file's body, scoped to
  one file. Adds `routeAfterValidate` deciding between the repair loop, the
  queue advance and the degradation path. On exhausting the per-task ceiling:
  restores the snapshot, marks the task failed, advances. Enforces a
  whole-run repair ceiling. Does **not** abort the run on a failed task.
- **Correction (found while implementing):** this ticket and
  `docs/ARCHITECTURE.md` both said the edge would carry the queue advance and
  the rollback. **A conditional edge in LangGraph is a pure function from state
  to a node name** — it cannot write state or touch the disk. So the edge
  decides and nodes act: the cursor advance stays in `generate`, and rolling
  back and settling `status` go to `validate`, the only node on every path out
  of a validation. The ceiling stays in one place as a predicate both consult.
  Both documents were corrected in this ticket's commit.
- **Acceptance criteria:**
  - [ ] Unit tests cover all four `routeAfterValidate` branches with no API key
  - [ ] A run with an induced failure shows at least one fail → repair → green
        cycle in the committed log
  - [ ] After a task exhausts its retries, the output directory still passes
        `npm run typecheck` — the snapshot was restored
  - [ ] The run completes with the remaining tasks attempted and exits 1, and
        the summary names the failed task and its last error
  - [ ] The whole-run repair ceiling terminates a pathological run
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): repair failures with bounded retries and rollback`

---

### T-13B — Make a repair that produced nothing diagnosable and free

- **Why:** In the first full run, **five of nine** repair calls came back with
  `the answer carried no "contents" field`. The event is recorded; the answer is
  not, so nothing about the cause is knowable — a truncation, a refusal, prose
  and a differently shaped tool call all look identical from the log. Worse, a
  malformed answer charges a repair attempt, so `test-add-car` was abandoned
  "after 2 repairs" without a single correction ever having been sent. Both
  defects sit directly on Error Recovery, the concept T-13 exists to
  demonstrate, and both inflate the failed-task count that T-15 commits as its
  artifact.
- **Depends on:** T-13
- **Files:** `agent/src/nodes/repair.ts`, `agent/src/schema/file.ts`,
  `agent/knowledge/test.md`, `agent/src/nodes/__tests__/repair.test.ts`,
  `agent/src/validate/parsers.ts`
- **Scope:**
  - An unusable answer is logged with a **bounded digest of what actually
    arrived** — enough to tell a truncation from a refusal from a wrong shape.
    A digest, not the answer: the log is committed.
  - A malformed answer no longer costs the task a repair. It retries the schema
    once inside the same visit, the way `generate` already does. The attempt is
    charged when the model answered *in shape* and the correction was wrong —
    that is the failure the ceiling exists to bound. A schema retry that also
    fails ends the visit without a rewrite and **is** charged, so a provider
    that never complies cannot loop.
  - The test pack carries the usage pattern for `MockedProvider`, which the
    agent cannot discover: `prepare` deletes `src/__tests__/Example.test.tsx`,
    the project's only correct example. The run died on `TS2344: Type 'typeof
    MockedProvider' does not satisfy the constraint '(...args: any) => any'` —
    it is a class component, so props must not be derived from it. State the
    pattern; do not name the sample domain.
  - Establish whether the assertion text reaching `repair` is truncated by the
    runner or by our own parsing. `expected 'Car InventoryMakeMakeModelModel…'
    to contain 'Camry'` is not enough evidence to repair from, and the repair
    model receives exactly what the log shows. **Both, as it turns out:** the
    runner caps the quoted value, and `parseTests` keeps the failure's first
    line and discards the rest of the block — the difference block that carries
    the value whole, and the code frame that names the failing assertion and the
    line it sits on. `parseTests` must carry both under the headline, bounded so
    a DOM dump cannot spend a prompt, and cut by structure rather than by
    characters — the same rule T-12 applies to a `tsc` diagnosis.
- **Acceptance criteria:**
  - [ ] A unit test shows an unusable answer produces a log entry carrying a
        digest of the response, with no API key present
  - [ ] A unit test shows a malformed answer followed by a well-formed one
        rewrites the file and charges **one** attempt
  - [ ] A unit test shows two malformed answers charge one attempt and rewrite
        nothing
  - [ ] Mutation: removing the schema retry fails the test above and nothing else
  - [ ] The domain-vocabulary guard still passes over the edited pack
  - [ ] A new fixture captures a `toContain` failure over a string long enough to
        be truncated, and a test shows the code frame and the untruncated
        received value both reach the message
  - [ ] Mutation: returning `parseTests` to the failure's first line alone fails
        the test above
  - [ ] The truncation question is answered in the commit body: which part is the
        runner's own, cited, and which part was ours
  - [ ] `npm run typecheck` exits 0
- **Commit:** `fix(agent): keep a malformed repair answer diagnosable and free`

---

### T-14 — Review the output and write the run report

- **Why:** The brief asks for self-validation by a secondary model call, and the
  submission requires an approximate cost per run. This ticket closes the graph
  and produces every artifact the evaluator reads without running anything.
  Addresses Agent Architecture and Documentation.
- **Depends on:** T-13
- **Files:** `agent/src/nodes/review.ts`, `agent/src/nodes/report.ts`,
  `agent/src/prompts/reviewer.ts`, `agent/src/graph/routers.ts`
- **Scope:** The review node compares the specification against the surface
  manifest and emits structured gaps, using a different model from the coder by
  default. `routeAfterReview` reinjects remediation tasks once, then reports.
  The report node writes plan, tool trace, error log, usage ledger and summary,
  and writes the run's verdict into the summary. Does **not** let a failed
  review sink an otherwise green run, does **not** set the process exit code —
  see the note — and the reviewer does **not** read file bodies.
- **Note:** Three things this ticket got wrong or left open, decided while
  implementing it.
  - **The exit code stays in the CLI.** This ticket asked `report` to set it. A
    node that writes `process.exitCode` decides the exit status of whatever
    process runs the graph, and the test suite runs the graph: a green suite
    could exit non-zero with nothing failing. `runVerdict` is already the single
    home of the rule; `report` writes that verdict into `summary.md` and the CLI
    is the one caller that turns it into a process's status.
  - **A gap carries a target and a type, and a remediation task depends on every
    task that finished.** A gap that only names what is missing cannot become a
    task, so `Gap` gains `targetPath` and `taskType`. And `generate` injects the
    signatures of a task's direct dependencies only, so a remediation task with
    no edges would see the boilerplate's surface and nothing this run built —
    the defect commit `596b5d6` fixed, reached through a new door. The reviewer
    cannot supply those edges: the gap it is closing is by definition the part
    nobody planned. The cost is a wider prompt for at most five tasks at the very
    end of a run, signatures only.
  - **`summary.md` has three task statuses, not two.** Since T-13 a task whose
    validation was red about files it does not own stays `pending` — attempted,
    never judged clean, never rolled back. It is reported as `unresolved`;
    folding it into done or failed hides the one task a reader most needs.
- **Acceptance criteria:**
  - [ ] A completed run writes all five artifacts under `agent/runs/<runId>/`
  - [ ] `summary.md` states total tokens, total cost in USD, per-task input
        tokens in execution order, and each task's final status
  - [ ] A forced review failure still produces a report and preserves the run's
        exit code
  - [ ] Exit code is 0 when every task is done and 1 when any task failed
  - [ ] The reviewer's prompt contains no file bodies
  - [ ] `npm run typecheck` exits 0
- **Commit:** `feat(agent): review output and write run report with cost`

---

### T-14B — Make `--cache` control the cache the agent actually has

- **Why:** `--cache` is advertised in `--help` as a response cache, parsed
  (`cli.ts:70`), printed in the run header (`cli.ts:83`), and then consumed by
  nobody. No response cache exists in `factory.ts` or in any node. An advertised
  flag that does nothing is the first thing an audit finds, and T-15 carries an
  acceptance criterion — replaying with `--cache read-only` reproduces the run
  without a key — that depends on the feature that is missing. The brief states
  the evaluator supplies their own keys, so a keyless replay is not owed to
  anyone; what *is* owed is that the flag tells the truth. The prompt cache the
  agent really has is unconditional today, so the flag has something honest to
  control, and switching it off is how the 49% input reduction T-11 measured can
  be reproduced by a reader instead of taken on trust.
- **Depends on:** T-14
- **Files:** `agent/src/cli.ts`, `agent/src/llm/factory.ts`,
  `agent/src/graph/index.ts`, `agent/src/llm/__tests__/factory.test.ts`,
  `TICKETS.md`, `docs/ARCHITECTURE.md`
- **Scope:** The flag selects whether `cacheable()` sets a cache breakpoint or
  returns the text as an ordinary block, and the choice reaches every role
  through `RunOptions`. **The modes must name what is implementable:**
  `read-only` has no meaning for a provider-side prompt cache — a breakpoint is
  written and read or it is not there at all — so do not keep a mode that cannot
  be honoured. `--help` says prompt cache, not response cache. Rewrite T-15's
  last acceptance criterion to match what exists. Does **not** build a response
  cache, and does **not** change the default, which stays on.
- **Note:** `docs/ARCHITECTURE.md` is in this ticket's files because this ticket
  is what falsifies it. Section 5 carried a decision row for a disk response
  cache that was never built, and two further rows resting on it, so T-15, T-16
  and T-17 would have read a binding architecture the code does not have.
  Corrected here: only the claims this ticket invalidates. A decision that is
  right for a wrong reason keeps the decision — no sampling parameters are sent
  because both default models reject them, which is true with or without a
  cache — and the general pass over the document remains T-18's.
- **Acceptance criteria:**
  - [ ] A unit test shows `cacheable()` returns a block carrying no cache
        control when the flag disables it, and one that does when it does not
  - [ ] Mutation: ignoring the flag inside the factory fails that test and
        nothing else
  - [ ] `npm start -- --help` still lists five flags, and the cache line names
        the prompt cache
  - [ ] An unsupported mode is rejected by name, with the accepted ones listed
  - [ ] T-15's replay criterion is rewritten and the change is explained in the
        commit body
  - [ ] `npm run typecheck` exits 0
- **Commit:** `fix(agent): make --cache control the prompt cache it names`

---

### T-15 — Commit the generated application from the first full run

- **Why:** Output Quality carries the same weight as the loop. This is the
  ticket that produces the artifact the evaluator runs, and a committed run
  gives them a zero-cost path to seeing it work before they spend a token of
  their own. Addresses Output Quality.
- **Depends on:** T-01, T-02, T-14
- **Files:** `generated-app/**`, `agent/runs/<runId>/**`
- **Scope:** Validate the loop end to end against a reduced single-feature spec
  first, then run the primary specification. Iterate on the knowledge packs —
  not on individual task prompts — until the application comes out green.
  Commit the generated application and the run artifacts, including a run whose
  log contains a real failure-and-repair cycle. Does **not** hand-edit the
  generated application: a defect there is fixed by changing a pack and
  re-running.
- **Acceptance criteria:**
  - [ ] `cd generated-app && npm install && npm run typecheck` exits 0
  - [ ] `cd generated-app && npm run test` passes, with tests the agent wrote
  - [ ] `cd generated-app && npm run dev` serves the application and it renders
        the inventory
  - [ ] All seven features from the primary spec are present and each can be
        pointed at a file
  - [ ] The committed run log contains at least one fail → repair → green cycle
  - [ ] `git log` shows no manual edit to `generated-app/` after its commit
  - [ ] All five run artifacts are committed under `agent/runs/<runId>/`, so the
        run can be read end to end without spending a token
- **Commit:** `feat(app): add generated application from first full run`

---

### T-15B — Stop punishing a task for a failure that is not its own

- **Why:** The run committed in T-15 exposed three defects that only appear
  once the loop runs end to end, and all three make the agent report a worse
  result than it produced. Two tasks were failed and rolled back for reasons
  that had nothing to do with the file they wrote, and the run exited 1 with a
  complete, green application on disk. Error Recovery is a scored concept, and
  a recovery loop that manufactures its own failures argues against itself.
  Each of the three carries evidence from `/tmp/run-v2.log` and the committed
  artifacts of run `2026-08-14T20-57-19-479Z`. The fourth was found while fixing
  them: it is the same confusion read the other way round, and it reports a
  better result than the run produced, which is the more expensive direction.
- **Depends on:** T-15
- **Files:** `agent/src/nodes/validate.ts`, `agent/src/nodes/repair.ts`,
  `agent/src/graph/routers.ts`, `agent/src/graph/verdict.ts`,
  `agent/src/nodes/review.ts`, `agent/src/prompts/reviewer.ts`,
  `agent/src/cli.ts`, `agent/src/nodes/__tests__/validate.test.ts`,
  `agent/src/nodes/__tests__/repair.test.ts`,
  `agent/src/nodes/__tests__/routers.test.ts`,
  `agent/src/nodes/__tests__/review.test.ts`,
  `agent/src/graph/__tests__/verdict.test.ts`, `docs/ARCHITECTURE.md`
  — the last five beyond the three the third defect was first scoped to: the
  rule about what a run has left open lives in `verdict.ts`, and its readers are
  `runVerdict` for the exit code, `review` for the unfinished list the reviewer
  is shown, and the CLI for what it prints beside the exit code.
- **Scope:**
  - **The suite runs for a test file, not for a task type.** `validate` decides
    to run it when `task.taskType === "test"`, which is the planner's label and
    not a fact about the path. A shared render helper is reasonably typed
    `test` and is not a file the runner collects, so validating it while no
    real test exists yet reports `no-test-files` against a file that type-checks
    clean. It killed `test-utils` at position 5 of 15 and, through the same
    window, `test-add` at 12. Decide from the path the task wrote — the runner's
    own include patterns — and from `isLast`.
  - **A repair does not assume the file is there.** `repair` calls `readFileIn`
    on `task.targetPath` unconditionally, so a task whose generation never
    produced a file fails with `ENOENT` on every attempt and spends the budget
    anyway. Two attempts were burnt this way on `test-add`. Related and worth
    settling in the same pass: a task `generate` has already marked `failed`
    should not reach the repair loop at all — it did, twice.
  - **A remediation settles the task it replaces.** `remediation-1-1` and
    `remediation-1-2` wrote the two missing files green, and `status` still
    held `test-add` and `test-utils` as failed. So the verdict counted them,
    the run exited 1 with nothing wrong on disk, and the reviewer reported the
    same two gaps again in round 2 about files it could see in the surface.
    Close the loop: a remediation that succeeds resolves the gap it was made
    for. Say in `docs/ARCHITECTURE.md` what a failed task means after this.
  - **A clean validation over nothing is not a task done.** The mirror of the
    first three, found while fixing them. A task whose generation wrote no file
    gives the type checker nothing to reject and the suite nothing to run, so
    `validate` settles it `done` on two green signals about work that was never
    performed — and the run reports a file that does not exist as a met
    requirement. The guard has the same shape as the one `repairable` gets:
    `validate` does not settle a task `generate` already gave up on.
- **Acceptance criteria:**
  - [ ] A unit test shows a task writing a non-collected file does not trigger
        the suite, and one writing a collected file does
  - [ ] A unit test shows a repair on a missing file reports a diagnosable
        failure rather than throwing, and a task already marked `failed` is
        never routed to `repair`
  - [ ] A unit test shows a successful remediation clears the original task's
        failure, so `runVerdict` returns 0 for a run whose gaps were all closed
  - [ ] A unit test shows a clean validation does not settle a task `generate`
        gave up on, so a file that was never written does not exit 0
  - [ ] Each of the four is pinned by mutation: reverting it fails its own
        test and nothing else
  - [ ] `npm run typecheck` exits 0
- **Note:** Do **not** re-run the primary specification to prove these. T-16
  runs the agent against the second specification anyway, and that run is the
  validation — one execution, both purposes.
- **Commit:** `fix(agent): stop failing a task for a failure that is not its own`

---

### T-16 — Verify generalization with a second spec

- **Why:** The brief names memorization as a red flag and states the spec may be
  modified to test it. The second specification changes both domain and
  requirements, so an agent carrying a fixed catalogue fails visibly rather
  than subtly. Turns a claim into evidence.
- **Depends on:** T-15
- **Files:** `agent/runs/<variantRunId>/**`, `docs/generalization.md`
- **Scope:** Run the agent unchanged against `specs/variant.md` with a separate
  output directory. Commit the run artifacts and a short write-up of what the
  planner produced, what came out green, and what did not. Does **not** edit
  any prompt or pack to make the variant succeed — a change made for the
  variant invalidates the test it exists to perform.
- **Note:** Expect the previous domain to survive unevenly, and treat it as a
  correctness risk rather than as cosmetic dead code. A file no task claims is
  left untouched; a file a task *rewrites* — `src/graphql/queries.ts`,
  `src/mocks/handlers.ts`, `src/mocks/data.ts` — is whatever the coder decided to
  write that time, since nothing constrains it to keep or to drop what was there.
  Two runs of the same specification on the same agent build, during T-10,
  decided it both ways: one kept the previous domain's query and mutation and
  added the new query beside them, the other replaced the file outright.
  Each of those runs was internally consistent, which is the part that is not
  guaranteed: `queries.ts` and `handlers.ts` are written by two different tasks
  with no edge tying their contents together, so a run that keeps an operation in
  one and drops it from the other ships an application issuing a request nothing
  answers. Verify that the two agree, report what the run actually did, and if
  they disagree say so — `docs/generalization.md` is where it gets written down.
  Removing the leftovers deliberately would mean giving the planner authority to
  delete files, which is a larger decision than this ticket makes.
- **Acceptance criteria:**
  - [ ] The run completes using the same agent build committed in T-15, with
        only the spec and output path changed
  - [ ] The generated plan contains tasks for the requirements unique to the
        variant — the additional filter and the detail view — and none for the
        primary spec's create form
  - [ ] `docs/generalization.md` reports the outcome including anything that
        failed, with the failure explained rather than omitted
  - [ ] `grep -riE "car|vehicle|dealership|vinyl|record|artist|sleeve"
        agent/knowledge/ agent/src/prompts/` returns nothing — neither domain
        leaked into the prompts
  - [ ] The variant run's artifacts are committed and readable without running
        the agent
- **Commit:** `test(agent): verify generalization with a second spec`

---

### T-17 — Run the same spec on both providers and record the table

- **Why:** The submission asks which models were used and why, and for an
  approximate cost per run. One table answers both and demonstrates that the
  provider abstraction works rather than asserting it. Addresses Documentation
  and *Creativity*.
- **Depends on:** T-15
- **Files:** `agent/runs/<providerRunId>/**`, `docs/provider-comparison.md`
- **Scope:** Run the primary specification once per provider, changing only
  `--provider`. Record provider, model, input and output tokens, cached reads,
  cost, tasks succeeded and failed, repair cycles triggered, and whether the
  application came out green. This is a measurement pass, not a tuning pass:
  results are recorded as they come out. Does **not** iterate on prompts to
  improve either provider's numbers.
- **Acceptance criteria:**
  - [ ] Both runs are launched with identical arguments except `--provider`
  - [ ] `docs/provider-comparison.md` contains every column above, populated
        from the ledgers rather than by hand
  - [ ] Any failure is recorded with its cause, not omitted
  - [ ] The cost figures reconcile with each run's `usage.json`
  - [ ] Artifacts for both runs are committed
- **Commit:** `docs: add provider comparison across two LLMs`

---

### T-18 — Write the README with architecture, tradeoffs and cost

- **Why:** Documentation is a scored criterion, and the brief asks for specific
  content: setup, architecture with a diagram, which models and why, tradeoffs
  considered, what would be improved with more time, and approximate cost per
  run. Also the last chance to make the repository legible to someone who has
  not read the code.
- **Depends on:** T-15, T-16, T-17
- **Files:** `README.md`, `docs/ARCHITECTURE.md`, `docs/process.md`
- **Scope:** Fill every section of the README skeleton. The architecture diagram
  is the output of `npm run graph:mermaid`, pasted in — replacing the hand-drawn
  diagram in the architecture document with the generated one. Include the
  decision table, the provider comparison, the cost figures, and a
  `## How I worked` section covering method and authorship. Does **not** append
  the scaffolding prompts used to build the repository; at most one example
  prompt in `docs/process.md`.
- **Note:** Three things this ticket inherits, found while closing T-14B and
  left here rather than fixed there, because no ticket in between depends on
  any of them.
  - **The checkpointer row in section 5 names `MemorySaver`, which the code
    does not install.** `buildGraph` compiles without a checkpointer and
    nothing under `agent/src` imports one. T-14B corrected that row's cost
    column, which claimed a response cache made restarts cheap; the decision
    the row names was left standing and is wrong.
  - **`README.md` still offers to "replay the committed run at zero cost".**
    The same dead promise T-14B removed from the architecture document. What a
    reader gets for free is the committed run's artifacts, not a re-execution:
    there is no response cache, and the prompt cache needs a key like any
    other call.
  - **The diagram in the architecture document is still the hand-drawn one.**
    `npm run graph:mermaid` emits all eight nodes and every edge, so the
    replacement this ticket already asks for is a paste — and the prose around
    the diagram, which counts the nodes and colours them by whether they call a
    model, has to keep matching what the generated one shows.
- **Acceptance criteria:**
  - [ ] Every submission requirement has a section: setup, architecture and
        diagram, which models and why, tradeoffs, what would be improved, cost
        per run
  - [ ] The diagram in the README is byte-identical to the current output of
        `npm run graph:mermaid`
  - [ ] The decision table states, for every row, the axis it wins on and what
        it costs — no row reads "cleaner" or "better" without both
  - [ ] `## How I worked` is present and states plainly that the architecture
        and decomposition are the author's decisions and that AI executed under
        review
  - [ ] Following the README's setup steps from a fresh clone reaches a working
        run
  - [ ] No file in the repository contains a language other than English
- **Commit:** `docs: add README with architecture, tradeoffs and cost`

---

## Post-submission tickets

T-01 through T-18 are the submission. What follows are defects the completed
runs exposed, written up as tickets because they were found with evidence and
should be fixed the same way everything else was, not patched in a hurry before
a tag. **T-19 and T-20 are worth doing; T-21 and T-22 are optional and say so.**
Nothing here is a prerequisite for tagging: T-18 records each of them in the
README's *what I would improve* section, so an unfixed defect is disclosed
rather than hidden.

---

### T-19 — Tell a truncated answer from a wrong one, and stop shipping local paths

- **Why:** `MAX_OUTPUT_TOKENS` in `agent/src/llm/factory.ts:58` is 16,000, and
  the provider comparison run hit it four times in a row. In
  `agent/runs/2026-08-14T22-54-34-766Z/usage.json`, `test-sort` and
  `remediation-1-1` each emitted exactly 16,000 output tokens twice, while the
  three test tasks that succeeded had already reached 67%, 83% and 95% of the
  same ceiling — so this is the tail of a distribution the run was sitting in,
  not an outlier. Every one of those four answers arrived as *the answer carried
  no "contents" field*, which is the same sentence a refusal and a wrong-shaped
  object produce. The schema retry added in T-13B therefore re-asked a question
  whose answer could never fit, and the run paid four ceilings — roughly $1.60 —
  to lose a requirement. `digestAnswer` already documents this hole in its own
  comment: it names "a response cut off mid-generation" as one of three cases it
  cannot separate. Addresses Implementation Quality and Output Quality.
- **Depends on:** T-18
- **Files:** `agent/src/llm/factory.ts`, `agent/src/schema/file.ts`,
  `agent/src/nodes/generate.ts`, `agent/src/nodes/repair.ts`,
  `agent/src/nodes/__tests__/generate.test.ts`,
  `agent/src/llm/__tests__/factory.test.ts`, `agent/src/tools/trace.ts`,
  `docs/ARCHITECTURE.md`
- **Scope:** Two changes, both small, neither depending on the other.

  **The ceiling.** `invokeStructured` already receives the raw message and
  currently keeps only its usage. Surface the stop signal from it —
  `stop_reason` on the native adapter, `finish_reason` on the OpenAI-compatible
  one — as an optional field on `StructuredResponse`. **Read the field names off
  the installed adapters; do not infer one provider's from the other's.** A
  truncated answer must be reported as truncated, must not consume a schema
  retry, and must not be retried with the same request, which produces the same
  truncation. Then raise the ceiling, and justify the new number from the
  measured distribution above rather than picking a round one.

  **The trace.** `generate.ts:104` traces `resolvePath` with the resolved
  absolute path in `detail`, so every committed `tools.jsonl` carries the
  machine it ran on: 37 lines of the author's home directory in the T-15 run,
  and `/private/tmp/...` in the T-17 runs. Record the path relative to the
  output directory instead.
- **Acceptance criteria:**
  - [ ] A truncated structured answer is distinguishable from a malformed one
        in the log, and the two produce different messages
  - [ ] A truncated answer does not spend a schema retry on an identical request
  - [ ] Both providers' stop signals are covered by a test using a fake response,
        so no acceptance criterion here requires a paid run
  - [ ] The new ceiling is stated with the evidence for it in a comment
  - [ ] No `detail` field in a newly written `tools.jsonl` is an absolute path
  - [ ] `npm run typecheck` exits 0 and `npm test` passes
- **Note:** Two defects in one ticket because each is under an hour and both
  touch the same call path; the commit body carries both, separately. Add the
  truncation field as **optional** — six test fakes implement
  `StructuredResponse` by hand and a required field breaks all of them for no
  benefit. Do **not** hand-edit the already-committed `tools.jsonl` files: they
  are the record of runs that happened, and the fix is for the runs that come
  next.
- **Commit:** `fix(agent): detect a truncated answer instead of blaming the model`

---

### T-20 — Cross-check GraphQL operations against the mock handlers

- **Why:** The most dangerous defect the runs exposed is the one no signal
  reports. The generated tests mock above the network with `MockedProvider`, so
  MSW never receives a request and never raises the unhandled-operation error
  the boilerplate arms it with. An operation declared in `src/graphql/queries.ts`
  with no handler in `src/mocks/handlers.ts` leaves the type check clean, the
  suite green and the exit code at zero, and surfaces only as the application's
  error state in a browser. T-16 found this and `docs/generalization.md` records
  it; nothing checks it. Addresses Output Quality.
- **Depends on:** T-18
- **Files:** `agent/src/validate/operations.ts` (new),
  `agent/src/validate/__tests__/operations.test.ts` (new),
  `agent/src/nodes/review.ts`, `docs/ARCHITECTURE.md`
- **Scope:** A deterministic check, run once in `review` before the model is
  called, whose result is given to the reviewer as a fact rather than left for
  it to notice. Read the operation names declared in the project's query module
  (`query X` / `mutation X` inside the `gql` templates) and the names the mock
  module handles (`graphql.query("X")` / `graphql.mutation("X")`); every
  declared operation with no handler is a gap. The reviewer already queues
  remediation tasks for gaps, so the gap reaches the existing repair path
  without a new mechanism. Does **not** add a GraphQL parser or any other
  dependency — the two shapes above are the ones the boilerplate uses and the
  ones the agent writes. Does **not** check the reverse direction: a handler
  with no operation is unused, not broken.
- **Acceptance criteria:**
  - [ ] An operation with no handler is reported as a gap, proved by a fixture
  - [ ] A project where every operation has a handler reports nothing
  - [ ] A project whose query or mock module is absent reports nothing and does
        not fail — the check is an addition, not a new way to break a run
  - [ ] The check makes no model call and adds no dependency
  - [ ] `npm run typecheck` exits 0 and `npm test` passes
- **Note:** The check is textual and its ceiling should be written where it
  lives: an operation named through a variable, or a handler registered in a
  loop, is invisible to it. That is acceptable for a check that costs nothing
  and catches the case that actually occurred, but it has to be stated rather
  than discovered.
- **Commit:** `fix(agent): report a query the mock layer cannot answer`

---

### T-21 — Refuse an output directory that is not empty (optional)

- **Why:** `prepare` copies the boilerplate with `fs.cp` and never clears the
  destination, and only two reference files are removed. Running a second time
  into the same directory therefore merges the new run on top of the old one:
  stale components stay on disk, `readSurface` reports them, and the type
  checker compiles them. The committed `generated-app/` makes this reachable
  from a fresh clone, because the README's quick start used to point there.
  T-18 documents the trap; this closes it. Addresses Implementation Quality.
- **Depends on:** T-18
- **Files:** `agent/src/nodes/prepare.ts`,
  `agent/src/nodes/__tests__/prepare.test.ts`, `README.md`
- **Scope:** If the output directory exists and is not empty, record a setup
  failure and let the graph reach `report` — the path `prepare` already has for
  a failed install. **Refuse; do not delete.** `--output` is user-supplied, and
  a recursive delete on a user-supplied path is a way to lose someone's work
  that no guard list fully closes. Once this exists, the README's quick start
  can point at a fresh directory and say why in one line.
- **Acceptance criteria:**
  - [ ] A run into a non-empty directory fails at `prepare` with a message
        naming the directory, and spends nothing on the provider
  - [ ] A run into a missing or empty directory is unaffected
  - [ ] No code path in this ticket deletes a file outside the sandbox
  - [ ] `npm run typecheck` exits 0 and `npm test` passes
- **Commit:** `fix(agent): refuse to build on top of a previous run`

---

### T-22 — Make a run legible before and while it is running

- **Why:** A run takes around twenty-five minutes and prints a flat stream of
  `[node] event: detail` lines. Nothing says which task of how many is in
  flight, how long it has taken, or what it has cost so far — all three are
  already in state and none of them are shown, and between two model calls the
  terminal sits still for minutes with no sign the process is alive. Starting a
  run is no better: the two required flags have to be typed from memory or read
  out of `--help`, and the specifications on offer are sitting in `specs/`. This
  is also what makes a short terminal recording usable in the README, which is
  the only way a reader sees the agent work without spending their own credit.
  Addresses Documentation.
- **Depends on:** T-18
- **Files:** `agent/src/cli.ts`, `agent/src/cli/ansi.ts` (new),
  `agent/src/cli/menu.ts` (new), `agent/src/cli/launcher.ts` (new),
  `agent/src/cli/dashboard.ts` (new), `agent/src/cli/live.ts` (new),
  `agent/src/cli/progress.ts` (new), their tests under
  `agent/src/cli/__tests__/`, `.gitignore`
- **Scope:** Three pieces over one shared set of terminal primitives
  (`ansi.ts`: the palette, the widths, the box characters), one commit.

  **The progress line.** Task position (`7/14`), the tasks in flight, elapsed
  time and accumulated cost, all read from state and the ledger already there.
  This is what a run with no terminal prints, one line per superstep.

  **The launcher.** Started on a terminal with no `--spec`, the CLI draws a
  welcome box carrying the version, the Node it is running on and whether a
  `.env` was found, then one screen holding both questions at once — a
  specification from `specs/`, described by its own first heading, and a
  provider from the list the factory already exports. Arrow keys move inside the
  question in flight, `enter` settles it and hands the focus on, `q` leaves.
  Both answers stay on screen while the other is being made, which is the point
  of a screen over two consecutive prompts.
  Any flag given, or either end of the terminal not interactive, and the command
  line behaves exactly as before: **a prompt nobody can answer is a hang**, and
  the evaluator's `npm start -- --spec … --output …` must reach the graph
  untouched. The output directory is **not** asked for as free text — it is a
  fresh `runs/app-<timestamp>`, because `prepare` merges into a directory that is
  not empty (T-21) and a typed path is where that costs someone their work.

  **The live screen.** On a terminal the run is drawn on the **alternate
  buffer**: the facts and the plan on the left — run id, provider, model, cache,
  status, position, a progress bar, elapsed, an estimate of what is left, cost,
  and one row per task with its own clock and its own spend — and the log on the
  right, wrapped to its pane, scrollable with the arrows and the page keys.
  `q` stops the run: the graph is given an `AbortSignal` through the same config
  that carries the recursion limit, so the call in flight is cancelled rather
  than paid for and discarded.

  The bottom two rows of the log pane are **reserved**, not drawn over: a blank
  row and, under it, a line saying what the run is waiting on and for how long,
  turning while it waits. A run spends minutes inside one model call, and a pane
  that can only show lines cannot tell a wait from a hang. Reserving the rows is
  what guarantees the two never touch however full the pane gets, and the line
  becomes the run's verdict — finished or stopped, with the count and the spend
  — once there is nothing left to wait for.

  The alternate buffer is the whole reason a full-screen view is acceptable
  here. The shell's scrollback is untouched while the run draws, and on the way
  out the screen is handed back and **the entire log is replayed onto the normal
  buffer** — the pretty view is for watching, the lines are what the reader
  keeps. Nothing about the log's content changes: same `[node] event: detail`,
  same order.

  The estimate of what remains is a straight-line extrapolation of the pace so
  far and is labelled as an estimate wherever it appears. Tasks are not the same
  size, and a test task that runs the whole suite is not a component.

  **Zero new dependencies:** no `chalk`, no `ora`, no `inquirer`. Raw ANSI
  escapes, `process.stdin`'s raw mode and `setInterval` are the whole mechanism,
  and every one of them is off unless the stream is a TTY. Colour is 256-colour,
  not 24-bit: a terminal without truecolor renders a 24-bit escape wrong rather
  than approximately. Every glyph is one cell from a plain Unicode block —
  nothing from a patched font, which is not something a package manager can
  install and which an unpatched terminal draws as a box.
- **Acceptance criteria:**
  - [ ] The progress line shows position, task, elapsed time and cost to date
  - [ ] `npm start … | cat` produces output with no escape sequences, and a run
        with no terminal never waits for a keypress
  - [ ] `git diff` for this ticket adds no entry to `package.json`
  - [ ] Every existing log line still appears, unchanged, and a run watched on
        the live screen still leaves its whole log in the shell afterwards
  - [ ] The frame fits the terminal it is given — every row inside the width,
        every frame inside the height — at several sizes and in both palettes
  - [ ] The waiting line is separated from the last log line by a blank row at
        every size, including a pane with more lines than it can hold
  - [ ] `q` reaches the graph as an abort, and the run reports that it was
        stopped rather than that it finished
  - [ ] A cancelled menu ends the process without calling a provider
  - [ ] The terminal is left out of raw mode however the launcher exits
  - [ ] Each specification is described by its own heading, so a new one needs
        no table anywhere in the agent
  - [ ] No glyph on screen requires a font the reader has to install
  - [ ] `npm run typecheck` exits 0 and `npm test` passes
- **Note:** The brief lists "a perfect UI" under what it is not looking for;
  that is about the generated application, and this ticket spends its restraint
  elsewhere — the launcher and the live screen are ANSI escapes over stdout with
  no dependency behind them, and both disappear the moment the output is not a
  terminal. It depends on nothing but T-18 and can be taken in any order.

  **Render the tasks in flight as a set, not as one task.** Today a level is
  always one task wide, so a set of one prints exactly what a single task would
  — but T-23 puts a whole level in flight at once, and a progress line written
  around a single current task has to be rewritten then. Written as a set it
  survives untouched. The same applies to the position counter: count tasks
  finished out of tasks planned, which stays true whatever runs concurrently.

  **What is testable here is not what is on screen.** Every layout decision is a
  pure function from a view and a size to a string, so the tests assert the
  frame itself — that no row overflows the width at any size, that the newest
  lines are the ones shown until the reader scrolls, that a stopped run does not
  claim to be running — alongside the key decoding, the selection arithmetic and
  the per-task clocks. What is left untested is the terminal itself: nothing
  here drives a real TTY, and no test spends a token.
- **Commit:** `feat(agent): add an interactive launcher and a live progress line`

---

### T-23 — Generate a whole topological level concurrently

- **Why:** A full run of `specs/car-inventory.md` takes 32 minutes of wall clock
  for 25 model calls, and almost all of that is waiting on a provider. Tasks at
  the same topological depth are independent **by construction**: their
  `dependsOn` sets are disjoint from each other, and the planner guarantees one
  task writes one file, so the calls that produce them can be in flight at once
  without any of them observing another's work.

  The committed plans say what that is worth. Grouping each plan's tasks by
  depth over its own `dependsOn` edges:

  - `car-inventory.md` — 15 planned tasks in **5 levels**, widths 6, 2, 1, 1, 5.
  - `variant.md` — 18 planned tasks in **7 levels**, widths 3, 3, 3, 1, 1, 6, 1.

  So generation goes from 15 sequential rounds to 5, and from 18 to 7 — a
  ceiling of about 3x on the part of the run that is spent waiting. The five
  test tasks the README already cites as 27.8% of the tasks and 59.4% of the
  output all sit in one level, level 5 of the variant plan. Sequential execution
  was chosen deliberately for the auditable trace, and the README publishes the
  measurement that says what it costs. This ticket collects it.
- **Depends on:** T-19
- **Files:** `agent/src/nodes/generate.ts`, `agent/src/graph/routers.ts`,
  `agent/src/graph/state.ts`, `agent/src/graph/index.ts`,
  `agent/src/nodes/__tests__/generate.test.ts`,
  `agent/src/graph/__tests__/routers.test.ts`, `docs/ARCHITECTURE.md`,
  `README.md`
- **Scope:** **Parallelise the model calls, not the state machine.** `generate`
  visits a level rather than a task: it issues one call per task in the level
  concurrently, writes each answer to the task's own path, and returns. Nothing
  else becomes concurrent. `validate` still runs once per visit, and `repair`
  still handles one task at a time — which is what keeps the failure path the
  one already proved by four runs.

  **`order` does not produce levels today and this ticket has to make it.**
  `order.ts` runs Kahn's algorithm and pushes one id at a time into a flat
  `orderedTaskIds`, and `cursor` is an index into that list. Levels come out of
  the same algorithm by draining the whole ready set each round instead of one
  node from it, which is a change to the loop and not to the algorithm. Decide
  and state whether `orderedTaskIds` becomes `string[][]` or a second field
  appears beside it; the flat list is read by `routeAfterOrder`, `taskInFlight`
  and the log line, so whichever way it goes, every reader moves with it.
  `RECURSION_LIMIT` also falls: its `MAX_PLAN_TASKS * STEPS_PER_TASK` term is
  counted per task and a level is now one visit, so recompute it and say what
  the new bound means.

  Three invariants have to survive, and each has an owner today:

  - **Attribution.** `attributable` matches `error.file` against
    `task.targetPath`. It generalises to a level unchanged *because* one task
    owns one file; assert that rather than assume it.
  - **Rollback.** A snapshot is per file, so rolling one task back inside a
    level touches nothing another task in that level wrote. The `surface`
    manifest must stay consistent with disk for **every** task in the level,
    which is the bug T-15 fixed for one.
  - **Repair budgets.** `MAX_REPAIRS_PER_TASK` and `MAX_REPAIRS_PER_RUN` are
    counted per task and per run, neither of which a level changes. `taskInFlight`
    does change, and is the function to redesign first.

  Does **not** parallelise `validate`, `repair` or `review`. Does **not** add a
  concurrency library — `Promise.all` over the level is the whole mechanism.
  Does **not** change the plan, the ordering, or any prompt.
- **Acceptance criteria:**
  - [ ] Tasks in one topological level are generated concurrently; tasks in
        different levels are not
  - [ ] A failure inside a level rolls back only its own task's file, proved by
        a test with two tasks in one level where one fails
  - [ ] The log still attributes every line to a task, so a reader can
        reconstruct what happened without knowing the level boundaries
  - [ ] A real run of `specs/car-inventory.md` is measured against the committed
        32-minute baseline and the figure is published, whatever it says
  - [ ] The run's cost is reported beside the time, including the cache-write
        effect described below
  - [ ] `npm run typecheck` exits 0 and `npm test` passes
- **Note:** One cost is predictable and should be measured rather than
  discovered: the prompt cache's breakpoint is written by the first call that
  sends the prefix and read by every later one. Concurrent calls in the first
  level all start before any of them has written the entry, so some of them pay
  a cache **write** at 1.25x instead of a read at 0.1x. On the committed run the
  prefix is 4,867 tokens, so the ceiling on this is small — but publish it,
  because a speed-up that quietly costs money is the kind of tradeoff this
  repository documents rather than hides.
- **Commit:** `perf(agent): generate a topological level concurrently`

---

### T-24 — Give the planner a policy for a specification it cannot trust

- **Why:** Of the three prompts the agent ships, the planner is the only one
  with no instruction for what to do when the input is incomplete, ambiguous or
  false. `CODER_SYSTEM` has one — *"a name you were not given does not exist …
  use the closest thing you were given rather than inventing the name you
  expected to find"* — and `REVIEWER_SYSTEM` has a strong one, in the whole
  *what is not a gap* block. `PLANNER_SYSTEM` has rules for decomposition and
  for what each field means, and nothing for uncertainty. That gap was reached
  in practice: `specs/variant.md` opens by stating that the collection already
  sits behind the project's GraphQL API, and what sits there is cars. The
  planner improvised a defensible answer — adapt at the hook boundary — with no
  rule telling it to, which means the next false premise gets whatever the model
  finds plausible that day. Addresses Prompt Engineering.
- **Depends on:** none
- **Files:** `agent/src/prompts/planner.ts`,
  `agent/src/prompts/__tests__/planner.test.ts`,
  `agent/src/prompts/__tests__/packs.test.ts` (if the domain-vocabulary scan
  needs extending), `docs/ARCHITECTURE.md`
- **Scope:** Add one block to `PLANNER_SYSTEM` stating what to do when the
  specification and the project disagree, when a requirement is too vague to
  produce a checkable `acceptance` statement, and when the specification asks
  for something the surface cannot support. The policy has to be **actionable
  inside a schema that only returns tasks** — the planner cannot ask a question,
  so "ask" is not an available behaviour, and a rule that names an impossible
  action is worse than none. Prefer: adapt at the boundary and record the
  adaptation in the task's `description`, rather than invent a second source of
  truth or silently drop the requirement. Does **not** change the schema, the
  decomposition rules, or any other prompt.
- **Acceptance criteria:**
  - [ ] The new block names a behaviour the planner can actually perform under
        its schema
  - [ ] No domain vocabulary is introduced —
        `agent/src/__tests__/no-domain-vocabulary.test.ts` still passes
  - [ ] A test asserts the block is present in the system prompt, so a later
        edit cannot drop it silently
  - [ ] `npm run typecheck` exits 0 and `npm test` passes
- **Note:** Found by auditing the three shipped prompts against the seven-part
  prompt structure taught in the author's coursework: objective, context, data,
  rules, examples, format, uncertainty policy and quality criteria. The coder
  covers all of them, the reviewer all but the worked example, and the planner
  is missing the uncertainty policy — the one the course singles out as the
  difference between a professional prompt and an amateur one, because without
  it a model meeting a gap produces the most plausible continuation, which is to
  say it invents.
- **Commit:** `fix(agent): tell the planner what to do with a specification it cannot trust`
