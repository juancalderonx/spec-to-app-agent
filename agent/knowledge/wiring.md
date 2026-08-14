# Wiring tasks

- A wiring file composes pieces that already exist. Presentation or a query
  written here belongs in another file that this one imports.
- `src/main.tsx` already mounts `ApolloProvider`, `ThemeProvider`, `CssBaseline`
  and the MSW browser worker above the application shell. Do not mount any of
  them a second time; a nested `ApolloProvider` gives half the screen its own
  cache.
- Import each piece by its exported name through the project's path alias, and
  let the compiler name what is missing rather than re-exporting things in
  advance.
- Page-level layout lives here — the arrangement of the sections the
  specification describes, and nothing below that level.
- `@apollo/client` exposes named exports only, so every binding comes out of
  braces: `import { ApolloProvider } from "@apollo/client"`. Reaching for it as
  a default import fails the type check with `TS1192: Module
  '…/@apollo/client/index' has no default export`.
- `src/main.tsx` imports `src/App.tsx` as a default import, so whatever that file
  becomes, it keeps its default export. Lose it and the type check blames the
  entry point — `TS1192: Module '…/src/App' has no default export` — which is a
  file no task owns and therefore nothing repairs.
