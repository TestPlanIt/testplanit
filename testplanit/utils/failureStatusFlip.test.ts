import { describe, expect, it } from "vitest";
import {
  failureFlipStatusId,
  hasNewlyLinkedIssue,
  type FlipCandidateStatus,
} from "./failureStatusFlip";

const UNTESTED: FlipCandidateStatus = { id: 1, isFailure: false, order: 10 };
const PASSED: FlipCandidateStatus = { id: 2, isFailure: false, order: 20 };
const FAILED: FlipCandidateStatus = { id: 3, isFailure: true, order: 30 };
const BLOCKED: FlipCandidateStatus = { id: 4, isFailure: true, order: 40 };

const STATUSES = [UNTESTED, PASSED, FAILED, BLOCKED];

describe("hasNewlyLinkedIssue", () => {
  it("detects the first issue linked to an empty selection", () => {
    expect(hasNewlyLinkedIssue([], [7])).toBe(true);
  });

  it("detects an issue added alongside existing ones", () => {
    expect(hasNewlyLinkedIssue([7, 8], [7, 8, 9])).toBe(true);
  });

  it("ignores an unchanged selection re-emitted by the picker", () => {
    expect(hasNewlyLinkedIssue([7, 8], [7, 8])).toBe(false);
  });

  it("ignores unlinking", () => {
    expect(hasNewlyLinkedIssue([7, 8], [7])).toBe(false);
    expect(hasNewlyLinkedIssue([7], [])).toBe(false);
  });

  it("ignores a reordered selection", () => {
    expect(hasNewlyLinkedIssue([7, 8], [8, 7])).toBe(false);
  });

  it("treats a missing previous selection as empty", () => {
    expect(hasNewlyLinkedIssue(undefined, [7])).toBe(true);
    expect(hasNewlyLinkedIssue(null, [])).toBe(false);
    expect(hasNewlyLinkedIssue([7], undefined)).toBe(false);
  });
});

describe("failureFlipStatusId", () => {
  it("flips an unset status to the first failure status", () => {
    expect(failureFlipStatusId(null, STATUSES)).toBe(FAILED.id);
  });

  it("flips a passing status to the first failure status", () => {
    expect(failureFlipStatusId(PASSED.id, STATUSES)).toBe(FAILED.id);
  });

  it("picks the lowest-order failure status regardless of array order", () => {
    expect(failureFlipStatusId(null, [BLOCKED, PASSED, FAILED])).toBe(
      FAILED.id
    );
  });

  it("leaves an already-failing status alone", () => {
    expect(failureFlipStatusId(FAILED.id, STATUSES)).toBeNull();
    expect(failureFlipStatusId(BLOCKED.id, STATUSES)).toBeNull();
  });

  it("returns null when the project has no failure status", () => {
    expect(failureFlipStatusId(PASSED.id, [UNTESTED, PASSED])).toBeNull();
  });

  it("returns null when statuses have not loaded", () => {
    expect(failureFlipStatusId(PASSED.id, [])).toBeNull();
    expect(failureFlipStatusId(PASSED.id, undefined)).toBeNull();
    expect(failureFlipStatusId(PASSED.id, null)).toBeNull();
  });

  it("flips when the current status is not among the project's statuses", () => {
    expect(failureFlipStatusId(999, STATUSES)).toBe(FAILED.id);
  });
});
