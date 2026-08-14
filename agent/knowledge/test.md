# Test tasks

- One behaviour per file, named after the behaviour it proves. A file asserting
  four unrelated things fails as one and tells you nothing about which broke.
- Render with Testing Library and assert what a person sees: role, accessible
  name, visible text. Not internal state, not class names.
- Taking an element out of a collection by position gives you `T | undefined`,
  because `noUncheckedIndexedAccess` is on. This is the option that fails
  generated test files more than any other. Assert over the whole collection
  where you can, so nothing is pulled out at all:

      expect(rows.map((row) => row.textContent)).toEqual([…]);

  When one element is genuinely needed, narrow it with a check that throws. A
  matcher does not narrow anything for the compiler — after
  `expect(row).toBeDefined()` the type is still `T | undefined`:

      const row = rows[0];
      if (row === undefined) {
        throw new Error("expected at least one row");
      }
      // an element from here on, and the failure says what was missing
- Give the subject its data through `MockedProvider` from
  `@apollo/client/testing`, with one fixture per operation the subject issues.
  The test renders that subject directly, so it inherits none of the providers
  the entry point mounts and supplies this one itself. It is used only as an
  element wrapping the subject:

      render(
        <MockedProvider mocks={fixtures} addTypename={false}>
          <Subject />
        </MockedProvider>,
      );

- `MockedProvider` is a class component, so **no type may be derived from it**.
  `ComponentProps<typeof MockedProvider>`, and anything else that treats it as a
  function, fails the type check with `TS2344: Type 'typeof MockedProvider' does
  not satisfy the constraint '(...args: any) => any'`. Give the fixture array its
  own annotation instead, or none at all and let it be inferred from the literal.
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
