// Integration test — parameter-redaction ↔ AuditEvent.metadata type contract.
//
// Plan 01-03 Task 2. The redactValues helper (Plan 01-02) produces a
// Record<string, unknown> map. The AuditEvent interface (lib/services/auditLog.ts)
// types its metadata field as `Record<string, unknown> | undefined`. This file
// LOCKS the type-level + value-level contract between the two so Phase 3's
// audit-log wiring fails at compile-time (not runtime) if either side drifts.
//
// Why a separate file: Plan 01-02 already unit-tests `redactValues` against
// its own contract. This file proves the helper's OUTPUT is assignable to
// AuditEvent.metadata — that's a different test target (the wire-up between
// two modules), and it lives at the integration boundary per VALIDATION.md.
//
// Run via:
//   cd testplanit && pnpm test parameter-redaction-contract --run
//
// Pure-function test — no Prisma, no BullMQ, no DB.

import { describe, expect, it } from "vitest";
import {
  redactValues,
  type ParameterSchemaEntry,
} from "@/lib/services/parameterRedaction";
import type { AuditEvent } from "@/lib/services/auditLog";
// AuditAction lives on the generated Prisma client. We verified the enum
// values present in schema.zmodel (lines 4511-4554) — RESULT_RECORDED is not
// among the current enum values; Phase 3 will introduce a new value (likely
// ITERATION_RESULT_RECORDED). For Phase 1 we use CREATE, which IS guaranteed
// to exist (it's the canonical first AuditAction value), and document the
// Phase 3 follow-up via a comment.
import { AuditAction } from "@prisma/client";

// AuditAction enum verification: schema.zmodel:4511-4554 includes CREATE,
// UPDATE, DELETE, etc. RESULT_RECORDED is NOT in the enum at Phase 1.
// Phase 3 (iteration writes) will add a new action value such as
// ITERATION_RESULT_RECORDED — at which point the references below should be
// updated to match the new enum. The redaction sentinel is the same byte-
// sequence used by the existing audit-log SENSITIVE_FIELDS redaction
// (lib/services/auditLog.ts: "[REDACTED]"); if this changes, both helpers
// must change atomically — see PARAM-03 / RESEARCH.md Q5.

describe("parameter-redaction ↔ AuditEvent.metadata contract", () => {
  describe("Group 1: Type contract", () => {
    it("Test 1.1: redactValues output is structurally assignable to AuditEvent.metadata", () => {
      const paramSchema: ParameterSchemaEntry[] = [
        { name: "apiKey", sensitive: true },
      ];
      // The line below is the load-bearing type contract: if Phase 3's
      // wiring makes AuditEvent.metadata stricter than Record<string, unknown>,
      // this assignment will fail to type-check and Vitest will surface the
      // failure as a compile-time error.
      const event: AuditEvent = {
        action: AuditAction.CREATE,
        entityType: "TestRunCaseIteration",
        entityId: "42",
        metadata: redactValues(
          { apiKey: "secret" },
          paramSchema,
          /* viewerCanReadSensitive */ false
        ),
      };
      expect(event.metadata).toEqual({ apiKey: "[REDACTED]" });
    });
  });

  describe("Group 2: Value contract", () => {
    it("Test 2.1: redactValues output preserves the redaction sentinel exactly when assigned to AuditEvent.metadata", () => {
      const paramSchema: ParameterSchemaEntry[] = [
        { name: "apiKey", sensitive: true },
        { name: "username", sensitive: false },
      ];
      const event: AuditEvent = {
        action: AuditAction.CREATE,
        entityType: "TestRunCaseIteration",
        entityId: "1",
        metadata: redactValues(
          { apiKey: "k1", username: "alice" },
          paramSchema,
          false
        ),
      };
      expect(event.metadata?.apiKey).toBe("[REDACTED]");
      expect(event.metadata?.username).toBe("alice");
    });

    it("Test 2.2: viewerCanReadSensitive=true preserves original values structurally", () => {
      const paramSchema: ParameterSchemaEntry[] = [
        { name: "apiKey", sensitive: true },
        { name: "region", sensitive: false },
      ];
      const original = { apiKey: "k1", region: "us-east-1" };
      const event: AuditEvent = {
        action: AuditAction.CREATE,
        entityType: "TestRunCaseIteration",
        entityId: "2",
        metadata: redactValues(original, paramSchema, /* viewerCanReadSensitive */ true),
      };
      // Deep-equal by value; redactValues is permitted to return a copy.
      expect(event.metadata).toEqual(original);
    });

    it("Test 2.3: empty values map produces empty metadata (not undefined)", () => {
      const event: AuditEvent = {
        action: AuditAction.CREATE,
        entityType: "TestRunCaseIteration",
        entityId: "3",
        metadata: redactValues({}, [], false),
      };
      expect(event.metadata).toEqual({});
      expect(event.metadata).not.toBeUndefined();
    });

    it("Test 2.4: AuditAction enum value used exists at runtime (Phase 3 will add ITERATION_RESULT_RECORDED)", () => {
      // We use CREATE for Phase 1 because RESULT_RECORDED is not part of the
      // current AuditAction enum (verified against schema.zmodel:4511-4554).
      // Phase 3 (iteration result writes) is the planned introduction point
      // for a parametized-iteration-specific action.
      expect(AuditAction.CREATE).toBe("CREATE");
      // Document the existing sentinel here too — both helpers MUST emit the
      // same string, see lib/services/auditLog.ts.
      const out = redactValues(
        { apiKey: "x" },
        [{ name: "apiKey", sensitive: true }],
        false
      );
      expect(out.apiKey).toBe("[REDACTED]");
    });
  });

  describe("Group 3: Sentinel uniqueness + cross-helper compatibility", () => {
    it("Test 3.1: the redaction sentinel matches the auditLog SENSITIVE_FIELDS sentinel byte-for-byte", () => {
      // Both helpers use "[REDACTED]"; if this changes, both must change
      // atomically — see PARAM-03 / RESEARCH.md Q5.
      const out = redactValues(
        { token: "value" },
        [{ name: "token", sensitive: true }],
        false
      );
      expect(out.token).toBe("[REDACTED]");
      // Confirm the literal includes the brackets (sentinels often drift to
      // <REDACTED> or **REDACTED** under refactor; this assertion is the
      // canary).
      expect(String(out.token).startsWith("[")).toBe(true);
      expect(String(out.token).endsWith("]")).toBe(true);
    });

    it("Test 3.2: redactValues output type IS assignable to AuditEvent['metadata'] (TS-only check, encoded as runtime no-op)", () => {
      // This test exists primarily to compile. If the assignment below ever
      // stops type-checking, Vitest surfaces it via tsc — which is the whole
      // point of the contract test (Phase 3 wiring drift catches at compile-
      // time, not runtime).
      const meta: AuditEvent["metadata"] = redactValues(
        { secret: "x", normal: 42 },
        [{ name: "secret", sensitive: true }],
        false
      );
      expect(meta).toBeDefined();
      expect(meta?.secret).toBe("[REDACTED]");
      expect(meta?.normal).toBe(42);
    });
  });
});
