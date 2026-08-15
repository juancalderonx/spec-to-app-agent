import type { AgentState } from "../graph/state.ts";
import {
  AMBER,
  BLUE,
  BOLD,
  FAINT,
  GREEN,
  GREY,
  RED,
  RESET,
  VIOLET,
  cap,
  duration,
  pad,
  paint,
  truncate,
  width,
  wrap,
} from "./ansi.ts";

/** How wide the left column is allowed to get, and the width below which the panes stack. */
const LEFT_WIDTH = 38;
const NARROW = 76;

/** The frames of the mark that turns beside the task in flight. */
const FRAMES = ["/", "-", "\\", "|"] as const;

export type StepStatus = "done" | "failed" | "running" | "pending";

export interface Step {
  id: string;
  status: StepStatus;
  /** Absent until the task has been started. */
  elapsedMs: number | undefined;
  costUsd: number;
}

export interface LogLine {
  /** `06:22:08`, stamped when the line was first seen rather than when it was written. */
  time: string;
  node: string;
  text: string;
}

/** When a task was first seen in flight and when it settled. Milliseconds since the epoch. */
export interface Timing {
  startedAt: number;
  endedAt: number | undefined;
}

export type Timings = Readonly<Record<string, Timing>>;

/**
 * Advances the per-task clocks by one observation.
 *
 * Pure, and derived from what the state already says: a task is running when it
 * is the one in flight and it is over when `status` names it. The alternative —
 * having the nodes write timestamps into the shared state — would put a display
 * concern inside the graph.
 */
export function trackTimings(
  previous: Timings,
  state: AgentState,
  inFlight: readonly string[],
  now: number,
): Timings {
  const next: Record<string, Timing> = { ...previous };
  for (const id of inFlight) {
    next[id] ??= { startedAt: now, endedAt: undefined };
  }
  for (const [id, timing] of Object.entries(next)) {
    const settled = state.status[id] === "done" || state.status[id] === "failed";
    if (settled && timing.endedAt === undefined) {
      next[id] = { ...timing, endedAt: now };
    }
  }
  return next;
}

export interface RunFacts {
  runId: string;
  provider: string;
  model: string;
  cache: string;
  startedAt: Date;
}

export interface View {
  facts: RunFacts;
  /** `running` until the graph is done or the reader stopped it. */
  status: "running" | "finished" | "stopped";
  steps: readonly Step[];
  logs: readonly LogLine[];
  elapsedMs: number;
  costUsd: number;
  /** Lines scrolled back from the newest. Zero follows the tail. */
  scrollback: number;
  frame: number;
}

/** One step per planned task, in execution order, with what it spent and how long it took. */
export function readSteps(state: AgentState, inFlight: readonly string[], timings: Timings, now: number): Step[] {
  const running = new Set(inFlight);
  return state.orderedTaskIds.map((id) => {
    const status: StepStatus =
      state.status[id] === "done"
        ? "done"
        : state.status[id] === "failed"
          ? "failed"
          : running.has(id)
            ? "running"
            : "pending";
    const timing = timings[id];
    return {
      id,
      status,
      elapsedMs: timing === undefined ? undefined : (timing.endedAt ?? now) - timing.startedAt,
      costUsd: state.usage
        .filter((entry) => entry.task === id)
        .reduce((total, entry) => total + entry.costUsd, 0),
    };
  });
}

export function finishedCount(steps: readonly Step[]): number {
  return steps.filter((step) => step.status === "done" || step.status === "failed").length;
}

/**
 * What is left, at the pace the run has kept so far.
 *
 * A straight-line extrapolation, and it is labelled as an estimate wherever it
 * is printed: tasks are not the same size, and a test task that runs the whole
 * suite is not a component. `undefined` until at least one task has finished,
 * because before that there is no pace to extrapolate from.
 */
export function estimateRemaining(steps: readonly Step[], elapsedMs: number): number | undefined {
  const finished = finishedCount(steps);
  if (finished === 0 || steps.length === 0) {
    return undefined;
  }
  return Math.max((elapsedMs / finished) * (steps.length - finished), 0);
}

function bar(fraction: number, columns: number, colour: boolean): string {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * columns);
  return (
    paint("█".repeat(filled), GREEN, colour) + paint("░".repeat(Math.max(columns - filled, 0)), FAINT, colour)
  );
}

const MARK: Record<StepStatus, string> = {
  done: "✓",
  failed: "✗",
  running: "●",
  pending: "○",
};

const MARK_COLOUR: Record<StepStatus, string> = {
  done: GREEN,
  failed: RED,
  running: VIOLET,
  pending: FAINT,
};

/** A framed pane: a title in the top border, content clipped to the box. */
function pane(title: string, lines: readonly string[], columns: number, rows: number, colour: boolean): string[] {
  const inner = Math.max(columns - 2, 1);
  const heading = truncate(` ${title} `, inner);
  const top = `╭${heading}${"─".repeat(Math.max(inner - width(heading), 0))}╮`;
  const body = Array.from({ length: Math.max(rows - 2, 0) }, (_, index) => {
    const line = lines[index] ?? "";
    return `│${pad(line, inner)}│`;
  });
  return [
    colour ? `${GREY}${top.slice(0, 1)}${RESET}${BOLD}${heading}${RESET}${GREY}${top.slice(1 + heading.length)}${RESET}` : top,
    ...body,
    `╰${"─".repeat(inner)}╯`,
  ];
}

/** `Label  value`, with the label in one column so the pane reads as a table. */
function field(label: string, value: string, columns: number, colour: boolean, tint: string = ""): string {
  const key = pad(label, 12);
  const room = Math.max(columns - width(key) - 1, 1);
  const text = truncate(value, room);
  return ` ${paint(key, GREY, colour)}${tint === "" ? text : paint(text, tint, colour)}`;
}

/**
 * The facts pane. `compact` drops what a reader can find elsewhere — the
 * provider, the model, the clock the run started at — and keeps what only this
 * screen has: where the run is, how long it has taken and what it has spent.
 * That is what a short terminal gives up so the log still has room to be a log.
 */
function overviewLines(view: View, columns: number, colour: boolean, compact: boolean): string[] {
  const inner = columns - 2;
  const finished = finishedCount(view.steps);
  const planned = view.steps.length;
  const remaining = estimateRemaining(view.steps, view.elapsedMs);
  const percent = planned === 0 ? 0 : Math.round((finished / planned) * 100);
  const statusTint = view.status === "running" ? GREEN : view.status === "stopped" ? AMBER : VIOLET;
  const statusText =
    view.status === "running" ? "● Running" : view.status === "stopped" ? "■ Stopped" : "✓ Finished";

  const detail = compact
    ? []
    : [
        field("Provider", view.facts.provider, inner, colour),
        field("Model", view.facts.model, inner, colour),
        field("Cache", view.facts.cache, inner, colour, view.facts.cache === "on" ? GREEN : GREY),
        field("Started", view.facts.startedAt.toLocaleTimeString(), inner, colour),
      ];

  return [
    ...(compact ? [] : [""]),
    field("Run", view.facts.runId, inner, colour),
    ...detail,
    field("Status", statusText, inner, colour, statusTint),
    ...(compact ? [] : [""]),
    field("Progress", planned === 0 ? "—" : `${finished} / ${planned} (${percent}%)`, inner, colour),
    ` ${bar(planned === 0 ? 0 : finished / planned, Math.max(inner - 2, 1), colour)}`,
    ...(compact ? [] : [""]),
    field("Elapsed", duration(view.elapsedMs), inner, colour),
    field("Remaining", remaining === undefined ? "estimating…" : `~ ${duration(remaining)}`, inner, colour, GREY),
    field("Cost", `$${view.costUsd.toFixed(4)}`, inner, colour, AMBER),
  ];
}

function stepLines(view: View, columns: number, rows: number, colour: boolean): string[] {
  const inner = columns - 2;
  // The window follows the task in flight, so a plan longer than the pane keeps
  // showing the part of itself that is moving.
  const running = view.steps.findIndex((step) => step.status === "running");
  const anchor = running === -1 ? finishedCount(view.steps) : running;
  const start = Math.max(Math.min(anchor - 2, view.steps.length - rows), 0);
  const window = view.steps.slice(start, start + rows);

  const lines = window.map((step) => {
    const cost = step.costUsd === 0 ? "—" : `$${step.costUsd.toFixed(4)}`;
    const time = step.elapsedMs === undefined ? "" : duration(step.elapsedMs);
    const right = `${pad(time, 7)}${pad(cost, 8)}`;
    const id = truncate(step.id, Math.max(inner - width(right) - 4, 1));
    const body = ` ${MARK[step.status]} ${pad(id, Math.max(inner - width(right) - 4, 1))} ${right}`;
    if (!colour) {
      return body.trimEnd();
    }
    const tint = step.status === "running" ? VIOLET : step.status === "pending" ? FAINT : GREY;
    return ` ${paint(MARK[step.status], MARK_COLOUR[step.status], colour)}${paint(body.slice(3), tint, colour)}`;
  });
  const hidden = view.steps.length - window.length;
  if (hidden > 0) {
    // The last visible row is given up to the count, so the pane never claims
    // to be showing a plan it has cut off.
    lines.splice(-1, 1, paint(` … ${hidden + 1} more`, FAINT, colour));
  }
  return lines;
}

const NODE_TINT: Record<string, string> = {
  prepare: BLUE,
  plan: VIOLET,
  order: VIOLET,
  generate: GREEN,
  validate: AMBER,
  repair: RED,
  review: BLUE,
  report: BLUE,
};

/** Every log line wrapped to the pane, newest last, with the gutter carrying the time. */
export function layoutLogs(logs: readonly LogLine[], columns: number, colour: boolean): string[] {
  const gutter = 9;
  const room = Math.max(columns - gutter - 2, 8);
  return logs.flatMap((line) => {
    const tint = NODE_TINT[line.node] ?? GREY;
    const head = line.node === "" ? "" : `[${line.node}] `;
    const wrapped = wrap(`${head}${line.text}`, room, 2);
    return wrapped.map((text, index) => {
      const stamp = index === 0 ? line.time : " ".repeat(line.time.length);
      if (!colour) {
        return ` ${stamp} ${text}`;
      }
      const painted =
        index === 0 && head !== ""
          ? `${paint(head.trimEnd(), tint, true)} ${text.slice(head.length)}`
          : text;
      return ` ${paint(stamp, FAINT, true)} ${painted}`;
    });
  });
}

function statusBar(view: View, columns: number, colour: boolean): string {
  const finished = finishedCount(view.steps);
  const planned = view.steps.length;
  const running = view.steps.find((step) => step.status === "running");
  const spin = view.status === "running" ? FRAMES[view.frame % FRAMES.length] : "·";
  const left = ` ${spin} ${finished}/${planned}${running === undefined ? "" : ` · ${running.id}`}`;
  const right = `${duration(view.elapsedMs)} · $${view.costUsd.toFixed(4)} · ${
    view.scrollback > 0 ? "↑ scrolled" : "following"
  } · ${cap("q", colour)} stop `;
  const gap = Math.max(columns - width(left) - width(right), 1);
  return `${paint(left, VIOLET, colour)}${" ".repeat(gap)}${paint(right, GREY, colour)}`;
}

export interface Size {
  columns: number;
  rows: number;
}

/**
 * The whole screen, as one string, from a view and a terminal size.
 *
 * Pure: every frame the reader sees is this function's return value, so the
 * layout can be asserted at any size without a terminal — including the sizes
 * that break it, which is where a hand-drawn box goes wrong.
 */
export function renderDashboard(view: View, size: Size, colour: boolean): string {
  const rows = Math.max(size.rows, 12);
  const columns = Math.max(size.columns, 40);
  const left = columns < NARROW ? columns : Math.min(LEFT_WIDTH, Math.floor(columns * 0.4));
  const stacked = columns < NARROW;
  const right = stacked ? columns : columns - left;
  const height = rows - 1;

  // A short screen gets the compact facts pane, so the log keeps more than a
  // line or two of what it is there to show.
  const compact = stacked && height < 30;
  const overviewRows = stacked ? (compact ? 9 : 17) : Math.min(17, height);
  const stepsRows = stacked ? 0 : Math.max(height - overviewRows, 0);
  const overview = pane(
    "EXECUTION OVERVIEW",
    overviewLines(view, left, colour, compact),
    left,
    overviewRows,
    colour,
  );
  const steps =
    stepsRows === 0
      ? []
      : pane(
          `STEPS (${finishedCount(view.steps)}/${view.steps.length})`,
          stepLines(view, left, Math.max(stepsRows - 2, 0), colour),
          left,
          stepsRows,
          colour,
        );

  const logRows = stacked ? Math.max(height - overviewRows, 3) : height;
  const laid = layoutLogs(view.logs, right, colour);
  const visible = Math.max(logRows - 2, 1);
  const end = Math.max(laid.length - view.scrollback, visible);
  const logs = pane("LOGS", laid.slice(Math.max(end - visible, 0), end), right, logRows, colour);

  const lines: string[] = [];
  if (stacked) {
    lines.push(...overview, ...logs);
  } else {
    const column = [...overview, ...steps];
    for (let index = 0; index < height; index += 1) {
      lines.push(`${column[index] ?? " ".repeat(left)}${logs[index] ?? ""}`);
    }
  }
  lines.push(statusBar(view, columns, colour));
  return lines.slice(0, rows).join("\n");
}
