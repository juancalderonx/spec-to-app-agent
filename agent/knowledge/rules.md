# Standing constraints

These hold for every file in this project. They describe how the provided setup
behaves, which is the part reading the source does not tell you until a test has
already failed.

## The compiler options you cannot see

The surface you are given covers source files, not configuration, so these are
stated here. Three of them reject code that would compile anywhere else:

- Indexing an array or a lookup yields `T | undefined`, always. A value taken
  from a list has to be narrowed before it is used — not asserted, narrowed.
  This is the option that catches most generated test files, where a row or an
  element is pulled out by position and passed straight to an assertion.
- An unused local or an unused parameter is an error, not a warning.
- `strict` is on in full. No implicit `any`, no implicit `this`, no unchecked
  null.

Two more that shape how a file is written: the path alias `@/` resolves to the
project's `src/`, and a library's names are imported from its package root —
never from a path inside the package, which is not part of its public surface
and does not export what the root exports.

## Every file you write exports by name

`export function`, `export const`, `export interface`. No default export, and
never both forms in one file. The import side follows from it, and one settled
convention removes a whole class of failure: a module whose export form has to
be guessed is imported the wrong way about half the time, and the guess costs a
repair cycle to discover.

One file is fixed by the provided setup and keeps its default export:
`src/App.tsx`, because `src/main.tsx` imports it as one and no task rewrites
`src/main.tsx`. Everything else is named.

The project is React with MUI for presentation, Apollo Client for GraphQL, MSW
for the mock API, and Vitest with Testing Library under jsdom for the tests.
Those four are fixed whatever the specification asks for.

## The test environment cannot measure the viewport

Tests run under jsdom, which implements no `window.matchMedia`, and the
project's `src/test-setup.ts` does not define one. MUI's `useMediaQuery` falls
back to `false` for every query when `window.matchMedia` is missing, so a
component that branches on it renders one fixed layout under test no matter what
the test intended — silently, with no error to read. A hook calling
`window.matchMedia` directly does throw.

The silence is the dangerous half. Every query answering `false` means the
component always takes the same branch, so a test asserting the behaviour of
that branch passes without having exercised anything: it is green because the
default happened to agree with it, not because the logic works. That test keeps
passing after the logic breaks, and the specification's other branch is never
covered at all.

Express responsive behaviour through `theme.breakpoints` instead: the
breakpoint keys in an `sx` value (`sx={{ display: { xs: "none", md: "block" } }}`)
compile to CSS media queries, which jsdom renders without complaint. If a
component truly needs the boolean in JavaScript, the test file that mounts it
has to define `window.matchMedia` itself before rendering — treat that as a
signal the component wants rewriting rather than as a pattern to spread.

## A test mounts its own providers, and mocks above the network

`src/main.tsx` is the only place `ApolloProvider`, `ThemeProvider` and
`CssBaseline` are mounted. A test renders its subject directly and never goes
through that file, so nothing it renders inherits any of them. A subject that
queries with no client in context renders its failure branch, and what breaks is
an assertion about text that is missing — which reads like a defect in the
component rather than a provider the test never supplied.

The client the test supplies has to be a mocked one. A real `HttpLink` cannot
complete a request here at all: jsdom provides the `AbortSignal` and the runtime
provides `fetch`, the two disagree about the type, and the request fails with
`RequestInit: Expected signal ("AbortSignal {}") to be an instance of
AbortSignal` before it ever leaves the client. Nothing on the mock API's side
changes that, because nothing on that side is reached. The client the project
itself ships fails the same way.

So mock above the network, with `MockedProvider` from `@apollo/client/testing`:

- A fixture matches only when the operation *and* every variable match exactly.
- Every entity in a fixture needs its `__typename`, or the cache normalises the
  result into nothing and the subject renders empty with no error to read.
- An operation with no fixture comes back as a failure, so a subject issuing two
  operations needs two — including the ones issued below it by its children.
- Add `ThemeProvider` around it only where the subject reads the theme.

## The mock API answers the application, not the test run

`src/mocks/handlers.ts` is what the running application talks to, through the
worker `src/main.tsx` starts in development. `src/test-setup.ts` starts those
same handlers for the test run, but a test mocking above the network never
reaches them.

Two things follow. An operation added to `src/graphql/queries.ts` still needs a
handler beside the existing ones, keyed by the operation name, or the running
application asks for something nothing answers. And those handlers keep their
seeded collection in a module-level variable that every mutation pushes into,
which `server.resetHandlers()` does not restore — it restores the handler list.
That variable is state the application accumulates as it runs, never a fixture
to assert against.

## What finished means

Both signals must pass: `npm run typecheck` and `npm run test`. Do not add a
dependency, and do not relax a compiler option to get past an error — the
options are the specification of what correct code looks like here.
