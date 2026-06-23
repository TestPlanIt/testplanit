import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In v3 `enhanceWithAudit` is a thin alias for `getAuthDb(user)` — it returns
 * the access-policy-enforced client bound to the acting user (policyClient
 * .$setAuth via getAuthDb). There is no longer an enhance()/$extends step or a
 * raw-vs-hooked base-client distinction (the CDC GUC is set inside the mutation
 * transaction by the side-effects plugin / auditedTransaction). This guards
 * that the alias keeps delegating to getAuthDb so callers stay on the audited,
 * policy-enforced path.
 */
const { getAuthDbMock, authedClient } = vi.hoisted(() => ({
  getAuthDbMock: vi.fn(),
  authedClient: { __id: "authed-client" },
}));

vi.mock("~/lib/zenstack", () => ({
  getAuthDb: getAuthDbMock,
}));

import { enhanceWithAudit } from "./enhanceWithAudit";

describe("enhanceWithAudit", () => {
  beforeEach(() => {
    getAuthDbMock.mockReset();
    getAuthDbMock.mockReturnValue(authedClient);
  });

  it("delegates to getAuthDb with the acting user and returns its client", () => {
    const user = { id: "u1", name: "User One", email: "u1@example.com" };

    const result = enhanceWithAudit(user as never);

    expect(getAuthDbMock).toHaveBeenCalledWith(user);
    expect(result).toBe(authedClient);
  });

  it("maps a null/undefined user to an anonymous (undefined) auth context", () => {
    enhanceWithAudit(null as never);
    expect(getAuthDbMock).toHaveBeenCalledWith(undefined);
  });
});
