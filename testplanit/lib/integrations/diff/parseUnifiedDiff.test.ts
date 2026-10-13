import { describe, expect, it } from "vitest";
import {
  parseUnifiedDiff,
  splitMultiFileDiff,
  stripDiffHeaders,
} from "./parseUnifiedDiff";

const MODIFIED_FILE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 83db48f..bf269f4 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " import x",
  "+import y",
  " export a",
  " export b",
  "",
].join("\n");

const NEW_FILE_DIFF = [
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "index 0000000..e69de29",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+line1",
  "+line2",
  "",
].join("\n");

const DELETED_FILE_DIFF = [
  "diff --git a/src/old.ts b/src/old.ts",
  "deleted file mode 100644",
  "index e69de29..0000000",
  "--- a/src/old.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-line1",
  "-line2",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  describe("GitHub-style patch (starts at @@)", () => {
    it("parses long-form hunk headers and counts additions", () => {
      const patch = [
        "@@ -10,6 +10,9 @@ export function foo() {",
        " ctx10",
        " ctx11",
        " ctx12",
        "+new1",
        "+new2",
        "+new3",
        " ctx13",
        " ctx14",
        " ctx15",
        "",
      ].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.isBinary).toBe(false);
      expect(parsed.oldPath).toBeUndefined();
      expect(parsed.newPath).toBeUndefined();
      expect(parsed.additions).toBe(3);
      expect(parsed.deletions).toBe(0);
      expect(parsed.hunks).toHaveLength(1);
      expect(parsed.hunks[0]).toMatchObject({
        oldStart: 10,
        oldLines: 6,
        newStart: 10,
        newLines: 9,
      });
    });

    it("maps a pure insertion to the boundary pair, never the context span", () => {
      const patch = [
        "@@ -10,6 +10,9 @@",
        " ctx10",
        " ctx11",
        " ctx12",
        "+new1",
        "+new2",
        "+new3",
        " ctx13",
        " ctx14",
        " ctx15",
        "",
      ].join("\n");

      const [hunk] = parseUnifiedDiff(patch).hunks;

      expect(hunk.changedOldRanges).toEqual([[12, 13]]);
      expect(hunk.changedOldRanges).not.toEqual([[10, 15]]);
    });

    it("treats the short header form as a single line on each side", () => {
      const patch = ["@@ -1 +1 @@", "-old", "+new", ""].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.hunks[0]).toMatchObject({
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
      });
      expect(parsed.additions).toBe(1);
      expect(parsed.deletions).toBe(1);
      expect(parsed.hunks[0].changedOldRanges).toEqual([[1, 1]]);
    });

    it("mixes short and long header forms", () => {
      const patch = ["@@ -5 +5,2 @@", " ctx5", "+added", ""].join("\n");

      const [hunk] = parseUnifiedDiff(patch).hunks;

      expect(hunk).toMatchObject({
        oldStart: 5,
        oldLines: 1,
        newStart: 5,
        newLines: 2,
      });
      expect(hunk.changedOldRanges).toEqual([[5, 6]]);
    });

    it("clamps an insertion at the top of the file to line 1", () => {
      const patch = ["@@ -1,2 +1,3 @@", "+first", " a", " b", ""].join("\n");

      const [hunk] = parseUnifiedDiff(patch).hunks;

      expect(hunk.changedOldRanges).toEqual([[1, 1]]);
    });

    it("maps a deletion-only hunk to the deleted old lines, coalesced", () => {
      const patch = [
        "@@ -12,5 +12,3 @@",
        " ctx12",
        " ctx13",
        "-del14",
        "-del15",
        " ctx16",
        "",
      ].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.additions).toBe(0);
      expect(parsed.deletions).toBe(2);
      expect(parsed.hunks[0].changedOldRanges).toEqual([[14, 15]]);
    });

    it("keeps non-adjacent deletions as separate ranges", () => {
      const patch = [
        "@@ -1,5 +1,3 @@",
        "-del1",
        " ctx2",
        " ctx3",
        "-del4",
        " ctx5",
        "",
      ].join("\n");

      const [hunk] = parseUnifiedDiff(patch).hunks;

      expect(hunk.changedOldRanges).toEqual([
        [1, 1],
        [4, 4],
      ]);
    });

    it("maps a modification (delete + add at the same spot) to one range", () => {
      const patch = [
        "@@ -20,3 +20,3 @@",
        " ctx20",
        "-old21",
        "+new21",
        " ctx22",
        "",
      ].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.additions).toBe(1);
      expect(parsed.deletions).toBe(1);
      expect(parsed.hunks[0].changedOldRanges).toEqual([[21, 21]]);
    });

    it("keeps a replacement that grows the block anchored to the deleted lines", () => {
      const patch = [
        "@@ -20,4 +20,5 @@",
        " ctx20",
        "-old21",
        "-old22",
        "+new21",
        "+new22",
        "+new23",
        " ctx23",
        "",
      ].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.additions).toBe(3);
      expect(parsed.deletions).toBe(2);
      expect(parsed.hunks[0].changedOldRanges).toEqual([[21, 22]]);
    });

    it("resets the old-line cursor and change tracking per hunk", () => {
      const patch = [
        "@@ -1,3 +1,3 @@",
        " a",
        "-b",
        "+B",
        " c",
        "@@ -10,3 +10,4 @@",
        " j",
        "+K",
        " k",
        " l",
        "",
      ].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.hunks).toHaveLength(2);
      expect(parsed.hunks[0].changedOldRanges).toEqual([[2, 2]]);
      expect(parsed.hunks[1]).toMatchObject({ oldStart: 10, newStart: 10 });
      expect(parsed.hunks[1].changedOldRanges).toEqual([[10, 11]]);
      expect(parsed.additions).toBe(2);
      expect(parsed.deletions).toBe(1);
    });

    it("treats an empty line inside the hunk extent as a context line", () => {
      const patch = ["@@ -1,4 +1,4 @@", " a", "", "-c", "+C", " d", ""].join(
        "\n"
      );

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.hunks[0].changedOldRanges).toEqual([[3, 3]]);
    });
  });

  describe("no-newline markers", () => {
    it("ignores the marker without counting it as a change", () => {
      const patch = [
        "@@ -1,2 +1,2 @@",
        " a",
        "-b",
        "\\ No newline at end of file",
        "+B",
        "\\ No newline at end of file",
        "",
      ].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.additions).toBe(1);
      expect(parsed.deletions).toBe(1);
      expect(parsed.hunks[0].changedOldRanges).toEqual([[2, 2]]);
    });

    it("does not advance the old-line counter", () => {
      const patch = [
        "@@ -5,3 +5,3 @@",
        " a",
        "\\ No newline at end of file",
        " b",
        "-c",
        "+C",
        "",
      ].join("\n");

      const parsed = parseUnifiedDiff(patch);

      expect(parsed.hunks[0].changedOldRanges).toEqual([[7, 7]]);
    });
  });

  describe("binary diffs", () => {
    it("flags a GitLab-style headerless binary diff", () => {
      const parsed = parseUnifiedDiff(
        "Binary files a/logo.png and b/logo.png differ\n"
      );

      expect(parsed.isBinary).toBe(true);
      expect(parsed.hunks).toHaveLength(0);
      expect(parsed.additions).toBe(0);
      expect(parsed.deletions).toBe(0);
    });

    it("flags a git binary patch and keeps its paths", () => {
      const parsed = parseUnifiedDiff(
        [
          "diff --git a/logo.png b/logo.png",
          "index 1111111..2222222 100644",
          "GIT binary patch",
          "literal 10",
          "",
        ].join("\n")
      );

      expect(parsed.isBinary).toBe(true);
      expect(parsed.oldPath).toBe("logo.png");
      expect(parsed.newPath).toBe("logo.png");
    });
  });

  describe("full git diff headers", () => {
    it("sets oldPath/newPath for a modified file", () => {
      const parsed = parseUnifiedDiff(MODIFIED_FILE_DIFF);

      expect(parsed.oldPath).toBe("src/a.ts");
      expect(parsed.newPath).toBe("src/a.ts");
      expect(parsed.isBinary).toBe(false);
      expect(parsed.additions).toBe(1);
      expect(parsed.deletions).toBe(0);
      expect(parsed.hunks).toHaveLength(1);
      expect(parsed.hunks[0].changedOldRanges).toEqual([[1, 2]]);
    });

    it("maps --- /dev/null to an undefined oldPath for a new file", () => {
      const parsed = parseUnifiedDiff(NEW_FILE_DIFF);

      expect(parsed.oldPath).toBeUndefined();
      expect(parsed.newPath).toBe("src/new.ts");
      expect(parsed.additions).toBe(2);
      expect(parsed.deletions).toBe(0);
      expect(parsed.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0 });
      expect(parsed.hunks[0].changedOldRanges).toEqual([[1, 1]]);
    });

    it("maps +++ /dev/null to an undefined newPath for a deleted file", () => {
      const parsed = parseUnifiedDiff(DELETED_FILE_DIFF);

      expect(parsed.oldPath).toBe("src/old.ts");
      expect(parsed.newPath).toBeUndefined();
      expect(parsed.additions).toBe(0);
      expect(parsed.deletions).toBe(2);
      expect(parsed.hunks[0]).toMatchObject({ newStart: 0, newLines: 0 });
      expect(parsed.hunks[0].changedOldRanges).toEqual([[1, 2]]);
    });

    it("reads both sides of a rename from the diff --git header", () => {
      const parsed = parseUnifiedDiff(
        [
          "diff --git a/src/before.ts b/src/after.ts",
          "similarity index 90%",
          "rename from src/before.ts",
          "rename to src/after.ts",
          "--- a/src/before.ts",
          "+++ b/src/after.ts",
          "@@ -1 +1 @@",
          "-a",
          "+b",
          "",
        ].join("\n")
      );

      expect(parsed.oldPath).toBe("src/before.ts");
      expect(parsed.newPath).toBe("src/after.ts");
    });

    it("strips a trailing tab-separated timestamp from ---/+++ lines", () => {
      const parsed = parseUnifiedDiff(
        [
          "--- a/src/a.ts\t2026-01-01 00:00:00",
          "+++ b/src/a.ts\t2026-01-02 00:00:00",
          "@@ -1 +1 @@",
          "-a",
          "+b",
          "",
        ].join("\n")
      );

      expect(parsed.oldPath).toBe("src/a.ts");
      expect(parsed.newPath).toBe("src/a.ts");
    });

    it("treats ---/+++ prefixed content inside a hunk as changed lines", () => {
      const parsed = parseUnifiedDiff(
        [
          "@@ -1,2 +1,2 @@",
          " a",
          "--- not a header",
          "+++ not a header",
          "",
        ].join("\n")
      );

      expect(parsed.oldPath).toBeUndefined();
      expect(parsed.newPath).toBeUndefined();
      expect(parsed.additions).toBe(1);
      expect(parsed.deletions).toBe(1);
    });
  });

  describe("empty input", () => {
    it("returns zero counts and no hunks", () => {
      expect(parseUnifiedDiff("")).toEqual({
        isBinary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      });
    });
  });
});

describe("splitMultiFileDiff", () => {
  it("splits a three-file raw diff into chunks with resolved paths", () => {
    const raw = MODIFIED_FILE_DIFF + NEW_FILE_DIFF + DELETED_FILE_DIFF;

    const chunks = splitMultiFileDiff(raw);

    expect(chunks).toHaveLength(3);

    expect(chunks[0].oldPath).toBe("src/a.ts");
    expect(chunks[0].newPath).toBe("src/a.ts");
    expect(
      chunks[0].body.startsWith("diff --git a/src/a.ts b/src/a.ts\n")
    ).toBe(true);

    expect(chunks[1].oldPath).toBeUndefined();
    expect(chunks[1].newPath).toBe("src/new.ts");
    expect(
      chunks[1].body.startsWith("diff --git a/src/new.ts b/src/new.ts\n")
    ).toBe(true);

    expect(chunks[2].oldPath).toBe("src/old.ts");
    expect(chunks[2].newPath).toBeUndefined();
    expect(
      chunks[2].body.startsWith("diff --git a/src/old.ts b/src/old.ts\n")
    ).toBe(true);
  });

  it("keeps each chunk's body parseable on its own", () => {
    const chunks = splitMultiFileDiff(
      MODIFIED_FILE_DIFF + NEW_FILE_DIFF + DELETED_FILE_DIFF
    );

    const parsed = chunks.map((c) => parseUnifiedDiff(c.body));

    expect(parsed.map((p) => [p.additions, p.deletions])).toEqual([
      [1, 0],
      [2, 0],
      [0, 2],
    ]);
    expect(chunks[0].body).not.toContain("src/new.ts");
    expect(chunks[1].body).not.toContain("src/old.ts");
  });

  it("returns a single path-less chunk for headerless input", () => {
    const raw = ["@@ -1 +1 @@", "-a", "+b", ""].join("\n");

    const chunks = splitMultiFileDiff(raw);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].oldPath).toBeUndefined();
    expect(chunks[0].newPath).toBeUndefined();
    expect(chunks[0].body).toBe(raw);
  });

  it("returns no chunks for empty input", () => {
    expect(splitMultiFileDiff("")).toEqual([]);
  });
});

describe("stripDiffHeaders", () => {
  it("returns the patch from the first hunk header", () => {
    const stripped = stripDiffHeaders(MODIFIED_FILE_DIFF);

    expect(stripped.startsWith("@@ -1,3 +1,4 @@\n")).toBe(true);
    expect(stripped).not.toContain("diff --git");
    expect(stripped).not.toContain("+++ b/src/a.ts");
    expect(stripped).toContain("+import y");
  });

  it("leaves a patch that already starts at a hunk untouched", () => {
    const patch = ["@@ -1 +1 @@", "-a", "+b", ""].join("\n");

    expect(stripDiffHeaders(patch)).toBe(patch);
  });

  it("returns an empty string when there is no hunk", () => {
    expect(
      stripDiffHeaders("Binary files a/logo.png and b/logo.png differ\n")
    ).toBe("");
    expect(stripDiffHeaders("")).toBe("");
  });
});
