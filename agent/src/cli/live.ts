import type { AgentState, LogEntry } from "../graph/state.ts";
import { totalUsage } from "../llm/ledger.ts";
import { ALT_SCREEN_OFF, ALT_SCREEN_ON, CLEAR_BELOW, CURSOR_HIDE, CURSOR_SHOW, HOME } from "./ansi.ts";
import {
  readSteps,
  renderDashboard,
  trackTimings,
  type LogLine,
  type Step,
  type RunFacts,
  type Timings,
  type View,
} from "./dashboard.ts";
import type { KeyInput } from "./menu.ts";

/** How often the screen is redrawn while nothing happens: the clock and the mark. */
const FRAME_MS = 120;

export type Command = "stop" | "up" | "down" | "page-up" | "page-down" | "follow";

/** The keys the live screen answers to. Anything else is ignored rather than guessed at. */
export function decodeCommand(chunk: string): Command | null {
  switch (chunk) {
    case "q":
    case "\u0003":
      return "stop";
    case "\u001b[A":
    case "k":
      return "up";
    case "\u001b[B":
    case "j":
      return "down";
    case "\u001b[5~":
      return "page-up";
    case "\u001b[6~":
      return "page-down";
    case "\u001b[F":
    case "g":
      return "follow";
    default:
      return null;
  }
}

/**
 * Where the log window sits after a scroll command.
 *
 * Counted back from the newest line so that a run still writing lines does not
 * drag the window: at zero the pane follows the tail, and above zero it stays
 * where the reader put it.
 */
export function scrollBy(scrollback: number, command: Command, page: number, total: number): number {
  const ceiling = Math.max(total - page, 0);
  switch (command) {
    case "up":
      return Math.min(scrollback + 1, ceiling);
    case "down":
      return Math.max(scrollback - 1, 0);
    case "page-up":
      return Math.min(scrollback + page, ceiling);
    case "page-down":
      return Math.max(scrollback - page, 0);
    case "follow":
      return 0;
    case "stop":
      return scrollback;
  }
}

export interface ScreenOutput {
  write(text: string): void;
  columns?: number | undefined;
  rows?: number | undefined;
  isTTY?: boolean | undefined;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

export interface Live {
  /** Absorbs one superstep: its new log lines and what the state now says. */
  update(state: AgentState, entries: readonly LogEntry[], inFlight: readonly string[]): void;
  /** Restores the terminal and leaves the run's log behind, in order, as plain text. */
  finish(status: "finished" | "stopped"): readonly string[];
}

export interface LiveOptions {
  facts: RunFacts;
  input: KeyInput;
  output: ScreenOutput;
  /** Called when the reader asks to stop. The caller owns what stopping means. */
  onStop: () => void;
}

function stamp(at: Date): string {
  return at.toTimeString().slice(0, 8);
}

/**
 * The run's live screen: two panes on the alternate buffer, redrawn on a timer.
 *
 * The alternate buffer is what makes a full-screen view acceptable here. The
 * shell's scrollback is left exactly as it was, and on the way out the whole
 * log is handed back to the caller as plain lines to print on the normal
 * screen — so the run's evidence survives the pretty view rather than being
 * replaced by it.
 */
export function createLive(options: LiveOptions): Live {
  const startedAt = Date.now();
  const logs: LogLine[] = [];
  let steps: readonly Step[] = [];
  let timings: Timings = {};
  let costUsd = 0;
  let scrollback = 0;
  let frame = 0;
  let status: View["status"] = "running";

  const size = (): { columns: number; rows: number } => ({
    columns: options.output.columns ?? 80,
    rows: options.output.rows ?? 24,
  });

  const draw = (): void => {
    const { columns, rows } = size();
    const view: View = {
      facts: options.facts,
      status,
      steps,
      logs,
      elapsedMs: Date.now() - startedAt,
      costUsd,
      scrollback,
      frame,
    };
    frame += 1;
    options.output.write(`${HOME}${renderDashboard(view, { columns, rows }, true)}${CLEAR_BELOW}`);
  };

  const onKey = (chunk: string): void => {
    const command = decodeCommand(chunk);
    if (command === null) {
      return;
    }
    if (command === "stop") {
      status = "stopped";
      options.onStop();
      return;
    }
    scrollback = scrollBy(scrollback, command, Math.max(size().rows - 4, 1), logs.length);
    draw();
  };

  const onResize = (): void => draw();

  options.output.write(`${ALT_SCREEN_ON}${CURSOR_HIDE}`);
  options.input.setRawMode(true);
  options.input.resume();
  options.input.setEncoding("utf8");
  options.input.on("data", onKey);
  options.output.on("resize", onResize);
  const timer = setInterval(draw, FRAME_MS);
  timer.unref();
  draw();

  return {
    update(state, entries, inFlight): void {
      const now = Date.now();
      for (const entry of entries) {
        logs.push({ time: stamp(new Date(now)), node: entry.node, text: `${entry.event}: ${entry.detail}` });
      }
      timings = trackTimings(timings, state, inFlight, now);
      steps = readSteps(state, inFlight, timings, now);
      costUsd = totalUsage(state.usage).costUsd;
      draw();
    },
    finish(final): readonly string[] {
      status = status === "stopped" ? "stopped" : final;
      clearInterval(timer);
      options.input.off("data", onKey);
      options.output.off("resize", onResize);
      options.input.setRawMode(false);
      options.input.pause();
      options.output.write(`${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
      return logs.map((line) => `[${line.node}] ${line.text}`);
    },
  };
}
