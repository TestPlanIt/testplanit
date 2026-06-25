import { beforeEach, describe, expect, it, vi } from "vitest";

// This suite exercises the REAL withTenantContext wrapper (not the passthrough
// stub used in webhookDispatchWorker.test.ts) so it can assert the key-fetch
// behaviour of the queue-level `dispatch` wrapper. The seam under test:
// retire-expired-secrets must bypass the tenant ENCRYPTION_KEY fetch, while
// ordinary dispatch jobs must still trigger it.

const mockGetTenantEncryptionKey = vi.fn().mockResolvedValue("test-key");
vi.mock("../lib/tenantSecrets", () => ({
  getTenantEncryptionKey: (...args: unknown[]) =>
    mockGetTenantEncryptionKey(...args),
}));

vi.mock("../lib/multiTenantDb", () => ({
  validateMultiTenantJobData: vi.fn(),
  getDbClientForJob: vi.fn().mockReturnValue({ __mock: "db" }),
  isMultiTenantMode: vi.fn().mockReturnValue(false),
  disconnectAllTenantClients: vi.fn().mockResolvedValue(undefined),
}));

const mockDispatchWebhook = vi.fn().mockResolvedValue({
  outcome: "success",
  statusCode: 200,
  deliveryId: "d1",
});
vi.mock("../lib/webhooks/dispatch", () => ({
  dispatchWebhook: (...args: unknown[]) => mockDispatchWebhook(...args),
}));

const mockRetireExpiredSecrets = vi.fn().mockResolvedValue({ retiredCount: 0 });
vi.mock("../lib/webhooks/secret-rotation", () => ({
  retireExpiredSecrets: (...args: unknown[]) =>
    mockRetireExpiredSecrets(...args),
}));

vi.mock("../lib/webhooks/health", () => ({
  transition: vi.fn().mockResolvedValue({ from: "HEALTHY", to: "HEALTHY" }),
}));

vi.mock("../lib/valkey", () => ({ default: null }));

// NOTE: ../lib/tenantContext is intentionally NOT mocked — we want the real
// runWithTenantContext → getTenantEncryptionKey path.

import { dispatch } from "./webhookDispatchWorker";

function buildJob(opts: {
  name?: string;
  tenantId?: string;
  data?: Record<string, unknown>;
}) {
  return {
    id: "job-1",
    name: opts.name,
    attemptsMade: 0,
    data: opts.data ?? { tenantId: opts.tenantId },
  } as any;
}

describe("webhookDispatchWorker.dispatch — tenant key-fetch routing", () => {
  beforeEach(() => {
    mockGetTenantEncryptionKey.mockClear();
    mockDispatchWebhook.mockClear();
    mockRetireExpiredSecrets.mockClear();
  });

  it("retire-expired-secrets job does NOT fetch the tenant encryption key (the K8s secrets call that fails/retries for unprovisioned tenants)", async () => {
    const job = buildJob({
      name: "retire-expired-secrets",
      tenantId: "tenant-A",
    });

    await dispatch(job);

    expect(mockGetTenantEncryptionKey).not.toHaveBeenCalled();
    expect(mockRetireExpiredSecrets).toHaveBeenCalledTimes(1);
    expect(mockDispatchWebhook).not.toHaveBeenCalled();
  });

  it("ordinary dispatch job DOES fetch the tenant encryption key via withTenantContext", async () => {
    const job = buildJob({
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "c1",
        attempt: 1,
        tenantId: "tenant-A",
      },
    });

    await dispatch(job);

    expect(mockGetTenantEncryptionKey).toHaveBeenCalledTimes(1);
    expect(mockGetTenantEncryptionKey).toHaveBeenCalledWith("tenant-A");
    expect(mockDispatchWebhook).toHaveBeenCalledTimes(1);
  });
});
