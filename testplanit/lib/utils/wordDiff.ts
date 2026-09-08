export interface DiffToken {
  text: string;
  /** True when this token (from `mine`) has no counterpart in `theirs`. */
  changed: boolean;
}

/** Cap the LCS table size; past this, fall back to a whole-string comparison. */
const MAX_TOKENS = 600;

/**
 * Word-level diff. Returns `mine` split into word/whitespace tokens, each
 * flagged `changed` when it is not part of the longest common subsequence with
 * `theirs`. Used to highlight exactly which words differ between two very
 * similar strings (e.g. near-duplicate test-case names).
 */
export function wordDiffTokens(mine: string, theirs: string): DiffToken[] {
  const a = mine.split(/(\s+)/).filter(Boolean);
  const b = theirs.split(/(\s+)/).filter(Boolean);
  const m = a.length;
  const n = b.length;
  if (m === 0) return [];
  if (m > MAX_TOKENS || n > MAX_TOKENS) {
    // Too large to diff cheaply — mark everything changed only if they differ.
    const changed = mine !== theirs;
    return a.map((text) => ({ text, changed }));
  }

  // dp[i][j] = length of the LCS of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m) {
    if (j < n && a[i] === b[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      out.push({ text: a[i], changed: false }); // common token
      i++;
      j++;
    } else if (j < n && dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ text: a[i], changed: true }); // present only in `mine`
      i++;
    } else if (j < n) {
      j++; // present only in `theirs` — nothing to render on this side
    } else {
      out.push({ text: a[i], changed: true });
      i++;
    }
  }
  return out;
}
