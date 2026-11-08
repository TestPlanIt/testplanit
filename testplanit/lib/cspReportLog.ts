/**
 * Log line per distinct Content-Security-Policy violation.
 *
 * Browsers report the same violation on every page load, so a single blocked
 * resource would otherwise flood the log. Each distinct violation (directive,
 * blocked URL, source location) is logged when first seen and then at most
 * once per window, with how many times it was reported in between.
 */

export interface CspViolation {
  documentUri?: string;
  violatedDirective?: string;
  blockedUri?: string;
  sourceFile?: string;
  line?: number;
  column?: number;
  sample?: string;
  disposition?: string;
}

interface Seen {
  lastLoggedAt: number;
  sinceLastLog: number;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED = 1000;

const seen = new Map<string, Seen>();

function keyOf(v: CspViolation): string {
  return [
    v.violatedDirective,
    v.blockedUri,
    v.sourceFile,
    v.line,
    v.column,
    v.sample,
  ].join("|");
}

export function recordCspViolation(
  violation: CspViolation,
  now: number = Date.now(),
  log: (message: string, detail: string) => void = (m, d) => console.warn(m, d)
): void {
  const key = keyOf(violation);
  const entry = seen.get(key);

  if (entry && now - entry.lastLoggedAt < WINDOW_MS) {
    entry.sinceLastLog += 1;
    return;
  }

  if (!entry && seen.size >= MAX_TRACKED) {
    // Oldest entry first: Map iteration follows insertion order.
    const oldest = seen.keys().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }

  const repeats = entry?.sinceLastLog ?? 0;
  seen.set(key, { lastLoggedAt: now, sinceLastLog: 0 });
  log(
    "[csp] violation",
    JSON.stringify(
      repeats > 0 ? { ...violation, repeatsSinceLastLog: repeats } : violation
    )
  );
}

/** Forget every violation seen so far. For tests. */
export function resetCspViolationLog(): void {
  seen.clear();
}
