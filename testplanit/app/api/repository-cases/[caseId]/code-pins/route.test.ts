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

vi.mock("~/lib/services/impact/repoAccess", () => ({
  loadRepoConfigForUser: vi.fn(),
}));

// The schema and PinAnchorError stay real (the route validates with the
// schema and matches on the error class); the two I/O operations are stubbed.
vi.mock("~/lib/services/impact/codePins", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/impact/codePins")>();
  return {
    ...actual,
    anchorPin: vi.fn(),
    computePinStaleness: vi.fn(),
  };
});

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {},
}));

vi.mock("~/lib/utils/errors", () => ({
  isAccessPolicyError: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import {
  anchorPin,
  computePinStaleness,
  PinAnchorError,
} from "~/lib/services/impact/codePins";
import { RefNotFoundError } from "~/lib/services/impact/compareService";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { GET, POST } from "./route";

const SHA = "e".repeat(40);
const session = { user: { id: "user-1" } };

const loaded = {
  config: {
    id: 5,
    projectId: 3,
    purpose: "IMPACT",
    branch: "main",
    cacheEnabled: true,
    repositoryId: 9,
    repository: { id: 9, name: "acme/app", provider: "github", settings: null },
  },
  adapter: { kind: "adapter" },
};

function makeDb() {
  return {
    repositoryCaseCodePin: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    repositoryCases: {
      findFirst: vi.fn().mockResolvedValue({ id: 100 }),
    },
  };
}

function pinRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    caseId: 100,
    configId: 5,
    kind: "RANGE",
    filePath: "src/a.ts",
    startLine: 3,
    endLine: 5,
    symbol: null,
    anchorSha: SHA,
    anchorSnippet: "x",
    source: "MANUAL",
    note: null,
    staleDismissedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: { id: "user-1", name: "Tester" },
    ...over,
  };
}

function getRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/repository-cases/100/code-pins");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function postRequest(body: unknown) {
  return new NextRequest(
    "http://localhost/api/repository-cases/100/code-pins",
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

function makeParams(caseId = "100") {
  return { params: Promise.resolve({ caseId }) };
}

const validBody = {
  configId: 5,
  kind: "RANGE",
  filePath: "src/a.ts",
  startLine: 3,
  endLine: 5,
  note: "login flow",
};

const anchor = {
  anchorSha: SHA,
  anchorSnippet: "line3\nline4\nline5",
  anchorHash: "abc123",
  startLine: 3,
  endLine: 5,
};

describe("GET /api/repository-cases/[caseId]/code-pins", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    (getServerSession as any).mockResolvedValue(session);
    (getEnhancedDb as any).mockResolvedValue(db);
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);
    (computePinStaleness as any).mockResolvedValue(new Map());
    (isAccessPolicyError as any).mockReturnValue(false);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(401);
    expect(getEnhancedDb).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5"])(
    "returns 400 for the invalid case id %s",
    async (caseId) => {
      const res = await GET(getRequest(), makeParams(caseId));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid case ID" });
    }
  );

  it("returns live pins with their staleness attached", async () => {
    const pins = [pinRow({ id: 1 }), pinRow({ id: 2, filePath: "src/b.ts" })];
    db.repositoryCaseCodePin.findMany.mockResolvedValue(pins);
    const stale = {
      stale: true,
      staleReason: "SNIPPET_NOT_FOUND",
      staleDismissed: false,
      checkedSha: SHA,
    };
    (computePinStaleness as any).mockResolvedValue(new Map([[2, stale]]));

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stalenessError).toBeNull();
    expect(json.pins).toHaveLength(2);
    expect(json.pins[0]).toMatchObject({ id: 1, staleness: null });
    expect(json.pins[1]).toMatchObject({ id: 2, staleness: stale });

    expect(db.repositoryCaseCodePin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { caseId: 100, isDeleted: false } })
    );
    expect(loadRepoConfigForUser).toHaveBeenCalledWith(session, 5, {
      purpose: "IMPACT",
    });
    expect(computePinStaleness).toHaveBeenCalledWith(
      loaded.config,
      loaded.adapter,
      pins
    );
  });

  it("reports stalenessError and still returns the pins when the check throws", async () => {
    db.repositoryCaseCodePin.findMany.mockResolvedValue([pinRow()]);
    (computePinStaleness as any).mockRejectedValue(
      new Error("GitHub API error: 503")
    );

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stalenessError).toBe("GitHub API error: 503");
    expect(json.pins[0].staleness).toBeNull();
  });

  it("reports stalenessError when the config load throws", async () => {
    db.repositoryCaseCodePin.findMany.mockResolvedValue([pinRow()]);
    (loadRepoConfigForUser as any).mockRejectedValue(
      new Error("creds corrupt")
    );

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(200);
    expect((await res.json()).stalenessError).toBe("creds corrupt");
    expect(computePinStaleness).not.toHaveBeenCalled();
  });

  it("skips the staleness check entirely with ?staleness=0", async () => {
    db.repositoryCaseCodePin.findMany.mockResolvedValue([pinRow()]);

    const res = await GET(getRequest({ staleness: "0" }), makeParams());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pins[0].staleness).toBeNull();
    expect(json.stalenessError).toBeNull();
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
    expect(computePinStaleness).not.toHaveBeenCalled();
  });

  it("skips the staleness check when the case has no pins", async () => {
    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pins: [], stalenessError: null });
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("leaves pins unmarked when the config is no longer visible", async () => {
    db.repositoryCaseCodePin.findMany.mockResolvedValue([pinRow()]);
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pins[0].staleness).toBeNull();
    expect(json.stalenessError).toBeNull();
    expect(computePinStaleness).not.toHaveBeenCalled();
  });

  it("returns 500 when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.repositoryCaseCodePin.findMany.mockRejectedValue(new Error("db down"));

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to load code pins" });
  });
});

describe("POST /api/repository-cases/[caseId]/code-pins", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    (getServerSession as any).mockResolvedValue(session);
    (getEnhancedDb as any).mockResolvedValue(db);
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);
    (anchorPin as any).mockResolvedValue(anchor);
    (isAccessPolicyError as any).mockReturnValue(false);
    db.repositoryCaseCodePin.create.mockImplementation(async (args: any) =>
      pinRow({ id: 55, ...args.data })
    );
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid case id", async () => {
    const res = await POST(postRequest(validBody), makeParams("nope"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid case ID" });
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await POST(postRequest("{not json"), makeParams());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request body" });
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("returns 400 with details when the body fails the schema", async () => {
    const res = await POST(
      postRequest({ configId: 5, kind: "RANGE", filePath: "src/a.ts" }),
      makeParams()
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request body");
    expect(
      json.details.some((i: any) => i.path.join(".") === "startLine")
    ).toBe(true);
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("returns 404 when no Impact config is visible for configId", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Impact repository not configured",
    });
    expect(loadRepoConfigForUser).toHaveBeenCalledWith(session, 5, {
      purpose: "IMPACT",
    });
    expect(anchorPin).not.toHaveBeenCalled();
  });

  it("returns 404 when the case is not in the config's project", async () => {
    db.repositoryCases.findFirst.mockResolvedValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Case not found" });
    expect(db.repositoryCases.findFirst).toHaveBeenCalledWith({
      where: { id: 100, projectId: 3, isDeleted: false },
      select: { id: true },
    });
    expect(anchorPin).not.toHaveBeenCalled();
  });

  it("returns 422 with the anchor error code", async () => {
    (anchorPin as any).mockRejectedValue(
      new PinAnchorError("line_out_of_range", "File has 3 lines")
    );

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "File has 3 lines",
      code: "line_out_of_range",
    });
    expect(db.repositoryCaseCodePin.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the anchor ref does not exist", async () => {
    (anchorPin as any).mockRejectedValue(new RefNotFoundError("ghost"));

    const res = await POST(
      postRequest({ ...validBody, ref: "ghost" }),
      makeParams()
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Ref not found: ghost" });
  });

  it("returns 409 with the existing id on a duplicate pin", async () => {
    db.repositoryCaseCodePin.findFirst.mockResolvedValue({ id: 7 });

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Pin already exists", id: 7 });
    // The duplicate check uses the server-computed anchor lines, not the input.
    expect(db.repositoryCaseCodePin.findFirst).toHaveBeenCalledWith({
      where: {
        caseId: 100,
        configId: 5,
        kind: "RANGE",
        filePath: "src/a.ts",
        startLine: 3,
        endLine: 5,
        symbol: null,
        isDeleted: false,
      },
      select: { id: true },
    });
    expect(db.repositoryCaseCodePin.create).not.toHaveBeenCalled();
  });

  it("returns 201 with a MANUAL pin stamped with the anchor and the session user", async () => {
    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.pin).toMatchObject({ id: 55, source: "MANUAL" });

    expect(anchorPin).toHaveBeenCalledWith(
      loaded.config,
      loaded.adapter,
      expect.objectContaining({
        kind: "RANGE",
        filePath: "src/a.ts",
        startLine: 3,
        endLine: 5,
      })
    );
    const createArgs = db.repositoryCaseCodePin.create.mock.calls[0][0];
    expect(createArgs.data).toEqual({
      caseId: 100,
      configId: 5,
      kind: "RANGE",
      filePath: "src/a.ts",
      startLine: 3,
      endLine: 5,
      symbol: null,
      anchorSha: SHA,
      anchorSnippet: "line3\nline4\nline5",
      anchorHash: "abc123",
      source: "MANUAL",
      note: "login flow",
      createdById: "user-1",
    });
  });

  it("stores the symbol for SYMBOL pins and null note when omitted", async () => {
    (anchorPin as any).mockResolvedValue({
      ...anchor,
      startLine: 10,
      endLine: 20,
    });

    const res = await POST(
      postRequest({
        configId: 5,
        kind: "SYMBOL",
        filePath: "src/a.ts",
        symbol: "foo",
      }),
      makeParams()
    );

    expect(res.status).toBe(201);
    expect(db.repositoryCaseCodePin.create.mock.calls[0][0].data).toMatchObject(
      {
        kind: "SYMBOL",
        symbol: "foo",
        startLine: 10,
        endLine: 20,
        note: null,
      }
    );
  });

  it("returns 403 when the create is rejected by policy", async () => {
    db.repositoryCaseCodePin.create.mockRejectedValue(new Error("denied"));
    (isAccessPolicyError as any).mockReturnValue(true);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 500 for any other failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.repositoryCaseCodePin.create.mockRejectedValue(new Error("db down"));

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create code pin" });
  });
});
