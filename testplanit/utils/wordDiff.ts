/**
 * Minimal word-level diff for the requirement content-history view — an
 * in-repo LCS over word/whitespace tokens rather than a new dependency
 * (`diff` exists in the tree only as a transitive security pin, and one
 * consumer does not justify promoting it).
 */

export interface WordDiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/** Above this token-matrix size the quadratic LCS is not worth running —
 * fall back to a whole-text remove/add pair, which is still a truthful
 * (if coarse) rendering of the change. */
const MAX_LCS_CELLS = 400_000;

function tokenize(text: string): string[] {
  // Words and whitespace runs as separate tokens, so reflowed whitespace
  // doesn't mark every neighbouring word as changed.
  return text.split(/(\s+)/).filter((token) => token !== "");
}

function pushPart(
  parts: WordDiffPart[],
  value: string,
  kind: "same" | "added" | "removed"
): void {
  const last = parts[parts.length - 1];
  const matches =
    last &&
    Boolean(last.added) === (kind === "added") &&
    Boolean(last.removed) === (kind === "removed");
  if (matches) {
    last.value += value;
    return;
  }
  parts.push({
    value,
    ...(kind === "added" ? { added: true } : {}),
    ...(kind === "removed" ? { removed: true } : {}),
  });
}

/**
 * Word-level diff of two texts as an ordered part list — unchanged runs,
 * removed runs (present only in `before`), added runs (only in `after`).
 */
export function diffWords(before: string, after: string): WordDiffPart[] {
  if (before === after) {
    return before === "" ? [] : [{ value: before }];
  }
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > MAX_LCS_CELLS) {
    const parts: WordDiffPart[] = [];
    if (before !== "") parts.push({ value: before, removed: true });
    if (after !== "") parts.push({ value: after, added: true });
    return parts;
  }

  // Standard LCS length table, then a walk-back emitting parts in order.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }

  const parts: WordDiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushPart(parts, a[i], "same");
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      pushPart(parts, a[i], "removed");
      i++;
    } else {
      pushPart(parts, b[j], "added");
      j++;
    }
  }
  while (i < a.length) {
    pushPart(parts, a[i], "removed");
    i++;
  }
  while (j < b.length) {
    pushPart(parts, b[j], "added");
    j++;
  }
  return parts;
}
