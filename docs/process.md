# How this repository was built

The brief says that how the work is done is part of what is assessed, and that a
git log cannot be reconstructed after the fact. This document says what the
method was, so the log can be read as the record of one rather than as a
narrative arranged afterwards.

The short version is in the README's *How I worked*. This adds the mechanics and
one of the prompts.

## The four stages

Each stage is a separate prompt, run in a separate session.

1. **Read the material and write down what it says.** The assessment PDF and the
   boilerplate README against each other, the twelve places they diverge, and
   which reading to follow where they conflict. Then the boilerplate itself —
   every file, plus the lockfile — installed and run, because the constraints
   that break generated code live in the configuration rather than in the prose.
   Its output is the assumptions in `docs/ARCHITECTURE.md` → *Notes &
   Assumptions*.

2. **Design, then decompose.** The node contracts, the shared state, and the
   decision table with its rejected alternatives — `docs/ARCHITECTURE.md` — and
   then `TICKETS.md`: one ticket per commit, each naming why it exists, the
   files it touches, its acceptance criteria and its commit message, ordered so
   that the dependency graph is acyclic. This is the stage where the
   architecture is decided. Nothing later is allowed to redesign it.

3. **Execute one ticket per session.** The prompt below, run once per ticket,
   always in a fresh session. Its output is one commit.

4. **Audit in a session with no memory of the work.** A session that has just
   written something is a poor judge of it, and a session that has read the
   whole plan tends to grade the plan rather than the code.

## Why one session per ticket

A session's context is re-sent in full on every turn and degrades as it grows.
Ten tickets in one session means half of ticket 3's failed attempts are still
conditioning ticket 9. A fresh session per ticket is context hygiene, and it has
a second effect that turned out to matter more: it forces every ticket to be
self-contained. If a session needed something that was not in the repository,
that was a defect in the ticket, and it got fixed in the ticket.

## The two gates

**A contract before any code.** Each session states, in a handful of lines,
which files it will create or modify and what each will expose, and then stops
for approval. A wrong plan is corrected there instead of after two hundred
lines. It caught real things: T-18's own contract is where the checkpointer row
in the decision table was found to name a library the code never installed.

**A self-review before each commit.** The session reads its own `git diff` in
full against four questions — is anything here outside this ticket, is there an
`any` or a silencing cast or a debug log, does any prompt carry the example
domain's vocabulary, and is each acceptance criterion actually met. Then it hands
over the exact `git add` / `git commit` block and stops. Every git command in
this repository was run by hand, outside the session; no session ever changed
history.

## What the commit bodies are

The bodies are the record of that review, which is why several of them document
a decision that was wrong and say why. `d835c3d` ships a working application and
then lists the three defects that same run exposed. `9b80b13` adds a ticket
whose entire subject is a flag that was advertised and did nothing. `ab51d97`
undoes a rule from four commits earlier. Reading them in order is reading the
design being corrected by evidence, which is the part a summary written at the
end cannot show.

## The prompt that ran once per ticket

Translated from the Spanish original — the sessions were conducted in Spanish,
under a standing rule that everything entering the repository is written in
English. Apart from the language it is the prompt as used, `T-XX` being the only
edit between tickets. It is included because it is the artifact that most
directly shows how the model's latitude was bounded: what it may decide, what it
must verify before claiming, and what it is not allowed to touch.

```text
Act as the engineer implementing this ticket, who knows that someone else will
read the commit without any context. Optimise for a diff that explains itself.

## Objective

Fully implement ticket T-XX from `TICKETS.md`, leave it verified, and close it
in a single commit.

## Context

Repository for a take-home challenge for a Senior Fullstack position focused on
Agentic AI. The evaluator will read the git log as part of the grading, and will
run the agent with their own API key and a possibly modified spec.

This session is new and does not remember the previous ones. All the context you
need is in the repository's files. The plan is already decided and approved:
your job is to execute T-XX, not to redesign it.

## What to read

In the current working directory, in this order:

1. `TICKETS.md` — find T-XX and read its whole block. It is your specification.
2. `docs/ARCHITECTURE.md` — the decisions already taken. Binding.
3. `git log --oneline` and `git status` — the real state, which overrules
   whatever the documents say.
4. The files the ticket declares it touches, plus the ones those import.
5. The briefing — only if you need to recall a boilerplate constraint. Do not
   read it by default.

Do not read the whole repository. Read what the ticket needs.

## Rules

Scope:

- Implement T-XX and nothing else. If you see a bug, an improvement or an ugly
  file that belongs to another ticket, do NOT touch it: note it at the end of
  your report.
- If T-XX depends on a ticket that is not committed yet, stop and tell me.
- If while implementing it you discover the ticket was wrongly framed, stop,
  explain what you found and propose the correction. Do not silently
  reinterpret it.

Language:

- You talk to me in Spanish; everything that enters the repository is in
  English: code, comments, file names, commit messages, documentation, specs
  and the agent's own prompts. No exceptions.

Code:

- Strict TypeScript. No `any`, no `@ts-ignore`, no `as` used to silence a type
  error. If the type does not fit, the design does not fit.
- Small modules with one responsibility. No speculative abstraction layers: the
  brief explicitly penalises "a sprawling abstraction layer".
- No new dependencies unless the ticket asks for one. If you need one, justify
  in a line why Node's standard library is not enough.
- Comments only where the code cannot explain itself: a non-obvious decision, a
  workaround, a known limit.
- The boundary with the framework, if the ticket touches LangGraph or
  LangChain: LangGraph orchestrates (graph, state, conditional edges);
  LangChain only talks to the provider (model selection, schema-enforced
  output, token metadata). All business logic goes in plain TypeScript
  functions inside the nodes. No prebuilt ReAct-style agents, no memories, no
  retrievers, no chains wired with `.pipe()`: those delegate to the framework
  exactly the part the challenge is assessing.
- Do not write LangGraph/LangChain JS APIs from memory. Verify signatures and
  versions against the official documentation or the types installed in
  `node_modules`. If an API you expected does not exist, say so instead of
  improvising an equivalent.

The agent's prompts (applies to any ticket that writes or edits one):

- Prompts live in their own files, not embedded among the logic.
- No vocabulary from the example application's domain inside the prompts. The
  domain enters through the spec file at runtime. A single hardcoded noun from
  the example domain is, in the brief's words, "a red flag".
- Every prompt expecting structured output must enforce the schema rather than
  ask for it in prose, and must validate the response before using it.
- The boilerplate's rules (strict tsconfig, import aliases, test pattern,
  component library version) are injected as a reusable block, not copied into
  each prompt.

Tests:

- Every ticket with non-trivial logic leaves at least one test that fails if
  that logic breaks. Non-trivial logic = a branch, a loop, a parser, a
  topological sort.
- The agent's tests do NOT call the LLM. What gets tested is the planner
  against a fixed response, the topological order, the error parsers and the
  file tools. A test that spends tokens does not get run.
- Do not invent frameworks or elaborate fixtures. Use the runner already
  configured.

Git (hard rule, no exceptions):

- I run every git command. You run none that changes anything. Forbidden:
  `add`, `commit`, `push`, `pull`, `fetch`, `merge`, `rebase`, `checkout`,
  `switch`, `branch`, `reset`, `revert`, `stash`, `tag`, `clean`.
- You may run the read-only ones to orient yourself: `git status`, `git log`,
  `git diff`, `git show`.
- When the ticket is done, give me the exact, copy-pasteable command block: the
  `git add` calls with explicit paths — one per line, no `-A`, no `.`, no
  wildcards — and the `git commit` with the message `TICKETS.md` declares.
- One commit per ticket. No branches, no touching earlier history.
- Do not propose staging `.env`, `node_modules`, build artefacts or anything
  ignored. Check `git status` before assembling the block.

## Procedure

1. Orientation. Read the material above. Confirm in one line: what T-XX is,
   what it depends on, and whether those dependencies are committed.

2. Contract. Before writing any code, tell me in 3–6 lines which files you will
   create or modify and what public surface each will expose. If that does not
   match what I expected, I correct you here rather than after 200 lines.
   STOP. Wait for my approval.

3. Implementation. Write the code. If the ticket has testable logic, write the
   test before or alongside the implementation, never at the end "if there is
   time".

4. Verification. Run the commands that apply and show me the real output: the
   agent's typecheck, the agent's tests, and — if the ticket touches the
   generation pipeline — a real end-to-end run. If something fails, fix it and
   run it again. Do not move on with anything red. Do not claim something
   passes without pasting the command's output.

5. Self-review. Run `git diff`, read all of it, and answer four questions out
   loud before committing:
   - Is there anything here that does not belong to T-XX?
   - Is there an `any`, an `as`, a `@ts-ignore` or a debugging `console.log`?
   - Is there example-domain vocabulary inside a prompt?
   - Is each of the ticket's acceptance criteria genuinely met, one by one?

6. Prepare the commit. Only if the four points above are clean. Run
   `git status` and hand me the command block for me to run. Do not run git.
   Wait for my confirmation.

7. Report, in the fixed format.

## When information is missing

- If the ticket is ambiguous, ask before implementing. A question costs 30
  seconds; the wrong ticket costs the whole ticket.
- If `TICKETS.md` and `docs/ARCHITECTURE.md` contradict each other, stop and
  show me both.
- If a verification cannot be run (missing key, missing dependency from another
  ticket), say so explicitly in the report as NOT VERIFIED. Do not mark it as
  met and do not omit it.
- If the agent needs a real LLM call and no key is configured, do not simulate
  the output: stop and tell me.

## Quality bar

The ticket is properly closed if:

1. `git diff` contains only what T-XX declared it would touch.
2. Every acceptance criterion is checked off and each says how it was verified.
3. Typecheck and tests pass, and their real output is pasted in the report.
4. There is no `any`, no silencing `as`, no `@ts-ignore` and no debug logging.
5. No prompt of the agent mentions the example application's domain.
6. The proposed commit block uses explicit paths, you ran no git command that
   changes state, and the message is the one `TICKETS.md` declared.
7. Someone reading only that commit understands what was added and why.

Start with step 1.
```
