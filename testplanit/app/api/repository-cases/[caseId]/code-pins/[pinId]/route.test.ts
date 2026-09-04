import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("~/lib/utils/errors", () => ({
  isAccessPolicyError: vi.fn(),
}));

vi.mock("~/lib/services/impact/repoAccess", () => ({
  loadRepoConfigForUser: vi.fn(),
}));

vi.mock("~/lib/services/impact/codePins", async (importOriginal) => ({
  // Schema and field rules stay real; only the network-bound anchor is mocked.
  ...(await importOriginal<typeof import("~/lib/services/impact/codePins")>()),
  anchorPin: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { anchorPin, PinAnchorError } from "~/lib/services/impact/codePins";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { DELETE, PATCH } from "./route";

const session = { user: { id: "user-1" } };

function makeDb() {
  return {
    repositoryCaseCodePin: {
      findFirst: vi.fn().mockResolvedValue({ id: 7, source: "MANUAL" }),
      update: vi.fn().mockResolvedValue({ id: 7 }),
    },
  };
}

const req = new NextRequest(
  "http://localhost/api/repository-cases/100/code-pins/7",
  { method: "DELETE" }
);

function makeParams(caseId = "100", pinId = "7") {
  return { params: Promise.resolve({ caseId, pinId }) };
}

describe("DELETE /api/repository-cases/[caseId]/code-pins/[pinId]", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    (getServerSession as any).mockResolvedValue(session);
    (getEnhancedDb as any).mockResolvedValue(db);
    (isAccessPolicyError as any).mockReturnValue(false);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await DELETE(req, makeParams());

    expect(res.status).toBe(401);
    expect(getEnhancedDb).not.toHaveBeenCalled();
  });

  it("returns 400 when either id is not an integer", async () => {
    expect((await DELETE(req, makeParams("abc", "7"))).status).toBe(400);
    expect((await DELETE(req, makeParams("100", "7.5"))).status).toBe(400);
    expect(db.repositoryCaseCodePin.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the pin is not live on this case", async () => {
    db.repositoryCaseCodePin.findFirst.mockResolvedValue(null);

    const res = await DELETE(req, makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Pin not found" });
    expect(db.repositoryCaseCodePin.findFirst).toHaveBeenCalledWith({
      where: { id: 7, caseId: 100, isDeleted: false },
      select: { id: true, source: true },
    });
    expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
  });

  it.each(["ANNOTATION", "MAPFILE"])(
    "returns 409 'managed' for a repository-owned %s pin",
    async (source) => {
      db.repositoryCaseCodePin.findFirst.mockResolvedValue({ id: 7, source });

      const res = await DELETE(req, makeParams());

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "Pin is managed by the repository",
        code: "managed",
      });
      expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
    }
  );

  it.each(["MANUAL", "AI"])(
    "soft-deletes a %s pin by setting isDeleted and deletedAt",
    async (source) => {
      db.repositoryCaseCodePin.findFirst.mockResolvedValue({ id: 7, source });

      const res = await DELETE(req, makeParams());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(db.repositoryCaseCodePin.update).toHaveBeenCalledTimes(1);
      const args = db.repositoryCaseCodePin.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 7 });
      expect(args.data.isDeleted).toBe(true);
      expect(args.data.deletedAt).toBeInstanceOf(Date);
    }
  );

  it("returns 403 when the update is rejected by policy", async () => {
    db.repositoryCaseCodePin.update.mockRejectedValue(new Error("denied"));
    (isAccessPolicyError as any).mockReturnValue(true);

    const res = await DELETE(req, makeParams());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 500 for any other failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.repositoryCaseCodePin.update.mockRejectedValue(new Error("db down"));

    const res = await DELETE(req, makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to delete code pin" });
  });
});

describe("PATCH /api/repository-cases/[caseId]/code-pins/[pinId]", () => {
  let db: ReturnType<typeof makeDb>;

  const RANGE_PIN = {
    id: 7,
    configId: 5,
    kind: "RANGE",
    filePath: "src/checkout.ts",
    startLine: 30,
    endLine: 64,
    symbol: null,
    source: "MANUAL",
  };

  function patchReq(body: unknown) {
    return new NextRequest(
      "http://localhost/api/repository-cases/100/code-pins/7",
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }
    );
  }

  /**
   * The handler reads the pin, then probes for a duplicate excluding itself.
   * The mock ignores the where clause, so the probe is answered separately.
   */
  function givePin(pin: Record<string, unknown> = RANGE_PIN) {
    db.repositoryCaseCodePin.findFirst
      .mockReset()
      .mockResolvedValueOnce(pin)
      .mockResolvedValue(null);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    givePin();
    (getServerSession as any).mockResolvedValue(session);
    (getEnhancedDb as any).mockResolvedValue(db);
    (isAccessPolicyError as any).mockReturnValue(false);
    (loadRepoConfigForUser as any).mockResolvedValue({
      config: { id: 5, projectId: 3 },
      adapter: {},
    });
    (anchorPin as any).mockResolvedValue({
      anchorSha: "sha2",
      anchorSnippet: "snippet",
      anchorHash: "hash2",
      startLine: 30,
      endLine: 70,
    });
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    expect((await PATCH(patchReq({ note: "x" }), makeParams())).status).toBe(
      401
    );
  });

  it("rejects a patch that would change the kind or the file", async () => {
    const res = await PATCH(
      patchReq({ kind: "FILE", filePath: "src/other.ts" }),
      makeParams()
    );

    expect(res.status).toBe(400);
    expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
  });

  it("rejects a field the kind does not own", async () => {
    const res = await PATCH(patchReq({ symbol: "chargeCard" }), makeParams());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Cannot change symbol on a RANGE pin",
      code: "field_not_editable",
    });
    expect(anchorPin).not.toHaveBeenCalled();
  });

  it.each(["ANNOTATION", "MAPFILE"])(
    "returns 409 'managed' for a repository-owned %s pin",
    async (source) => {
      givePin({ ...RANGE_PIN, source });

      const res = await PATCH(patchReq({ note: "mine now" }), makeParams());

      expect(res.status).toBe(409);
      expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
    }
  );

  it("edits the note without touching the anchor", async () => {
    const res = await PATCH(patchReq({ note: "clearer note" }), makeParams());

    expect(res.status).toBe(200);
    expect(anchorPin).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.update.mock.calls[0][0].data).toEqual({
      note: "clearer note",
    });
  });

  it("clears the note when it is emptied", async () => {
    await PATCH(patchReq({ note: "" }), makeParams());

    expect(db.repositoryCaseCodePin.update.mock.calls[0][0].data).toEqual({
      note: null,
    });
  });

  it("re-anchors a moved range and drops the stale dismissal", async () => {
    const res = await PATCH(
      patchReq({ startLine: 30, endLine: 70 }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(anchorPin).toHaveBeenCalledWith(
      { id: 5, projectId: 3 },
      {},
      expect.objectContaining({
        kind: "RANGE",
        filePath: "src/checkout.ts",
        startLine: 30,
        endLine: 70,
      })
    );
    expect(db.repositoryCaseCodePin.update.mock.calls[0][0].data).toMatchObject(
      {
        startLine: 30,
        endLine: 70,
        anchorSha: "sha2",
        anchorHash: "hash2",
        staleDismissedAt: null,
      }
    );
  });

  it("treats a new start with no end as a single line", async () => {
    await PATCH(patchReq({ startLine: 42 }), makeParams());

    expect(anchorPin).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ startLine: 42, endLine: undefined })
    );
  });

  it("rejects an inverted range", async () => {
    const res = await PATCH(
      patchReq({ startLine: 80, endLine: 20 }),
      makeParams()
    );

    expect(res.status).toBe(400);
    expect(anchorPin).not.toHaveBeenCalled();
  });

  it("maps an anchor failure to 422", async () => {
    (anchorPin as any).mockRejectedValue(
      new PinAnchorError("line_out_of_range", "File has 40 lines")
    );

    const res = await PATCH(patchReq({ startLine: 90 }), makeParams());

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "File has 40 lines",
      code: "line_out_of_range",
    });
  });

  it("returns 409 when the edit duplicates another pin on the case", async () => {
    db.repositoryCaseCodePin.findFirst
      .mockReset()
      .mockResolvedValueOnce(RANGE_PIN)
      .mockResolvedValueOnce({ id: 9 });

    const res = await PATCH(patchReq({ startLine: 30 }), makeParams());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Pin already exists", id: 9 });
    expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
  });

  it("edits a glob pattern, which is all a GLOB pin points at", async () => {
    givePin({
      ...RANGE_PIN,
      kind: "GLOB",
      filePath: "src/payments/**",
      startLine: null,
      endLine: null,
    });
    (anchorPin as any).mockResolvedValue({
      anchorSha: null,
      anchorSnippet: null,
      anchorHash: null,
      startLine: null,
      endLine: null,
    });

    const res = await PATCH(
      patchReq({ filePath: "src/billing/**" }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(db.repositoryCaseCodePin.update.mock.calls[0][0].data).toMatchObject(
      {
        filePath: "src/billing/**",
      }
    );
  });

  it("returns 403 when policy rejects the update", async () => {
    db.repositoryCaseCodePin.update.mockRejectedValue(new Error("denied"));
    (isAccessPolicyError as any).mockReturnValue(true);

    const res = await PATCH(patchReq({ note: "x" }), makeParams());

    expect(res.status).toBe(403);
  });
});
