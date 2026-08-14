# Test tasks

- One behaviour per file, named after the behaviour it proves. A file asserting
  four unrelated things fails as one and tells you nothing about which broke.
- Render with Testing Library and assert what a person sees: role, accessible
  name, visible text. Not internal state, not class names.
- Give the subject its data through `MockedProvider` from
  `@apollo/client/testing`, with one fixture per operation the subject issues.
  The test renders that subject directly, so it inherits none of the providers
  the entry point mounts and supplies this one itself.
- Never build a real client in a test. A request through `HttpLink` fails in this
  environment before it reaches the mock API, whatever handlers are in place —
  the standing constraints say why.
- A fixture matches only when the operation and every variable match exactly, and
  each fixture entity needs its `__typename` field; miss either and the test
  renders empty with no error.
- Await asynchronous output with `findBy*` queries or `waitFor`. Never with a
  timer.
- Interactions go through `userEvent`, awaited, so the events fired resemble the
  ones a person produces.
- Import Vitest's globals explicitly at the top of the file even though they are
  configured globally: the import is what the type check reads.
