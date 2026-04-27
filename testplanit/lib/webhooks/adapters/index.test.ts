import { describe, expect, it, vi } from "vitest";
import type { AdapterType } from "@prisma/client";

// Mock the jira adapter so this test doesn't depend on its real implementation
// (which is verified separately in jira.test.ts).
vi.mock("./jira", () => ({
  jiraAdapter: {
    adapterType: "JIRA",
    verify: vi.fn(),
  },
}));

import { ADAPTER_REGISTRY, getAdapter } from "./index";
import type { WebhookAdapter } from "./types";

describe("getAdapter / ADAPTER_REGISTRY", () => {
  it("returns the Jira adapter for AdapterType.JIRA with adapterType='JIRA' and a verify function", () => {
    const adapter = getAdapter("JIRA");
    expect(adapter).toBeDefined();
    expect(adapter.adapterType).toBe("JIRA");
    expect(typeof adapter.verify).toBe("function");
  });

  it("throws an error containing 'not implemented' for AdapterType.GITHUB (Phase 3 placeholder)", () => {
    expect(() => getAdapter("GITHUB")).toThrowError(/not implemented/i);
  });

  it("throws an error containing 'not implemented' for AdapterType.AZURE_DEVOPS (Phase 3 placeholder)", () => {
    expect(() => getAdapter("AZURE_DEVOPS")).toThrowError(/not implemented/i);
  });

  it("throws an error containing 'OUTBOUND-only' for AdapterType.SLACK (Phase 2 outbound-only — must never reach inbound receiver)", () => {
    expect(() => getAdapter("SLACK")).toThrowError(/OUTBOUND-only/);
  });

  it("throws an error containing 'OUTBOUND-only' for AdapterType.GENERIC_HMAC (Phase 2 outbound-only — must never reach inbound receiver)", () => {
    expect(() => getAdapter("GENERIC_HMAC")).toThrowError(/OUTBOUND-only/);
  });

  it("throws an error containing 'unknown adapter type' for an unknown AdapterType", () => {
    expect(() => getAdapter("UNKNOWN" as AdapterType)).toThrowError(
      /unknown adapter type/i
    );
  });

  it("ADAPTER_REGISTRY is exhaustive — every AdapterType has a slot, JIRA is implemented, others are null placeholders (LO-05)", () => {
    const registry: Record<AdapterType, WebhookAdapter | null> =
      ADAPTER_REGISTRY;
    expect(registry).toBeDefined();
    expect(registry.JIRA).toBeDefined();
    expect(registry.JIRA?.adapterType).toBe("JIRA");
    // Phase 3 adapters are explicit null placeholders (not undefined) so a
    // future AdapterType enum value forces a compile-time decision here.
    expect(registry.GITHUB).toBeNull();
    expect(registry.AZURE_DEVOPS).toBeNull();
    // Phase 2 outbound-only adapters: null in the inbound registry; outbound
    // dispatch lives in workers/webhook-dispatch-worker.ts, not here.
    expect(registry.SLACK).toBeNull();
    expect(registry.GENERIC_HMAC).toBeNull();
  });
});
