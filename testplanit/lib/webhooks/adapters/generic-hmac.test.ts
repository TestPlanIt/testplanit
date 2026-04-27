import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  genericHmacAdapter,
  OUTBOUND_SIGNATURE_HEADER,
  signGenericHmac,
} from "./generic-hmac";
import type { OutboundEnvelope } from "./types";

const baseEnvelope: OutboundEnvelope = {
  eventId: "evt_00000000-0000-4000-8000-000000000000",
  eventName: "test_run.completed",
  eventTimestamp: "2026-04-27T12:00:00.000Z",
  tenantId: "test-tenant",
  projectId: 1,
  projectName: "Acme",
  actorUserId: "user-1",
  data: { runId: 1, runTitle: "Smoke" },
};

describe("genericHmacAdapter", () => {
  it("has adapterType=GENERIC_HMAC", () => {
    expect(genericHmacAdapter.adapterType).toBe("GENERIC_HMAC");
  });

  it("format() returns JSON-stringified envelope verbatim", () => {
    const out = genericHmacAdapter.format(baseEnvelope);
    expect(out.contentType).toBe("application/json");
    expect(JSON.parse(out.body)).toEqual(baseEnvelope);
  });

  it("sign() with active-only emits a single v1 entry", () => {
    const sig = genericHmacAdapter.sign!("body", { active: "secret-A" });
    const header = sig[OUTBOUND_SIGNATURE_HEADER];
    expect(typeof header).toBe("string");
    // t=<10-digit-ish int>,v1=<64 lowercase hex>
    expect(header).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
  });

  it("sign() with active + retiring emits two v1 entries (D-06 rotation overlap)", () => {
    const sig = genericHmacAdapter.sign!("body", {
      active: "A",
      retiring: "B",
    });
    const header = sig[OUTBOUND_SIGNATURE_HEADER];
    expect(header).toMatch(/^t=\d{10},v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
    // Capture the two hexes — they MUST differ (different secrets, same payload)
    const match = header.match(/v1=([0-9a-f]{64}),v1=([0-9a-f]{64})$/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toBe(match![2]);
  });

  it("sign() with retiring=null produces a single v1 (steady state)", () => {
    const sig = genericHmacAdapter.sign!("body", {
      active: "A",
      retiring: null,
    });
    const header = sig[OUTBOUND_SIGNATURE_HEADER];
    expect(header).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
    // Make sure there is exactly ONE v1 entry, not two.
    expect((header.match(/v1=/g) ?? []).length).toBe(1);
  });

  it("sign() with retiring=undefined behaves identically to null", () => {
    const sig = genericHmacAdapter.sign!("body", { active: "A" });
    const header = sig[OUTBOUND_SIGNATURE_HEADER];
    expect(header).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
    expect((header.match(/v1=/g) ?? []).length).toBe(1);
  });
});

describe("signGenericHmac", () => {
  it("is deterministic when nowFn is fixed (regression lock)", () => {
    const fixedNow = () => 1714000000_000; // 2024-04-25 ish, in ms
    const header = signGenericHmac("body", "secret-A", null, fixedNow);
    // t MUST be in seconds (Math.floor(ms / 1000))
    const expectedHex = createHmac("sha256", "secret-A")
      .update("1714000000.body")
      .digest("hex");
    expect(header).toBe(`t=1714000000,v1=${expectedHex}`);
  });

  it("compound rotation header is also deterministic with fixed nowFn", () => {
    const fixedNow = () => 1714000000_000;
    const header = signGenericHmac("body", "A", "B", fixedNow);
    const expectedActive = createHmac("sha256", "A")
      .update("1714000000.body")
      .digest("hex");
    const expectedRetiring = createHmac("sha256", "B")
      .update("1714000000.body")
      .digest("hex");
    expect(header).toBe(
      `t=1714000000,v1=${expectedActive},v1=${expectedRetiring}`
    );
  });

  it("the t= value is in seconds (10-digit integer, not milliseconds)", () => {
    const sig = genericHmacAdapter.sign!("body", { active: "A" });
    const header = sig[OUTBOUND_SIGNATURE_HEADER];
    // Stripe wire format: 10-digit-or-so seconds, never 13-digit ms.
    expect(/^t=\d{10},v1=[0-9a-f]{64}/.test(header)).toBe(true);
    // Extract the t value and assert it's within plausible seconds range.
    const tMatch = header.match(/^t=(\d+),/);
    expect(tMatch).not.toBeNull();
    const tNum = Number(tMatch![1]);
    // Sanity: must be within +/- 1 day of the Date.now() seconds value
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs(nowSec - tNum)).toBeLessThan(86_400);
  });
});
