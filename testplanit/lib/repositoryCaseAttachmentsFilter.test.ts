import { describe, expect, it } from "vitest";
import {
  attachmentsWhereClause,
  shapeAttachmentsFacet,
} from "./repositoryCaseAttachmentsFilter";

describe("attachmentsWhereClause", () => {
  it("matches cases with at least one live attachment", () => {
    expect(attachmentsWhereClause(true)).toEqual({
      attachments: { some: { isDeleted: false } },
    });
  });

  it("matches cases with no live attachments", () => {
    expect(attachmentsWhereClause(false)).toEqual({
      attachments: { none: { isDeleted: false } },
    });
  });

  it("always guards on isDeleted:false so soft-deleted attachments don't count", () => {
    // Regression guard: a bare relation check (some: {} / none: {}) would let a
    // case whose only attachment was soft-deleted show up as "has attachments".
    const hasClause = attachmentsWhereClause(true).attachments as {
      some: { isDeleted: boolean };
    };
    const noneClause = attachmentsWhereClause(false).attachments as {
      none: { isDeleted: boolean };
    };
    expect(hasClause.some.isDeleted).toBe(false);
    expect(noneClause.none.isDeleted).toBe(false);
  });
});

describe("shapeAttachmentsFacet", () => {
  it("derives the 'no attachments' bucket by subtraction", () => {
    expect(shapeAttachmentsFacet(10, 3)).toEqual([
      { value: true, count: 3 },
      { value: false, count: 7 },
    ]);
  });

  it("keeps the two buckets summing to the total", () => {
    const [withAttachments, withoutAttachments] = shapeAttachmentsFacet(42, 17);
    expect(withAttachments.count + withoutAttachments.count).toBe(42);
  });

  it("handles the all/none edge cases", () => {
    expect(shapeAttachmentsFacet(5, 5)).toEqual([
      { value: true, count: 5 },
      { value: false, count: 0 },
    ]);
    expect(shapeAttachmentsFacet(5, 0)).toEqual([
      { value: true, count: 0 },
      { value: false, count: 5 },
    ]);
  });
});
