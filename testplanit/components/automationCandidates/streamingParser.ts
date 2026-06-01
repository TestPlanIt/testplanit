/**
 * Progressive parser for the streaming LLM output of the Automation
 * Candidates report.
 *
 * The model emits one JSON object of the shape:
 *
 *   { "candidates": [ {caseId, rank, score, rationale}, ... ], "summary": "..." }
 *
 * but it streams in incrementally. This helper turns the buffered partial
 * string into whatever complete candidate entries we can read off the front,
 * so the UI can render the ranking as it builds.
 *
 * Walks the buffer once, tracks brace depth, and yields each complete `{ ... }`
 * inside `candidates: [` as a JSON-parseable string. Tolerates strings with
 * escapes. Skips malformed entries silently — better to render nothing for
 * an entry than crash the UI mid-stream.
 *
 * The summary field is read separately on the final pass (once the stream
 * completes), since the model writes it after `candidates` in the prompt.
 */

export interface PartialCandidate {
  caseId: number;
  rank: number;
  score: number;
  rationale: string;
}

/** Pull every COMPLETE candidate object from inside the `candidates: [...]`
 *  segment of the buffer. Incomplete trailing objects are not returned. */
export function extractCandidatesFromBuffer(
  buffer: string
): PartialCandidate[] {
  const idx = buffer.indexOf("candidates");
  if (idx === -1) return [];
  const arrayStart = buffer.indexOf("[", idx);
  if (arrayStart === -1) return [];

  const results: PartialCandidate[] = [];
  const len = buffer.length;
  let i = arrayStart + 1;

  while (i < len) {
    while (
      i < len &&
      (buffer[i] === " " ||
        buffer[i] === "\n" ||
        buffer[i] === "\r" ||
        buffer[i] === "\t" ||
        buffer[i] === ",")
    ) {
      i++;
    }
    if (i >= len) break;
    if (buffer[i] !== "{") break;

    const objStart = i;
    let depth = 0;
    let inString = false;
    let escaped = false;

    while (i < len) {
      const ch = buffer[i];
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        i++;
        continue;
      }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const raw = buffer.substring(objStart, i + 1);
            try {
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              if (
                typeof parsed.caseId === "number" &&
                typeof parsed.rank === "number" &&
                typeof parsed.score === "number" &&
                typeof parsed.rationale === "string"
              ) {
                results.push({
                  caseId: parsed.caseId,
                  rank: parsed.rank,
                  score: parsed.score,
                  rationale: parsed.rationale,
                });
              }
            } catch {
              // Malformed object — skip it. Defensive only.
            }
            i++;
            break;
          }
        }
      }
      i++;
    }
    // If the inner loop exited with depth != 0, the object is incomplete;
    // stop here and wait for the next buffer chunk.
    if (depth !== 0) break;
  }

  return results;
}

/** Pull the `summary` string off a (probably complete) buffer. Returns
 *  `null` if the field isn't found or isn't a complete quoted string. */
export function extractSummaryFromBuffer(buffer: string): string | null {
  const idx = buffer.indexOf('"summary"');
  if (idx === -1) return null;
  const colonIdx = buffer.indexOf(":", idx);
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < buffer.length && (buffer[i] === " " || buffer[i] === "\n")) i++;
  if (buffer[i] !== '"') return null;
  const stringStart = i + 1;
  let escaped = false;
  for (let j = stringStart; j < buffer.length; j++) {
    const ch = buffer[j];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      try {
        // Round-trip through JSON.parse to resolve escape sequences correctly.
        return JSON.parse(buffer.substring(stringStart - 1, j + 1)) as string;
      } catch {
        return null;
      }
    }
  }
  return null;
}
