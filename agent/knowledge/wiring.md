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
