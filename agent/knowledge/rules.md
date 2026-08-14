# Standing constraints

These hold for every file in this project. They describe how the provided setup
behaves, which is the part reading the source does not tell you until a test has
already failed. Everything else — the compiler options, the import alias, the
dependency list, the operations the project exposes — is on disk and in the
surface you were given; this pack does not repeat it.

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

Express responsive behaviour through `theme.breakpoints` instead: the
breakpoint keys in an `sx` value (`sx={{ display: { xs: "none", md: "block" } }}`)
compile to CSS media queries, which jsdom renders without complaint. If a
component truly needs the boolean in JavaScript, the test file that mounts it
has to define `window.matchMedia` itself before rendering — treat that as a
signal the component wants rewriting rather than as a pattern to spread.

## Mocked state survives from one test to the next

`src/mocks/handlers.ts` keeps its seeded collection in a module-level variable
and every mutation handler pushes into it. `server.resetHandlers()` in the setup
file restores the *handler list*, not that variable: the second test in a file
sees whatever the first test wrote.

So never assert on a total count, an array length, or "the last entry" after a
test that has written through a mutation. Isolate the test instead:

1. Override the handler for that one test with `server.use(...)` from
   `@/mocks/server`, returning the fixture that test needs. The subject still
   goes through Apollo Client and MSW, which is how the application actually
   runs, and the override is dropped by the reset afterwards.
2. Only if a test cannot be expressed that way, fall back to Apollo's
   `MockedProvider`. It replaces the network entirely, so it matches a mock only
   when the operation *and* every variable match exactly, and each fixture
   entity needs its `__typename` or the cache normalises the result into
   nothing. A silent empty render is usually one of those two.

## An operation without a handler takes down the whole suite

The MSW server starts with `onUnhandledRequest: "error"`. One operation lacking
a handler does not fail a single assertion; it fails every test that renders
anything at all.

An operation added to `src/graphql/queries.ts` therefore needs a handler added
beside the existing ones in `src/mocks/handlers.ts`, keyed by the operation
name. Those are two files and so two tasks: neither is finished on its own. The
browser worker and the test server share one handler list, so a single addition
covers both.

## What finished means

Both signals must pass: `npm run typecheck` and `npm run test`. Do not add a
dependency, and do not relax a compiler option to get past an error — the
options are the specification of what correct code looks like here.
