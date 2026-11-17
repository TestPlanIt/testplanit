import { createHash } from "node:crypto";

/**
 * Deterministic fingerprinting of automated test failures.
 *
 * Two failures share a fingerprint when they have the same exception type,
 * the same message once volatile values (numbers, ids, paths, timestamps)
 * are masked, and the same top application stack frames. The fingerprint is
 * what groups JUnitTestResult rows into a FailureSignature.
 */

export type FailureFingerprintKind = "stack" | "message" | "none";

export interface FailureFingerprintInput {
  /** `JUnitTestResult.message` */
  message?: string | null;
  /** `JUnitTestResult.content` — usually the stack trace / failure body */
  content?: string | null;
  /** `JUnitTestResult.systemErr` — last-resort source of a failure line */
  systemErr?: string | null;
  /** Used only when the result carries no diagnostic text at all */
  repositoryCaseId: number;
}

export interface FailureFingerprint {
  /** Stable hex digest (sha256) used as the cluster key */
  fingerprint: string;
  kind: FailureFingerprintKind;
  /** Short exception/assertion type, e.g. `TimeoutError`, `AssertionFailedError` */
  exceptionType: string | null;
  /** First message line with volatile values masked; empty for `kind: "none"` */
  normalizedMessage: string;
  /** Up to MAX_FRAMES normalized application frames (no line/column numbers) */
  frames: string[];
  /** Human-readable cluster title, bounded to TITLE_MAX_LENGTH */
  title: string;
}

const MAX_FRAMES = 3;
const MAX_SCANNED_LINES = 400;
const MESSAGE_MAX_LENGTH = 500;
export const TITLE_MAX_LENGTH = 200;

const TYPE_SUFFIX =
  "(?:Exception|Error|Failure|Failed|Throwable|Timeout|Warning|Exit|Assertion|Panic)";

// `org.opentest4j.AssertionFailedError: expected <1> but was <2>` / `java.lang.NullPointerException`
const QUALIFIED_TYPE_LINE = new RegExp(
  `^(?:[\\w$]+\\.)+([\\w$]*${TYPE_SUFFIX}[\\w$]*)\\s*(?::\\s*(.*))?$`
);
// `Error: boom` / `AssertionError: expected 200 to equal 500` / `TimeoutError: locator.click: Timeout 30000ms exceeded.`
const SIMPLE_TYPE_LINE = new RegExp(
  `^((?:[A-Z][\\w$]*?)?${TYPE_SUFFIX}[\\w$]*)\\s*:\\s*(.*)$`
);
// Bare type with no message: `AssertionError` / `java.lang.NullPointerException`
const BARE_TYPE_LINE = new RegExp(
  `^(?:[\\w$]+\\.)*((?:[A-Z][\\w$]*?)?${TYPE_SUFFIX}[\\w$]*)\\s*$`
);

// JS / TS: `at async Context.<anonymous> (/path/file.ts:83:4)` / `at /path/file.spec.ts:12:5` / `at fn (file:///...)`
const JS_FRAME =
  /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?((?:file:\/\/)?[^()]+?):(\d+)(?::(\d+))?\)?\s*$/;
// Java / Kotlin / Scala: `at com.acme.FooTest.bar(FooTest.java:42)`
const JVM_FRAME = /^\s*at\s+([\w$.<>/]+)\(([^:)]+)(?::(\d+))?\)\s*$/;
// Python: `File "/path/test_x.py", line 12, in test_foo`
const PY_FRAME = /^\s*File\s+"([^"]+)",\s+line\s+\d+,\s+in\s+(\S+)/;
// .NET: `at Acme.Tests.FooTests.Bar() in C:\src\FooTests.cs:line 42`
const DOTNET_FRAME =
  /^\s*at\s+([\w.`<>\[\],+]+\(.*?\))(?:\s+in\s+(.+?):line\s+\d+)?\s*$/;
// Go: `/home/ci/src/foo_test.go:42 +0x1a` preceded by `pkg.TestFoo(...)`
const GO_FRAME =
  /^\s*((?:[\w./-]+\/)?[\w.-]+\.go):\d+(?:\s+\+0x[0-9a-f]+)?\s*$/;

const FRAMEWORK_FRAME_PATTERNS: RegExp[] = [
  /node_modules\//,
  /^node:/,
  /^internal\//,
  /^<anonymous>$/,
  /^(?:java|jdk|sun|javax|kotlin|scala)\./,
  /^org\.(?:junit|testng|opentest4j|gradle|apache\.maven|mockito|hamcrest|assertj|spockframework)/,
  /^(?:System|NUnit|Xunit|Microsoft|Moq|FluentAssertions)\./,
  /(?:site|dist)-packages\//,
  /\/_pytest\//,
  /\/unittest\//,
  /\/pluggy\//,
  /^(?:testing|runtime)\./,
];

const PATH_SEGMENTS_TO_KEEP = 3;

export function fingerprintFailure(
  input: FailureFingerprintInput
): FailureFingerprint {
  const content = clean(input.content);
  const message = clean(input.message);
  const systemErr = clean(input.systemErr);

  const body = content || message || systemErr;
  if (!body) {
    return noDetailsFingerprint(input.repositoryCaseId);
  }

  const lines = body.split("\n").slice(0, MAX_SCANNED_LINES);
  const typed = findTypeLine(lines);

  // Prefer the structured message field for the message text when the
  // body did not yield one (e.g. Jest `expect(received)...` bodies have no
  // `Type:` prefix but the reporter still filled `message`).
  const rawMessage =
    typed?.message ??
    firstNonEmpty(message ? message.split("\n") : lines) ??
    "";
  const normalizedMessage = normalizeMessage(rawMessage);
  const exceptionType = typed?.type ?? null;
  const frames = extractFrames(lines);

  const kind: FailureFingerprintKind = frames.length > 0 ? "stack" : "message";
  const fingerprint = digest([
    exceptionType ?? "",
    normalizedMessage,
    ...frames,
  ]);

  return {
    fingerprint,
    kind,
    exceptionType,
    normalizedMessage,
    frames,
    title: buildTitle(exceptionType, normalizedMessage),
  };
}

function noDetailsFingerprint(repositoryCaseId: number): FailureFingerprint {
  return {
    fingerprint: digest(["case", String(repositoryCaseId)]),
    kind: "none",
    exceptionType: null,
    normalizedMessage: "",
    frames: [],
    title: "",
  };
}

function clean(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
}

function firstNonEmpty(lines: string[]): string | undefined {
  return lines.map((l) => l.trim()).find((l) => l.length > 0);
}

interface TypeLine {
  type: string;
  message: string;
}

function parseTypeLine(line: string): TypeLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const qualified = QUALIFIED_TYPE_LINE.exec(trimmed);
  if (qualified)
    return { type: qualified[1], message: (qualified[2] ?? "").trim() };
  const simple = SIMPLE_TYPE_LINE.exec(trimmed);
  if (simple) return { type: simple[1], message: simple[2].trim() };
  const bare = BARE_TYPE_LINE.exec(trimmed);
  if (bare) return { type: bare[1], message: "" };
  return null;
}

/**
 * Finds the line that names the exception. JS/JVM/.NET put it first; Python
 * tracebacks put it last, so for a `Traceback` body the last match wins.
 */
function findTypeLine(lines: string[]): TypeLine | null {
  const candidates: TypeLine[] = [];
  for (const line of lines) {
    if (isFrameLine(line)) continue;
    const parsed = parseTypeLine(line);
    if (parsed) candidates.push(parsed);
  }
  if (candidates.length === 0) return null;
  const isPythonTraceback = /^\s*Traceback \(most recent call last\)/.test(
    lines[0] ?? ""
  );
  return isPythonTraceback ? candidates[candidates.length - 1] : candidates[0];
}

function isFrameLine(line: string): boolean {
  return (
    JS_FRAME.test(line) ||
    JVM_FRAME.test(line) ||
    PY_FRAME.test(line) ||
    DOTNET_FRAME.test(line) ||
    GO_FRAME.test(line)
  );
}

/**
 * Masks values that change between otherwise identical failures so that the
 * same assertion produces the same text run after run.
 */
export function normalizeMessage(message: string): string {
  let text = message.trim();
  if (!text) return "";
  text = text
    .replace(/https?:\/\/[^\s"'`)<>]+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<uuid>"
    )
    .replace(
      /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g,
      "<ts>"
    )
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@+-]+){2,}[\\/]?/g, "<path>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/\d+(?:\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MESSAGE_MAX_LENGTH)
    text = text.slice(0, MESSAGE_MAX_LENGTH);
  return text;
}

function extractFrames(lines: string[]): string[] {
  const all: ParsedFrame[] = [];
  for (const line of lines) {
    const frame = parseFrame(line);
    if (frame) all.push(frame);
  }
  if (all.length === 0) return [];
  const app = all.filter(
    (f) => !FRAMEWORK_FRAME_PATTERNS.some((p) => p.test(f.scope))
  );
  return (app.length > 0 ? app : all)
    .slice(0, MAX_FRAMES)
    .map((f) => f.display);
}

interface ParsedFrame {
  /** Raw file path or qualified class/method, used to recognize framework frames */
  scope: string;
  /** Normalized, machine-independent rendering used in the fingerprint */
  display: string;
}

function parseFrame(line: string): ParsedFrame | null {
  const js = JS_FRAME.exec(line);
  if (js) {
    const fn = js[1]?.trim();
    const file = shortenPath(js[2]);
    return { scope: js[2], display: fn ? `${fn} (${file})` : file };
  }
  const py = PY_FRAME.exec(line);
  if (py) return { scope: py[1], display: `${py[2]} (${shortenPath(py[1])})` };
  const jvm = JVM_FRAME.exec(line);
  if (jvm) return { scope: jvm[1], display: `${jvm[1]}(${jvm[2]})` };
  const dotnet = DOTNET_FRAME.exec(line);
  if (dotnet) {
    const file = dotnet[2] ? ` (${shortenPath(dotnet[2])})` : "";
    return { scope: dotnet[1], display: `${dotnet[1]}${file}` };
  }
  const go = GO_FRAME.exec(line);
  if (go) return { scope: go[1], display: shortenPath(go[1]) };
  return null;
}

/** Keeps only the trailing path segments so CI and laptop paths agree. */
export function shortenPath(path: string): string {
  const stripped = path.replace(/^file:\/\//, "").replace(/\?.*$/, "");
  const segments = stripped.split(/[\\/]+/).filter(Boolean);
  return segments.slice(-PATH_SEGMENTS_TO_KEEP).join("/");
}

function buildTitle(
  exceptionType: string | null,
  normalizedMessage: string
): string {
  const parts = [exceptionType, normalizedMessage].filter(
    (p): p is string => !!p
  );
  const title = parts.join(": ");
  return title.length > TITLE_MAX_LENGTH
    ? `${title.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : title;
}

function digest(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}
