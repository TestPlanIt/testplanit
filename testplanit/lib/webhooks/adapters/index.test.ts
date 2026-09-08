import { describe, expect, it, vi } from "vitest";
import type { AdapterType } from "~/zenstack/models";

// Mock the inbound adapters so this test doesn't depend on their real
// implementations (verified separately in their own `*.test.ts` files).
vi.mock("./jira", () => ({
  jiraAdapter: {
    adapterType: "JIRA",
    verify: vi.fn(),
    extractLinkedIssueRef: vi.fn(),
    extractExternalStatus: vi.fn(),
  },
}));

vi.mock("./github", () => ({
  githubAdapter: {
    adapterType: "GITHUB",
    verify: vi.fn(),
    extractLinkedIssueRef: vi.fn(),
    extractExternalStatus: vi.fn(),
  },
}));

vi.mock("./azure-devops", () => ({
  azureDevopsAdapter: {
    adapterType: "AZURE_DEVOPS",
    verify: vi.fn(),
    extractLinkedIssueRef: vi.fn(),
    extractExternalStatus: vi.fn(),
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

  it("returns the GitHub adapter for AdapterType.GITHUB (registry slot filled)", () => {
    const adapter = getAdapter("GITHUB");
    expect(adapter).toBeDefined();
    expect(adapter.adapterType).toBe("GITHUB");
    expect(typeof adapter.verify).toBe("function");
    expect(typeof adapter.extractLinkedIssueRef).toBe("function");
    expect(typeof adapter.extractExternalStatus).toBe("function");
  });

  it("returns the Azure DevOps adapter for AdapterType.AZURE_DEVOPS (registry slot filled)", () => {
    const adapter = getAdapter("AZURE_DEVOPS");
    expect(adapter).toBeDefined();
    expect(adapter.adapterType).toBe("AZURE_DEVOPS");
    expect(typeof adapter.verify).toBe("function");
    expect(typeof adapter.extractLinkedIssueRef).toBe("function");
    expect(typeof adapter.extractExternalStatus).toBe("function");
  });

  it("throws an error containing 'OUTBOUND-only' for AdapterType.SLACK (outbound-only — must never reach inbound receiver)", () => {
    expect(() => getAdapter("SLACK")).toThrowError(/OUTBOUND-only/);
  });

  it("throws an error containing 'OUTBOUND-only' for AdapterType.GENERIC_HMAC (outbound-only — must never reach inbound receiver)", () => {
    expect(() => getAdapter("GENERIC_HMAC")).toThrowError(/OUTBOUND-only/);
  });

  it("throws an error containing 'unknown adapter type' for an unknown AdapterType", () => {
    expect(() => getAdapter("UNKNOWN" as AdapterType)).toThrowError(
      /unknown adapter type/i
    );
  });

  it("ADAPTER_REGISTRY is exhaustive — every AdapterType has a slot, JIRA/GITHUB/AZURE_DEVOPS implemented, SLACK/GENERIC_HMAC are null (LO-05)", () => {
    const registry: Record<AdapterType, WebhookAdapter | null> =
      ADAPTER_REGISTRY;
    expect(registry).toBeDefined();
    expect(registry.JIRA).toBeDefined();
    expect(registry.JIRA?.adapterType).toBe("JIRA");
    // GITHUB + AZURE_DEVOPS are now real adapters (no longer null placeholders).
    expect(registry.GITHUB).toBeDefined();
    expect(registry.GITHUB?.adapterType).toBe("GITHUB");
    expect(registry.AZURE_DEVOPS).toBeDefined();
    expect(registry.AZURE_DEVOPS?.adapterType).toBe("AZURE_DEVOPS");
    // outbound-only adapters: null in the inbound registry; outbound
    // dispatch lives in workers/webhook-dispatch-worker.ts, not here.
    expect(registry.SLACK).toBeNull();
    expect(registry.GENERIC_HMAC).toBeNull();
  });

  it("ADAPTER_REGISTRY exhaustively covers every AdapterType enum value (LO-05 — compile-time + runtime check)", () => {
    // Iterate the literal enum union; if a future AdapterType value lands without
    // a registry slot, this test plus the Record<AdapterType, …> typing trap it.
    const allAdapterTypes: AdapterType[] = [
      "JIRA",
      "GITHUB",
      "AZURE_DEVOPS",
      "SLACK",
      "GENERIC_HMAC",
    ];
    for (const t of allAdapterTypes) {
      // Each slot must be either an adapter (with the right adapterType) or null.
      const slot = ADAPTER_REGISTRY[t];
      if (slot === null) {
        expect(["SLACK", "GENERIC_HMAC"]).toContain(t);
      } else {
        expect(slot.adapterType).toBe(t);
      }
    }
  });
});
