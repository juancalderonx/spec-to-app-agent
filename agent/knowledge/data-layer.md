# Data-layer tasks

- Operations live beside the ones already defined, in `src/graphql/queries.ts`,
  declared with Apollo's `gql` tag and exported by name.
- Reuse before adding. An operation the project already exports is already
  handled by MSW, already typed and already covered by fixtures; a second
  declaration of the same fields splits the cache and drifts from the first.
- Name every operation. MSW keys its handlers by operation name, so an anonymous
  one is unroutable.
- Request the fields the callers render, and keep the entity's shape in the
  shared types file instead of restating it per caller.
- Type the variables of a parameterised operation; a variable typed loosely
  fails at the mock API, far from where it was written.
- A file in this layer holds no presentation and no hooks.
