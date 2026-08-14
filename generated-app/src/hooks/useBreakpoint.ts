import { useEffect, useState } from "react";

/** The viewport bands the inventory serves images for. */
export type Breakpoint = "mobile" | "tablet" | "desktop";

/** Widest viewport still considered a phone. */
export const MOBILE_MAX_WIDTH = 640;

/** Widest viewport still considered a tablet. */
export const TABLET_MAX_WIDTH = 1023;

/**
 * Maps a pixel width onto a band: `<= 640` is mobile, `641`–`1023` is tablet,
 * `>= 1024` is desktop.
 */
export function breakpointForWidth(width: number): Breakpoint {
  if (width <= MOBILE_MAX_WIDTH) {
    return "mobile";
  }
  if (width <= TABLET_MAX_WIDTH) {
    return "tablet";
  }
  return "desktop";
}

export interface UseBreakpointResult {
  /** The band the current viewport falls into. */
  breakpoint: Breakpoint;
  /** The width the band was derived from, in CSS pixels. */
  width: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

/**
 * Reports the current viewport band, re-evaluating on resize.
 *
 * Reads `window.innerWidth` rather than a media query, so it behaves the same
 * under jsdom as it does in a browser.
 */
export function useBreakpoint(): UseBreakpointResult {
  const [width, setWidth] = useState<number>(() => window.innerWidth);

  useEffect(() => {
    const handleResize = (): void => {
      setWidth(window.innerWidth);
    };

    // The viewport may have changed between the first render and this effect.
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const breakpoint = breakpointForWidth(width);

  return {
    breakpoint,
    width,
    isMobile: breakpoint === "mobile",
    isTablet: breakpoint === "tablet",
    isDesktop: breakpoint === "desktop",
  };
}
