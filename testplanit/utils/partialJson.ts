/**
 * Reading fields out of a JSON object that is still streaming.
 *
 * The generation wizard renders a test case before its JSON closes, so it
 * needs the keys that *have* finished without waiting for the object. Scanning
 * at the top level only matters: a regex sweep also matches the keys nested
 * inside the Steps array, which then overwrite each other and collapse a
 * multi-step case into one.
 */

export interface CompleteJsonFields {
  /** Top-level keys whose value finished arriving, JSON-parsed. */
  complete: Record<string, any>;
  /** The key whose value was still arriving, if any. */
  partialKey?: string;
  /** That value's text so far — feed it back in to read *its* finished keys. */
  partialValue?: string;
}

/** End index of the string starting at `start` (its opening quote), or -1. */
function findStringEnd(source: string, start: number): number {
  let escaped = false;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') return i;
  }
  return -1;
}

/** End index of the {...} or [...] starting at `start`, or -1 if unclosed. */
function findContainerEnd(source: string, start: number): number {
  const open = source[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** End index of the value starting at `start`, or -1 while it is incomplete. */
function findValueEnd(source: string, start: number): number {
  const ch = source[start];
  if (ch === '"') return findStringEnd(source, start);
  if (ch === "{" || ch === "[") return findContainerEnd(source, start);

  // Number, true/false, null: complete once a delimiter follows it. Without
  // one the token may still be growing (`12` on its way to `123`).
  for (let i = start; i < source.length; i++) {
    if (/[,}\]\s]/.test(source[i])) return i - 1;
  }
  return -1;
}

/**
 * The finished top-level fields of a (possibly unterminated) JSON object.
 * `source` may carry leading text; scanning starts at its first `{`.
 */
export function extractCompleteJsonFields(source: string): CompleteJsonFields {
  const result: CompleteJsonFields = { complete: {} };

  const objectStart = source.indexOf("{");
  if (objectStart === -1) return result;

  let i = objectStart + 1;
  while (i < source.length) {
    while (i < source.length && /[\s,]/.test(source[i])) i++;
    if (i >= source.length || source[i] === "}") break;
    if (source[i] !== '"') break; // not a key — nothing more to read

    const keyEnd = findStringEnd(source, i);
    if (keyEnd === -1) break; // key still arriving

    let key: string;
    try {
      key = JSON.parse(source.slice(i, keyEnd + 1));
    } catch {
      break;
    }

    i = keyEnd + 1;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== ":") break;
    i++;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) break;

    const valueEnd = findValueEnd(source, i);
    if (valueEnd === -1) {
      result.partialKey = key;
      result.partialValue = source.slice(i);
      break;
    }

    try {
      result.complete[key] = JSON.parse(source.slice(i, valueEnd + 1));
    } catch {
      // Malformed value — skip the key rather than the whole object.
    }
    i = valueEnd + 1;
  }

  return result;
}
