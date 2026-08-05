import { describe, expect, it } from "vitest";

import {
  ES_MAX_RESULT_WINDOW,
  sanitizeSearchCaseIds,
} from "./repositoryCaseSearchIds";

describe("sanitizeSearchCaseIds", () => {
  it("keeps safe positive integers in the order they arrived", () => {
    expect(sanitizeSearchCaseIds([9, 4, 1])).toEqual([9, 4, 1]);
  });

  it("drops non-integers, non-positives and non-numbers", () => {
    expect(
      sanitizeSearchCaseIds([
        1.5,
        -3,
        0,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 2,
        "7",
        null,
        undefined,
        { id: 8 },
        [9],
        true,
        7,
      ])
    ).toEqual([7]);
  });

  it("dedupes while keeping the first occurrence's position", () => {
    expect(sanitizeSearchCaseIds([5, 3, 5, 1, 3])).toEqual([5, 3, 1]);
  });

  it("caps the set at the Elasticsearch result window", () => {
    const ids = Array.from(
      { length: ES_MAX_RESULT_WINDOW + 50 },
      (_, i) => i + 1
    );
    const sanitized = sanitizeSearchCaseIds(ids);

    expect(sanitized).toHaveLength(ES_MAX_RESULT_WINDOW);
    expect(sanitized[0]).toBe(1);
    expect(sanitized.at(-1)).toBe(ES_MAX_RESULT_WINDOW);
  });

  it("counts only surviving ids toward the cap", () => {
    // Junk must not consume cap slots: a body padded with rejects still gets
    // its full window of real ids.
    const ids = [
      ...Array.from({ length: 100 }, () => -1),
      ...Array.from({ length: ES_MAX_RESULT_WINDOW }, (_, i) => i + 1),
    ];

    expect(sanitizeSearchCaseIds(ids)).toHaveLength(ES_MAX_RESULT_WINDOW);
  });

  it("returns an empty array for an empty input — a search matching nothing", () => {
    expect(sanitizeSearchCaseIds([])).toEqual([]);
  });
});
