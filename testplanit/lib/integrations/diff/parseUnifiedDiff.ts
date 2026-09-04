/**
 * Minimal unified-diff parser shared by every git provider adapter and the
 * Impact pin matcher. Accepts a single-file patch with or without the
 * `diff --git` / `---` / `+++` header lines (GitHub's `patch` and GitLab's
 * `diff` both start at the first `@@` hunk).
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /**
   * Old-side line ranges actually touched by this hunk, context excluded and
   * coalesced. Deleted/modified lines map to themselves; a pure insertion maps
   * to the two old lines it lands between (clamped to >= 1) so a pin whose
   * block borders the insertion still counts as touched.
   */
  changedOldRanges: Array<[number, number]>;
}

export interface ParsedFilePatch {
  oldPath?: string;
  newPath?: string;
  isBinary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface MultiFileDiffChunk {
  oldPath?: string;
  newPath?: string;
  body: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;

function stripPrefix(path: string): string | undefined {
  const trimmed = path.trim().split("\t")[0];
  if (trimmed === "/dev/null") return undefined;
  return trimmed.replace(/^[ab]\//, "");
}

function coalesce(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      out.push([cur[0], cur[1]]);
    }
  }
  return out;
}

export function parseUnifiedDiff(patch: string): ParsedFilePatch {
  const result: ParsedFilePatch = {
    isBinary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  };
  if (!patch) return result;

  const lines = patch.split("\n");
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let pending: Array<[number, number]> = [];
  let replacing = false;

  const closeHunk = () => {
    if (hunk) {
      hunk.changedOldRanges = coalesce(pending);
      result.hunks.push(hunk);
    }
    hunk = null;
    pending = [];
    replacing = false;
  };

  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      closeHunk();
      const oldStart = parseInt(header[1], 10);
      const oldLines = header[2] === undefined ? 1 : parseInt(header[2], 10);
      const newStart = parseInt(header[3], 10);
      const newLines = header[4] === undefined ? 1 : parseInt(header[4], 10);
      hunk = { oldStart, oldLines, newStart, newLines, changedOldRanges: [] };
      oldLine = oldStart;
      continue;
    }

    if (!hunk) {
      const git = GIT_HEADER.exec(line);
      if (git) {
        result.oldPath = git[1];
        result.newPath = git[2];
        continue;
      }
      if (line.startsWith("--- ")) {
        result.oldPath = stripPrefix(line.slice(4));
        continue;
      }
      if (line.startsWith("+++ ")) {
        result.newPath = stripPrefix(line.slice(4));
        continue;
      }
      if (
        line.startsWith("Binary files ") ||
        line.startsWith("GIT binary patch")
      ) {
        result.isBinary = true;
      }
      continue;
    }

    if (line.startsWith("\\")) {
      // "\ No newline at end of file"
      continue;
    }
    const marker = line[0];
    if (marker === "-") {
      result.deletions++;
      pending.push([oldLine, oldLine]);
      oldLine++;
      replacing = true;
    } else if (marker === "+") {
      result.additions++;
      if (!replacing) {
        const before = Math.max(1, oldLine - 1);
        const after = Math.max(1, oldLine);
        pending.push([before, after]);
      }
    } else if (marker === " " || line === "") {
      // Context line. An empty string can be an empty context line or the
      // trailing split artifact; both advance nothing meaningful past the
      // hunk's declared extent because the header bounds it.
      if (line === "" && oldLine >= hunk.oldStart + hunk.oldLines) continue;
      oldLine++;
      replacing = false;
    } else {
      // Anything else ends the hunk (e.g. the next file's "diff --git").
      closeHunk();
      const git = GIT_HEADER.exec(line);
      if (git) {
        result.oldPath = result.oldPath ?? git[1];
        result.newPath = result.newPath ?? git[2];
      }
    }
  }
  closeHunk();
  return result;
}

/**
 * Split a raw multi-file unified diff (Bitbucket's `/diff/{spec}`, `git diff`
 * output) into per-file chunks keyed by the `diff --git` header paths.
 */
export function splitMultiFileDiff(raw: string): MultiFileDiffChunk[] {
  if (!raw) return [];
  const lines = raw.split("\n");
  const chunks: MultiFileDiffChunk[] = [];
  let current: MultiFileDiffChunk | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      current.body = buffer.join("\n");
      chunks.push(current);
    }
    buffer = [];
  };

  for (const line of lines) {
    const git = GIT_HEADER.exec(line);
    if (git) {
      flush();
      current = { oldPath: git[1], newPath: git[2], body: "" };
      buffer.push(line);
      continue;
    }
    if (!current) {
      // Headerless input: treat the whole thing as one chunk.
      current = { body: "" };
    }
    buffer.push(line);
  }
  flush();

  // Resolve /dev/null sides from the ---/+++ lines when present.
  for (const chunk of chunks) {
    const parsed = parseUnifiedDiff(chunk.body);
    if (parsed.oldPath === undefined && /^--- \/dev\/null$/m.test(chunk.body)) {
      chunk.oldPath = undefined;
    }
    if (
      parsed.newPath === undefined &&
      /^\+\+\+ \/dev\/null$/m.test(chunk.body)
    ) {
      chunk.newPath = undefined;
    }
  }
  return chunks;
}

/** Drop everything before the first hunk so the body matches GitHub's `patch`. */
export function stripDiffHeaders(patch: string): string {
  const idx = patch.search(/^@@ /m);
  return idx === -1 ? "" : patch.slice(idx);
}
