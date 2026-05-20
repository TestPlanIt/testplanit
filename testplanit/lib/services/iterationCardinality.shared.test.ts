import { describe, expect, it } from "vitest";

import {
  computePreflight,
  DEFAULT_CARDINALITY_THRESHOLDS,
} from "./iterationCardinality";

const DEFAULTS = DEFAULT_CARDINALITY_THRESHOLDS;

/**
 * Coverage for the shared-dataset path through `computePreflight`. The
 * pre-existing `iterationCardinality.test.ts` already exercises the
 * owner-only `rowCount` flow; this file pins down the
 * `assignedRowCount`-bearing inputs and the Math.max defensive merge.
 *
 * The route layer (POST /api/test-runs/preflight-cardinality) is
 * responsible for the owner-wins zeroing — it sets `assignedRowCount: 0`
 * when the case has an owner dataset. `computePreflight` itself is
 * permissive (Math.max), so a misbehaving caller still produces a
 * deterministic, monotone-growing total rather than a silently-zeroed
 * one.
 */
describe("computePreflight — shared-dataset (assignedRowCount) coverage", () => {
  it("uses assignedRowCount when only the shared assignment has rows (200 × 2 configs = 400)", () => {
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Login",
          hasParameters: true,
          rowCount: 0,
          assignedRowCount: 200,
        },
      ],
      2,
      DEFAULTS
    );
    expect(r.total).toBe(400);
    expect(r.perCase).toHaveLength(1);
    expect(r.perCase[0]).toEqual({
      caseId: 1,
      caseTitle: "Login",
      rowCount: 200,
      iterations: 400,
    });
  });

  it("uses rowCount when only the owner dataset has rows (Amendment A: owner has 5, no assignment)", () => {
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Login",
          hasParameters: true,
          rowCount: 5,
          assignedRowCount: 0,
        },
      ],
      1,
      DEFAULTS
    );
    expect(r.total).toBe(5);
    expect(r.perCase[0].rowCount).toBe(5);
    expect(r.perCase[0].iterations).toBe(5);
  });

  it("uses assignedRowCount when only the shared assignment is present (no owner)", () => {
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Login",
          hasParameters: true,
          rowCount: 0,
          assignedRowCount: 5,
        },
      ],
      1,
      DEFAULTS
    );
    expect(r.total).toBe(5);
    expect(r.perCase[0].iterations).toBe(5);
  });

  it("returns 0 iterations when both row counts are 0 (parameterized case with no data)", () => {
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Empty",
          hasParameters: true,
          rowCount: 0,
          assignedRowCount: 0,
        },
      ],
      4,
      DEFAULTS
    );
    expect(r.total).toBe(0);
    // Parameterized cases with no rows still appear in perCase so the UI
    // can render a "0 rows yet — add data" hint.
    expect(r.perCase).toHaveLength(1);
    expect(r.perCase[0].iterations).toBe(0);
  });

  it("Math.max defensive merge: rowCount=5, assignedRowCount=200 → 200 (owner-wins zeroing is the route's job, not this function's)", () => {
    // The route layer is supposed to set assignedRowCount=0 when an owner
    // dataset is present. computePreflight itself takes the max so a
    // misbehaving caller produces a deterministic, monotone-growing
    // total rather than a silently-zeroed one.
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Login",
          hasParameters: true,
          rowCount: 5,
          assignedRowCount: 200,
        },
      ],
      1,
      DEFAULTS
    );
    expect(r.total).toBe(200);
    expect(r.perCase[0].rowCount).toBe(200);
  });

  it("backward-compat: input WITHOUT assignedRowCount uses rowCount as in Phase 3", () => {
    const r = computePreflight(
      [
        // No assignedRowCount field at all (legacy Phase-3-shape input).
        { caseId: 1, caseTitle: "Login", hasParameters: true, rowCount: 7 },
      ],
      3,
      DEFAULTS
    );
    expect(r.total).toBe(21);
    expect(r.perCase[0].rowCount).toBe(7);
    expect(r.perCase[0].iterations).toBe(21);
  });

  it("multi-case mix of owner-only / shared-only / both fields rolls up correctly", () => {
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "OwnerOnly",
          hasParameters: true,
          rowCount: 10,
          assignedRowCount: 0,
        },
        {
          caseId: 2,
          caseTitle: "SharedOnly",
          hasParameters: true,
          rowCount: 0,
          assignedRowCount: 50,
        },
        // Legacy shape (no assignedRowCount field).
        {
          caseId: 3,
          caseTitle: "Legacy",
          hasParameters: true,
          rowCount: 4,
        },
      ],
      2,
      DEFAULTS
    );
    expect(r.total).toBe((10 + 50 + 4) * 2);
    // Sorted desc by iterations; biggest first.
    expect(r.perCase.map((c) => c.caseId)).toEqual([2, 1, 3]);
  });

  it("classifies the rolled-up shared-dataset total against the same thresholds (4000-row shared → softConfirm)", () => {
    // Default softCap is 1000, hardCap 5000 → 4000 total lands in
    // softConfirm.
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Big shared",
          hasParameters: true,
          rowCount: 0,
          assignedRowCount: 4000,
        },
      ],
      1,
      DEFAULTS
    );
    expect(r.total).toBe(4000);
    expect(r.classification).toBe("softConfirm");
  });

  it("classifies a 6000-row shared dataset as hardRefuse (above hardCap)", () => {
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Too big",
          hasParameters: true,
          rowCount: 0,
          assignedRowCount: 6000,
        },
      ],
      1,
      DEFAULTS
    );
    expect(r.total).toBe(6000);
    expect(r.classification).toBe("hardRefuse");
  });

  it("Amendment A: a case with a 5-row owner AND a 4000-row shared assignment — when the route correctly zeros assignedRowCount, total is 5", () => {
    // Simulate the route layer correctly applying owner-wins zeroing
    // before calling computePreflight.
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Owner+shared coexistence",
          hasParameters: true,
          rowCount: 5,
          assignedRowCount: 0, // Route zeroed this because owner exists.
        },
      ],
      1,
      DEFAULTS
    );
    expect(r.total).toBe(5);
    expect(r.classification).toBe("sync");
  });
});
