# spec-to-app-agent

A command-line agent that reads a product specification written in plain
English and generates a working React 19 + TypeScript application into the
provided boilerplate — planning the work, generating file by file, validating
its own output with the type checker and the test suite, and repairing its own
failures.

> **Status: skeleton.** Sections marked `TODO` are filled in by T-18 once the
> agent exists and has produced a real run. See `TICKETS.md` for the plan and
> `docs/ARCHITECTURE.md` for the design and its reasoning.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Provide a key for the provider you want to use
cp .env.example .env    # then fill in one key

# 3. Generate the application
npm start -- --spec ./specs/car-inventory.md --output ./generated-app

# 4. Run what it produced
cd generated-app && npm install && npm run dev
```

`TODO (T-18)` — flag reference: `--spec`, `--output`, `--provider`, `--model`,
`--cache`, and how to replay the committed run at zero cost.

---

## What is in this repository

| Path | What it is |
|---|---|
| `agent/` | The CLI. The deliverable. |
| `boilerplate/` | The provided project, vendored. The agent copies it per run. |
| `generated-app/` | A committed run's output. Runnable without an API key. |
| `specs/` | The specifications the agent consumes. |
| `agent/runs/` | Artifacts from committed runs: plan, tool trace, errors, token ledger, summary. |
| `docs/ARCHITECTURE.md` | The design, node by node, and the decisions behind it. |
| `TICKETS.md` | How the work was broken down. |

---

## Architecture

`TODO (T-18)` — paste the output of `npm run graph:mermaid` here. The diagram
is rendered from the compiled graph, so it cannot describe an architecture the
code does not have.

`TODO (T-18)` — one paragraph per node. Full contracts are in
`docs/ARCHITECTURE.md`.

---

## Which models, and why

`TODO (T-18)` — the roles (planner, coder, reviewer), which model fills each on
each provider, and why the reviewer defaults to a different model from the one
that wrote the code.

`TODO (T-17, T-18)` — the measured comparison:

| Provider | Model | In / out tokens | Cached reads | Cost | Tasks ok / failed | Repair cycles | App green? |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

---

## Cost per run

`TODO (T-18)` — total cost of a full run, what the prompt cache saves, and the
per-task input token figures that show prompt size stays flat as the run
progresses. Numbers come from `agent/runs/<runId>/usage.json`.

---

## Design decisions and tradeoffs

`TODO (T-18)` — the decision table from `docs/ARCHITECTURE.md` §5, including
the orchestration choice and its costs, and which parts of the framework were
deliberately not used.

---

## Generalization

`TODO (T-16, T-18)` — the second specification, in a different domain with
different requirements, and what the agent produced from it. Reported as it
came out.

---

## What worked, and what I would improve

`TODO (T-18)`

---

## Notes and assumptions

See `docs/ARCHITECTURE.md` → *Notes & Assumptions* for observations about the
provided material — including the two places the assessment PDF and the
repository README differ, the dependency advisories found on a clean install,
and the configuration inconsistency that made two validation signals disagree.

---

## How I worked

I spent the first part of this exercise not writing code. I read the assessment
PDF and the boilerplate README against each other, found the places they
disagree, and wrote down which reading I would follow and why. Then I read the
boilerplate itself — every file, plus the lockfile — and ran it, because the
constraints that break generated code live in the configuration, not in the
prose. Only after that did I design the agent and break the work into the
tickets in `TICKETS.md`.

The tickets came before the code, deliberately. Each one names why it exists,
what it touches, and what has to be true for it to be finished. That upfront
pass is what let me work in small, ordered commits instead of discovering the
architecture while writing it — the git log is a record of the plan being
executed, not reconstructed afterwards.

I executed one ticket per session with a clean context, which forces each
ticket to be self-contained: if a session needed information that was not in
the repository, that was a defect in the ticket, not in the session. Each
ticket ended at an approval gate — I reviewed the work and staged it myself.
Every git operation in this repository was run by hand; no session ran a
command that changed history.

The final audit ran in a separate session with no memory of the work, because a
session that just wrote something is a poor judge of it. Where a technical
claim could be checked rather than argued, I checked it: the one prompt rule I
had reasoned my way into was disproved by writing both forms into a copy of the
boilerplate and running the type checker, so it never reached the agent's
prompts.

On authorship: the architecture, the decomposition into nodes, the decision
about what the model is allowed to decide, and the tradeoffs in
`docs/ARCHITECTURE.md` are mine. AI wrote code under my review, ticket by
ticket, against acceptance criteria I set. That is also the honest description
of how the tool in this repository is meant to be used — which is why it is
built so that ordering, validation, limits and cost are guaranteed by code, and
only the semantics are delegated to the model.
