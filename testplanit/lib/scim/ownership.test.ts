import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(async () => {}),
}));

import { captureAuditEvent } from "~/lib/services/auditLog";

import {
  ScimOwnershipError,
  assertScimWriteOwnership,
  scimOwnershipReadFilter,
} from "./ownership";

import type { ScimAuthContext } from "./auth";

const OKTA_CTX: ScimAuthContext = {
  tokenId: "tok_okta_1",
  systemUserId: "system-scim-user",
  idpName: "OKTA",
};

const ENTRA_CTX: ScimAuthContext = {
  tokenId: "tok_entra_1",
  systemUserId: "system-scim-user",
  idpName: "ENTRA",
};

function makeTx(owner: { idpName: string } | null) {
  return {
    scimToken: {
      findUnique: vi.fn(async () => owner),
    },
  } as never;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("assertScimWriteOwnership", () => {
  it("O1: allows a write to an unowned row without any token lookup", async () => {
    const tx = makeTx(null);

    await expect(
      assertScimWriteOwnership(tx, "User", "user_1", null, OKTA_CTX)
    ).resolves.toBeUndefined();

    expect(
      (tx as unknown as { scimToken: { findUnique: ReturnType<typeof vi.fn> } })
        .scimToken.findUnique
    ).not.toHaveBeenCalled();
  });

  it("O2: treats an undefined owner (column not selected) as unowned", async () => {
    const tx = makeTx(null);

    await expect(
      assertScimWriteOwnership(
        tx,
        "User",
        "user_1",
        undefined as unknown as null,
        OKTA_CTX
      )
    ).resolves.toBeUndefined();
  });

  it("O3: allows the token that already owns the row", async () => {
    const tx = makeTx(null);

    await expect(
      assertScimWriteOwnership(tx, "User", "user_1", "tok_okta_1", OKTA_CTX)
    ).resolves.toBeUndefined();
  });

  it("O4: allows a DIFFERENT token for the same IdP — revoke + mint rotation must not lock a directory out", async () => {
    const tx = makeTx({ idpName: "OKTA" });

    await expect(
      assertScimWriteOwnership(tx, "User", "user_1", "tok_okta_old", OKTA_CTX)
    ).resolves.toBeUndefined();
    expect(captureAuditEvent).not.toHaveBeenCalled();
  });

  it("O5: refuses a write from a different IdP", async () => {
    const tx = makeTx({ idpName: "OKTA" });

    await expect(
      assertScimWriteOwnership(tx, "User", "user_1", "tok_okta_1", ENTRA_CTX)
    ).rejects.toBeInstanceOf(ScimOwnershipError);
  });

  it("O6: records a conflict-log audit row before refusing", async () => {
    const tx = makeTx({ idpName: "OKTA" });

    await expect(
      assertScimWriteOwnership(tx, "Group", "42", "tok_okta_1", ENTRA_CTX)
    ).rejects.toBeInstanceOf(ScimOwnershipError);

    expect(captureAuditEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(captureAuditEvent).mock.calls[0][0];
    expect(event.entityType).toBe("Groups");
    expect(event.entityId).toBe("42");
    expect(event.metadata).toMatchObject({
      scimTokenConflict: true,
      scimTokenId: "tok_entra_1",
      scimOwnerIdpName: "OKTA",
      scimRequestingIdpName: "ENTRA",
    });
  });

  it("O7: carries the owning IdP on the thrown error for the 409 detail", async () => {
    const tx = makeTx({ idpName: "OKTA" });

    const err = await assertScimWriteOwnership(
      tx,
      "User",
      "user_1",
      "tok_okta_1",
      ENTRA_CTX
    ).then(
      () => null,
      (e: unknown) => e as ScimOwnershipError
    );

    expect(err).toBeInstanceOf(ScimOwnershipError);
    expect(err!.ownerIdpName).toBe("OKTA");
    expect(err!.resourceType).toBe("User");
    expect(err!.message).toContain("OKTA");
  });

  it("O8: a dangling owner id leaves the row writable rather than permanently stuck", async () => {
    const tx = makeTx(null);

    await expect(
      assertScimWriteOwnership(tx, "User", "user_1", "tok_deleted", ENTRA_CTX)
    ).resolves.toBeUndefined();
  });
});

describe("scimOwnershipReadFilter", () => {
  it("O9: matches unowned rows and rows owned by the caller's IdP", () => {
    expect(scimOwnershipReadFilter(OKTA_CTX)).toEqual({
      OR: [{ scimTokenId: null }, { scimToken: { idpName: "OKTA" } }],
    });
  });

  it("O10: scopes by IdP, not by token id, so a rotated token still reads its directory", () => {
    const filter = scimOwnershipReadFilter(OKTA_CTX);
    expect(JSON.stringify(filter)).not.toContain("tok_okta_1");
  });
});
