import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock state (vi.mock factories run before top-level consts exist).
const {
  scopeMock,
  publishMock,
  subscribeMock,
  onMock,
  subscriberHandlers,
  subscribedChannels,
  findUniqueMock,
} = vi.hoisted(() => {
  // Persistent (not a mock call record, so it survives vi.clearAllMocks) —
  // construction happens once on the first getInstance(), before any test body.
  const subscriberHandlers: Record<string, (...args: any[]) => void> = {};
  const subscribedChannels: string[] = [];
  return {
    scopeMock: vi.fn(() => "default"),
    publishMock: vi.fn().mockResolvedValue(1),
    subscribeMock: vi.fn((channel: string) => {
      subscribedChannels.push(channel);
      return Promise.resolve(1);
    }),
    onMock: vi.fn((event: string, handler: (...a: any[]) => void) => {
      subscriberHandlers[event] = handler;
    }),
    subscriberHandlers,
    subscribedChannels,
    findUniqueMock: vi.fn(),
  };
});

vi.mock("@/lib/rawDb", () => ({
  rawDb: { integration: { findUnique: findUniqueMock } },
}));
// Identity crypto: fixtures store credential values verbatim, so these tests
// exercise cache scoping rather than the cipher.
vi.mock("@/utils/encryption", () => ({
  EncryptionService: { decrypt: vi.fn((e: string) => e) },
  getMasterKey: vi.fn(() => "test-master-key"),
  decrypt: vi.fn(async (e: string) => e),
  isEncrypted: vi.fn(() => true),
}));
vi.mock("./AuthenticationService", () => ({
  AuthenticationService: { storeUserAuth: vi.fn() },
}));
// Drive the tenant scope explicitly per test.
vi.mock("@/lib/tenantContext", () => ({
  currentTenantScope: scopeMock,
  getTenantContext: () => undefined,
}));
// Fake Valkey: a publisher and a subscriber whose handlers we can invoke.
vi.mock("@/lib/valkey", () => ({
  default: { publish: publishMock },
  createSubscriberClient: () => ({ on: onMock, subscribe: subscribeMock }),
}));

import { IntegrationManager } from "./IntegrationManager";

const CHANNEL = "integration:adapter:invalidate";

// A minimal API-key Jira integration — no OAuth token refresh to stub.
const integration = {
  id: 1,
  name: "Test Jira",
  provider: "JIRA",
  status: "ACTIVE",
  authType: "API_KEY",
  credentials: { email: "test@example.com", apiToken: "test-token" },
  settings: { baseUrl: "https://test.atlassian.net" },
  userIntegrationAuths: [],
};

describe("IntegrationManager cross-tenant / cross-process cache", () => {
  let manager: IntegrationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    scopeMock.mockReturnValue("default");
    findUniqueMock.mockResolvedValue(integration);
    // adapter.authenticate() may probe the API; keep it offline.
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    manager = IntegrationManager.getInstance();
    manager.clearAllAdapters();
  });

  it("subscribes to the invalidation channel on construction", () => {
    // The singleton is built once; the subscription is wired in its ctor.
    // (subscribedChannels is persistent — clearAllMocks would wipe a spy's
    // call record before this assertion runs.)
    expect(subscribedChannels).toContain(CHANNEL);
    expect(typeof subscriberHandlers["message"]).toBe("function");
  });

  it("keeps separate tenants' adapters from colliding on the same id", async () => {
    scopeMock.mockReturnValue("tenant-a");
    const a = await manager.getAdapter("1");

    scopeMock.mockReturnValue("tenant-b");
    const b = await manager.getAdapter("1");

    // Same integration id, different tenants → must be different instances.
    expect(b).not.toBe(a);

    // Tenant A's entry is untouched by tenant B's build.
    scopeMock.mockReturnValue("tenant-a");
    expect(await manager.getAdapter("1")).toBe(a);
  });

  it("clearAdapter evicts only the current tenant and broadcasts it", async () => {
    scopeMock.mockReturnValue("tenant-a");
    const a = await manager.getAdapter("1");
    scopeMock.mockReturnValue("tenant-b");
    const b = await manager.getAdapter("1");

    scopeMock.mockReturnValue("tenant-a");
    manager.clearAdapter("1");

    // Broadcast carries the tenant so other processes evict the right scope.
    expect(publishMock).toHaveBeenCalledWith(
      CHANNEL,
      JSON.stringify({ tenantId: "tenant-a", integrationId: "1" })
    );

    // Tenant A rebuilt, tenant B left intact.
    expect(await manager.getAdapter("1")).not.toBe(a);
    scopeMock.mockReturnValue("tenant-b");
    expect(await manager.getAdapter("1")).toBe(b);
  });

  it("evicts locally when a remote invalidation message arrives (no re-publish)", async () => {
    scopeMock.mockReturnValue("tenant-b");
    const b = await manager.getAdapter("1");

    // Simulate the message another pod published for tenant-b.
    subscriberHandlers["message"](
      CHANNEL,
      JSON.stringify({ tenantId: "tenant-b", integrationId: "1" })
    );

    // Applying a received broadcast must not itself re-publish (loop guard).
    expect(publishMock).not.toHaveBeenCalled();

    // The cached adapter was evicted, so the next get rebuilds.
    expect(await manager.getAdapter("1")).not.toBe(b);
  });

  it("ignores invalidations for a different tenant", async () => {
    scopeMock.mockReturnValue("tenant-b");
    const b = await manager.getAdapter("1");

    subscriberHandlers["message"](
      CHANNEL,
      JSON.stringify({ tenantId: "tenant-a", integrationId: "1" })
    );

    // tenant-b's entry survives an invalidation aimed at tenant-a.
    expect(await manager.getAdapter("1")).toBe(b);
  });

  it("swallows malformed invalidation messages", async () => {
    scopeMock.mockReturnValue("tenant-b");
    const b = await manager.getAdapter("1");

    expect(() =>
      subscriberHandlers["message"](CHANNEL, "not json {{")
    ).not.toThrow();

    expect(await manager.getAdapter("1")).toBe(b);
  });
});
