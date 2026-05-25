import { describe, it, expect } from "vitest";
import { ApplicationArea } from "@prisma/client";
import {
  REVIEW_RELEVANT_AREAS,
  areaForEntityType,
  isReviewRelevantArea,
} from "./reviewAreas";

describe("REVIEW_RELEVANT_AREAS", () => {
  it("contains exactly the three review-relevant areas", () => {
    expect(REVIEW_RELEVANT_AREAS).toEqual([
      ApplicationArea.TestCaseRepository,
      ApplicationArea.TestRuns,
      ApplicationArea.Sessions,
    ]);
  });
});

describe("areaForEntityType", () => {
  it("maps CASE to TestCaseRepository", () => {
    expect(areaForEntityType("CASE")).toBe(ApplicationArea.TestCaseRepository);
  });
  it("maps RUN to TestRuns", () => {
    expect(areaForEntityType("RUN")).toBe(ApplicationArea.TestRuns);
  });
  it("maps SESSION to Sessions", () => {
    expect(areaForEntityType("SESSION")).toBe(ApplicationArea.Sessions);
  });
});

describe("isReviewRelevantArea", () => {
  it("returns true for the three review-relevant areas", () => {
    expect(isReviewRelevantArea(ApplicationArea.TestCaseRepository)).toBe(true);
    expect(isReviewRelevantArea(ApplicationArea.TestRuns)).toBe(true);
    expect(isReviewRelevantArea(ApplicationArea.Sessions)).toBe(true);
  });
  it("returns false for unrelated areas", () => {
    expect(isReviewRelevantArea(ApplicationArea.ClosedTestRuns)).toBe(false);
    expect(isReviewRelevantArea(ApplicationArea.ClosedSessions)).toBe(false);
    expect(isReviewRelevantArea(ApplicationArea.Documentation)).toBe(false);
    expect(isReviewRelevantArea(ApplicationArea.Tags)).toBe(false);
  });
});
