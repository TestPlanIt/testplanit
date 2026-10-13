import { describe, expect, it } from "vitest";
import {
  CACHE_RESET_FIELDS,
  cacheContentChanged,
  pathPatternRows,
  repoConnectionData,
  repoPreviewRequest,
} from "./repoConnectionForm";

const values = {
  repositoryId: "3",
  branch: "",
  pathPatterns: [
    { path: "src", pattern: "**/*", exclude: false },
    { path: "", pattern: "**/CHANGELOG*", exclude: true },
  ],
  cacheEnabled: true,
  cacheTtlDays: 7,
};
const stored = {
  repositoryId: 3,
  branch: null,
  // Saved before the flag existed on the first row.
  pathPatterns: [
    { path: "src", pattern: "**/*" },
    { path: "", pattern: "**/CHANGELOG*", exclude: true },
  ],
};

describe("pathPatternRows", () => {
  it("gives every stored row a boolean exclude flag and drops junk", () => {
    expect(pathPatternRows(stored.pathPatterns)).toEqual(values.pathPatterns);
    expect(
      pathPatternRows([null, "x", { path: "a" }, { pattern: "*" }])
    ).toEqual([{ path: "", pattern: "*", exclude: false }]);
    expect(pathPatternRows(null)).toEqual([]);
  });
});

describe("repoPreviewRequest", () => {
  it("sends the rows a save would store, with no branch meaning the default", () => {
    expect(repoPreviewRequest(values)).toEqual({
      branch: undefined,
      pathPatterns: values.pathPatterns,
      cacheEnabled: true,
    });
  });
});

describe("cacheContentChanged", () => {
  it("is false when the repository, branch and rows are the same, flag spelled out or not", () => {
    expect(cacheContentChanged(stored, values)).toBe(false);
    expect(
      cacheContentChanged(stored, {
        ...values,
        cacheTtlDays: 1,
        cacheEnabled: false,
      })
    ).toBe(false);
  });

  it("is true for a new connection or any change to what the cache holds", () => {
    expect(cacheContentChanged(null, values)).toBe(true);
    expect(cacheContentChanged(stored, { ...values, repositoryId: "4" })).toBe(
      true
    );
    expect(cacheContentChanged(stored, { ...values, branch: "dev" })).toBe(
      true
    );
    expect(
      cacheContentChanged(stored, {
        ...values,
        pathPatterns: [values.pathPatterns[0]],
      })
    ).toBe(true);
    expect(
      cacheContentChanged(stored, {
        ...values,
        pathPatterns: values.pathPatterns.map((row) => ({
          ...row,
          exclude: false,
        })),
      })
    ).toBe(true);
  });
});

describe("repoConnectionData", () => {
  it("writes the shared fields and resets the cache only when its content changed", () => {
    expect(repoConnectionData(stored, values)).toEqual({
      data: {
        branch: null,
        pathPatterns: values.pathPatterns,
        cacheEnabled: true,
        cacheTtlDays: 7,
      },
      cacheContentChanged: false,
    });
    const fresh = repoConnectionData(null, { ...values, branch: "main" });
    expect(fresh.cacheContentChanged).toBe(true);
    expect(fresh.data).toMatchObject({ branch: "main", ...CACHE_RESET_FIELDS });
  });
});
