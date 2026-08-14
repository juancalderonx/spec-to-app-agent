import type { ReactElement } from "react";
import { act, render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { MockedProvider } from "@apollo/client/testing";
import type { MockedResponse } from "@apollo/client/testing";
import { ThemeProvider, createTheme } from "@mui/material";
import {
  MOBILE_MAX_WIDTH,
  TABLET_MAX_WIDTH,
  type Breakpoint,
} from "@/hooks/useBreakpoint";

/**
 * Widths that land squarely inside each responsive band, derived from the
 * bands the application itself uses so the two cannot drift apart.
 */
export const MOBILE_VIEWPORT_WIDTH = MOBILE_MAX_WIDTH;
export const TABLET_VIEWPORT_WIDTH = TABLET_MAX_WIDTH;
export const DESKTOP_VIEWPORT_WIDTH = TABLET_MAX_WIDTH + 1;

/** jsdom's own default width, and what {@link resetViewport} restores. */
export const DEFAULT_VIEWPORT_WIDTH = DESKTOP_VIEWPORT_WIDTH;

const VIEWPORT_WIDTHS: Record<Breakpoint, number> = {
  mobile: MOBILE_VIEWPORT_WIDTH,
  tablet: TABLET_VIEWPORT_WIDTH,
  desktop: DESKTOP_VIEWPORT_WIDTH,
};

const noop = (): void => {};

function widthsIn(query: string, kind: "min" | "max"): number[] {
  const pattern = new RegExp(`${kind}-width:\\s*(\\d+(?:\\.\\d+)?)px`, "g");
  const found: number[] = [];
  let match = pattern.exec(query);
  while (match !== null) {
    const raw = match[1];
    if (raw !== undefined) {
      found.push(Number.parseFloat(raw));
    }
    match = pattern.exec(query);
  }
  return found;
}

/**
 * Answers a width-based media query against a fixed viewport width. Queries
 * that mention neither bound are reported as not matching, which is the same
 * answer a missing `matchMedia` would produce.
 */
function matchesMediaQuery(query: string, width: number): boolean {
  const mins = widthsIn(query, "min");
  const maxes = widthsIn(query, "max");
  if (mins.length === 0 && maxes.length === 0) {
    return false;
  }
  for (const min of mins) {
    if (width < min) {
      return false;
    }
  }
  for (const max of maxes) {
    if (width > max) {
      return false;
    }
  }
  return true;
}

function createMediaQueryList(query: string, width: number): MediaQueryList {
  return {
    media: query,
    matches: matchesMediaQuery(query, width),
    onchange: null,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
  };
}

function definePixelWidth(target: object, property: string, width: number) {
  Object.defineProperty(target, property, {
    configurable: true,
    writable: true,
    value: width,
  });
}

/**
 * Pins the jsdom viewport to `width` and notifies anything listening for a
 * resize, so a component that picks an image by viewport width can be tested
 * in every band. Also installs a `window.matchMedia` that answers width
 * queries consistently with the width just set, because jsdom ships none.
 */
export function setViewportWidth(width: number): void {
  definePixelWidth(window, "innerWidth", width);
  definePixelWidth(window, "outerWidth", width);
  definePixelWidth(document.documentElement, "clientWidth", width);
  window.matchMedia = (query: string) => createMediaQueryList(query, width);
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

/** Pins the viewport to a width inside the given responsive band. */
export function setViewportBreakpoint(breakpoint: Breakpoint): void {
  setViewportWidth(VIEWPORT_WIDTHS[breakpoint]);
}

/** Puts the viewport back to the width a fresh jsdom document reports. */
export function resetViewport(): void {
  setViewportWidth(DEFAULT_VIEWPORT_WIDTH);
}

export interface RenderWithProvidersOptions {
  /**
   * One fixture per operation the subject issues, including the ones its
   * children issue. An operation with no fixture resolves as a failure.
   */
  mocks?: readonly MockedResponse[];
  /** Left off by default, matching fixtures written without `__typename`. */
  addTypename?: boolean;
  /** Pins the viewport before the first render when supplied. */
  viewportWidth?: number;
  /** Overrides the theme the subject reads. */
  theme?: ReturnType<typeof createTheme>;
}

const defaultTheme = createTheme();

/**
 * Renders a subject with the providers the entry point would otherwise mount:
 * a GraphQL client mocked above the network, so no request ever leaves the
 * process, and a MUI theme. Nothing here reaches the real transport.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const {
    mocks = [],
    addTypename = false,
    viewportWidth,
    theme = defaultTheme,
  } = options;

  if (viewportWidth !== undefined) {
    setViewportWidth(viewportWidth);
  }

  return render(
    <MockedProvider mocks={[...mocks]} addTypename={addTypename}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MockedProvider>,
  );
}
