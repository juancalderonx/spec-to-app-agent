# Styling tasks

- Style through MUI's `sx` prop and the theme. Do not add a stylesheet and do
  not reach for a CSS framework the project does not install.
- Responsive behaviour comes from `theme.breakpoints`, written as the
  breakpoint-keyed object form of an `sx` value. It compiles to CSS media
  queries, which is the one responsive mechanism that also holds up under jsdom.
- Spacing is theme units (`sx={{ p: 2 }}`), not pixels. Colour is a palette
  token (`color="text.secondary"`), not a hex literal — literals are how two
  screens end up almost the same shade.
- When the specification asks for legibility or density at a stated distance or
  device, that is a requirement: it becomes a type scale and a spacing choice
  you can point at, not an adjective in a comment.
- No `style` attribute for anything the theme can express.
