import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Shared mock fns (hoisted so the vi.mock factories can reference them).
const {
  getServerSessionMock,
  userFindUniqueMock,
  integrationUpdateMock,
  integrationFindUniqueMock,
  encryptMock,
  decryptMock,
  clearAdapterMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  integrationUpdateMock: vi.fn(),
  integrationFindUniqueMock: vi.fn(),
  encryptMock: vi.fn(),
  decryptMock: vi.fn(),
  clearAdapterMock: vi.fn(),
}));

vi.mock("next-auth/next", () => ({ getServerSession: getServerSessionMock }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
// withAuditContext just wraps the handler — pass it straight through.
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (fn: any) => fn,
}));
vi.mock("@/lib/db", () => ({
  baseDb: {
    user: { findUnique: userFindUniqueMock },
    integration: {
      update: integrationUpdateMock,
      findUnique: integrationFindUniqueMock,
    },
  },
}));
vi.mock("@/utils/encryption", () => ({
  encrypt: encryptMock,
  decrypt: decryptMock,
}));
vi.mock("~/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: () => ({ clearAdapter: clearAdapterMock }),
  },
}));

import { DELETE, PUT } from "./route";

const params = { params: Promise.resolve({ id: "3" }) };

describe("integration write routes invalidate the adapter cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    userFindUniqueMock.mockResolvedValue({ access: "ADMIN" });
    encryptMock.mockResolvedValue("encrypted-blob");
    integrationUpdateMock.mockResolvedValue({ id: 3 });
  });

  it("PUT clears the cached adapter after updating OAuth credentials", async () => {
    const request = new NextRequest("http://localhost:3000/api/integrations/3", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        credentials: { clientId: "new-client", clientSecret: "new-secret" },
      }),
    });

    const response = await PUT(request, params);

    expect(response.status).toBe(200);
    // The whole point of the fix: a credential edit must evict the in-memory
    // adapter so the authorize URL stops emitting the stale client_id.
    expect(clearAdapterMock).toHaveBeenCalledWith("3");
  });

  it("DELETE clears the cached adapter after a soft delete", async () => {
    integrationFindUniqueMock.mockResolvedValue({
      id: 3,
      _count: { projectIntegrations: 0 },
    });
    const request = new NextRequest("http://localhost:3000/api/integrations/3", {
      method: "DELETE",
    });

    const response = await DELETE(request, params);

    expect(response.status).toBe(200);
    expect(clearAdapterMock).toHaveBeenCalledWith("3");
  });

  it("PUT does not touch the cache for a non-admin (403 before any write)", async () => {
    userFindUniqueMock.mockResolvedValue({ access: "MEMBER" });
    const request = new NextRequest("http://localhost:3000/api/integrations/3", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });

    const response = await PUT(request, params);

    expect(response.status).toBe(403);
    expect(integrationUpdateMock).not.toHaveBeenCalled();
    expect(clearAdapterMock).not.toHaveBeenCalled();
  });
});
