# Hook tasks

- One hook per file, named `useSomething`, exported by name. No JSX in the file.
- Return one object with named fields — the result, the state of the call, and
  the actions. A positional tuple obliges every call site to re-explain what it
  destructured.
- A data hook wraps one Apollo `useQuery` or `useMutation` and stops there: it
  exposes the result together with `loading` and `error`, and leaves formatting
  to whoever renders it.
- Call hooks unconditionally at the top of the function. A hook behind an `if`
  breaks the moment that branch flips.
- Type the operation's variables and its result. The fields are already written
  down in the operations file, so there is no excuse to widen them.
- Something that only reshapes props is not a hook. Compute it where it is used.
