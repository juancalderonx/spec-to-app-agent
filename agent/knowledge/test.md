# Test tasks

- One behaviour per file, named after the behaviour it proves. A file asserting
  four unrelated things fails as one and tells you nothing about which broke.
- Render with Testing Library and assert what a person sees: role, accessible
  name, visible text. Not internal state, not class names.
- Feed the subject through the project's MSW mock API, overriding the handler
  for the operation under test with `server.use(...)` so the fixture belongs to
  this test alone. The subject then exercises the same Apollo Client path the
  running application uses.
- Apollo's `MockedProvider` is the last resort, for a case MSW cannot express.
  It matches a fixture only when the operation and every variable match exactly,
  and each fixture entity needs its `__typename` field; miss either and the test
  renders empty with no error.
- Await asynchronous output with `findBy*` queries or `waitFor`. Never with a
  timer.
- Interactions go through `userEvent`, awaited, so the events fired resemble the
  ones a person produces.
- Import Vitest's globals explicitly at the top of the file even though they are
  configured globally: the import is what the type check reads.
- The suite errors on any request without a handler, so a subject that issues an
  operation nothing mocks takes down every test in the file, not just yours.
