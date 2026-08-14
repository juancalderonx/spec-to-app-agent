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
  and sets the exit code. Does **not** let a failed review sink an otherwise
  green run, and the reviewer does **not** read file bodies.
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
  - [ ] Replaying with `--cache read-only` reproduces the run without a key
- **Commit:** `feat(app): add generated application from first full run`

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
