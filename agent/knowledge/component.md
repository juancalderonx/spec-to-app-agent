# Component tasks

- One unit of presentation per file, exported by name, with the function named
  after the file.
- Export the props type by name from the same file so a parent can type its own
  state against it. Type props exactly; `any` and assertions that silence the
  compiler are defects, not shortcuts.
- A presentational file takes its data through props. Fetching belongs to a hook
  or to the data layer, and the wiring task connects the two.
- Cover every state the specification implies: in flight, empty, failed, and
  populated. A component that renders only the populated state fails the first
  test written against it.
- Give every interactive control an accessible name — a visible label, or
  `aria-label` when the control is icon-only. Tests query by role and name; a
  control without one can only be reached by class, which is worse.
- Keys on a list come from the entity's own identifier, never the array index.
- Build structure and controls from MUI components before writing a raw element
  with hand-written styles.
