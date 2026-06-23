import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { requireScimBearer, ScimAuthError } from "~/lib/scim/auth";
import { scimError } from "~/lib/scim/errors";
import { ScimPatchApplyError } from "~/lib/scim/patch";
import {
  deleteScimGroup,
  getScimGroupById,
  patchScimGroup,
  putScimGroup,
  ScimNotFoundError,
  ScimUniquenessError,
} from "~/lib/scim/services/groups";

import { DELETE, GET, PATCH, POST, PUT } from "./route";

vi.mock("~/lib/scim/auth", () => ({
  ScimAuthError: class extends Error {
    constructor(public response: unknown) {
      super("SCIM bearer auth failed");
      this.name = "ScimAuthError";
    }
  },
  requireScimBearer: vi.fn().mockResolvedValue({
    tokenId: "tk_test",
    systemUserId: "system-scim-user",
  }),
}));

vi.mock("~/lib/scim/services/groups", () => ({
  getScimGroupById: vi.fn(),
  putScimGroup: vi.fn(),
  patchScimGroup: vi.fn(),
  deleteScimGroup: vi.fn(),
  ScimNotFoundError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ScimNotFoundError";
    }
  },
  ScimUniquenessError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ScimUniquenessError";
    }
  },
  ScimValidationError: class ScimValidationError extends Error {
    constructor(public response: unknown) {
      super("SCIM validation failed");
      this.name = "ScimValidationError";
    }
  },
}));

vi.mock("~/lib/scim/patch", () => ({
  ScimPatchApplyError: class extends Error {
    constructor(public response: unknown) {
      super("SCIM patch apply failed");
      this.name = "ScimPatchApplyError";
    }
  },
}));

const SAMPLE_RESOURCE = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  id: "11",
  displayName: "Eng",
  externalId: "e-1",
  members: [],
  meta: {
    resourceType: "Group" as const,
    location: "http://localhost:3000/api/scim/v2/Groups/11",
    version: "v1",
    lastModified: "2026-06-05T00:00:00.000Z",
  },
};

function makeReq(opts: {
  method?: string;
  url?: string;
  body?: unknown;
  bodyText?: string;
}): [NextRequest, { params: Promise<{ id: string }> }] {
  const url = opts.url ?? "http://localhost/api/scim/v2/Groups/11";
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/scim+json";
  } else if (opts.bodyText !== undefined) {
    body = opts.bodyText;
    headers["content-type"] = "application/scim+json";
  }
  const req = new NextRequest(url, {
    method: opts.method ?? "GET",
    body,
    headers,
  });
  const ctx = { params: Promise.resolve({ id: "11" }) };
  return [req, ctx];
}

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

beforeAll(() => {
  process.env.NEXTAUTH_URL = "http://localhost:3000";
});

afterAll(() => {
  if (originalNextAuthUrl) {
    process.env.NEXTAUTH_URL = originalNextAuthUrl;
  } else {
    delete process.env.NEXTAUTH_URL;
  }
});

beforeEach(() => {
  vi.mocked(requireScimBearer).mockResolvedValue({
    tokenId: "tk_test",
    systemUserId: "system-scim-user",
  });
  vi.mocked(getScimGroupById).mockReset();
  vi.mocked(putScimGroup).mockReset();
  vi.mocked(patchScimGroup).mockReset();
  vi.mocked(deleteScimGroup).mockReset();
});

describe("GET /api/scim/v2/Groups/[id]", () => {
  it("returns 200 with the SCIM resource", async () => {
    vi.mocked(getScimGroupById).mockResolvedValueOnce(SAMPLE_RESOURCE);
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("11");
    expect(getScimGroupById).toHaveBeenCalledWith("11", {
      tokenId: "tk_test",
      systemUserId: "system-scim-user",
    });
  });

  it("returns 404 on ScimNotFoundError", async () => {
    vi.mocked(getScimGroupById).mockRejectedValueOnce(
      new ScimNotFoundError("Group 11 not found")
    );
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Group 11 not found");
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
    expect(getScimGroupById).not.toHaveBeenCalled();
  });

  it("returns 500 with English detail on unexpected error", async () => {
    vi.mocked(getScimGroupById).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Internal server error");
    expect(body.detail).not.toContain("boom");
    errSpy.mockRestore();
  });
});

describe("PUT /api/scim/v2/Groups/[id]", () => {
  const validBody = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    displayName: "Eng",
    externalId: "e-1",
    members: [],
  };

  it("returns 200 with the updated resource on success", async () => {
    vi.mocked(putScimGroup).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
      status: 200,
    });
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(putScimGroup).toHaveBeenCalledWith(
      "11",
      expect.objectContaining({ displayName: "Eng" }),
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
  });

  it("returns 404 on ScimNotFoundError", async () => {
    vi.mocked(putScimGroup).mockRejectedValueOnce(
      new ScimNotFoundError("Group 11 not found")
    );
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 409 uniqueness on ScimUniquenessError", async () => {
    vi.mocked(putScimGroup).mockRejectedValueOnce(
      new ScimUniquenessError("externalId already exists")
    );
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("uniqueness");
    expect(body.detail).toBe("externalId already exists");
  });

  it("returns 409 uniqueness on Prisma P2002", async () => {
    const p2002 = Object.assign(new ORMError(ORMErrorReason.DB_QUERY_ERROR, 'duplicate key value violates unique constraint "uq"'), { dbErrorCode: "23505" });
    vi.mocked(putScimGroup).mockRejectedValueOnce(p2002);
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
  });

  it("returns 400 invalidSyntax on unparseable JSON body", async () => {
    const [req, ctx] = makeReq({ method: "PUT", bodyText: "{nope" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
  });

  it("returns 400 invalidSyntax when displayName is empty", async () => {
    const [req, ctx] = makeReq({
      method: "PUT",
      body: { ...validBody, displayName: "" },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(putScimGroup).not.toHaveBeenCalled();
  });

  it("returns 400 when members[] exceeds 1000", async () => {
    const big = Array.from({ length: 1001 }, (_, i) => ({ value: `u${i}` }));
    const [req, ctx] = makeReq({
      method: "PUT",
      body: { ...validBody, members: big },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(putScimGroup).not.toHaveBeenCalled();
  });

  it("accepts extra URN-prefixed extension keys via passthrough", async () => {
    vi.mocked(putScimGroup).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
      status: 200,
    });
    const [req, ctx] = makeReq({
      method: "PUT",
      body: { ...validBody, "urn:custom:ext": { a: 1 } },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(401);
    expect(putScimGroup).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/scim/v2/Groups/[id]", () => {
  const validPatch = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{ op: "replace", path: "displayName", value: "NewEng" }],
  };

  it("returns 200 with the updated resource on success", async () => {
    vi.mocked(patchScimGroup).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
    });
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(patchScimGroup).toHaveBeenCalledWith(
      "11",
      expect.objectContaining({ Operations: expect.any(Array) }),
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
  });

  it("accepts Entra-shape Remove members (passthrough)", async () => {
    vi.mocked(patchScimGroup).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
    });
    const entraPatch = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        {
          op: "Remove",
          path: "members",
          value: [{ value: "u1091" }],
        },
      ],
    };
    const [req, ctx] = makeReq({ method: "PATCH", body: entraPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
  });

  it("returns 400 ScimPatchApplyError carried envelope verbatim", async () => {
    vi.mocked(patchScimGroup).mockRejectedValueOnce(
      new ScimPatchApplyError(
        scimError(400, "invalidSyntax", "Operations array exceeds cap")
      )
    );
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(body.detail).toBe("Operations array exceeds cap");
  });

  it("returns 404 on ScimNotFoundError (tombstone)", async () => {
    vi.mocked(patchScimGroup).mockRejectedValueOnce(
      new ScimNotFoundError("Group 11 not found")
    );
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 400 invalidSyntax when Operations is empty", async () => {
    const [req, ctx] = makeReq({
      method: "PATCH",
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [],
      },
    });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    expect(patchScimGroup).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax when Operations is not an array", async () => {
    const [req, ctx] = makeReq({
      method: "PATCH",
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: "not-array",
      },
    });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    expect(patchScimGroup).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax when an op is missing the op field", async () => {
    const [req, ctx] = makeReq({
      method: "PATCH",
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ path: "displayName", value: "X" }],
      },
    });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    expect(patchScimGroup).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax on unparseable JSON body", async () => {
    const [req, ctx] = makeReq({ method: "PATCH", bodyText: "{not json" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(401);
    expect(patchScimGroup).not.toHaveBeenCalled();
  });

  it("returns 500 with English detail on unexpected error (no err.message leak)", async () => {
    vi.mocked(patchScimGroup).mockRejectedValueOnce(
      new Error("internal-detail-leak")
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Internal server error");
    expect(body.detail).not.toContain("internal-detail-leak");
    errSpy.mockRestore();
  });
});

describe("DELETE /api/scim/v2/Groups/[id]", () => {
  it("returns 204 with empty body and application/scim+json Content-Type", async () => {
    vi.mocked(deleteScimGroup).mockResolvedValueOnce({ status: 204 });
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const text = await res.text();
    expect(text).toBe("");
    expect(deleteScimGroup).toHaveBeenCalledWith("11", {
      tokenId: "tk_test",
      systemUserId: "system-scim-user",
    });
  });

  it("returns 404 on ScimNotFoundError", async () => {
    vi.mocked(deleteScimGroup).mockRejectedValueOnce(
      new ScimNotFoundError("Group 11 not found")
    );
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(401);
    expect(deleteScimGroup).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected error", async () => {
    vi.mocked(deleteScimGroup).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });
});

describe("POST /api/scim/v2/Groups/[id]", () => {
  it("returns 405 SCIM envelope (POST only valid on collection)", async () => {
    const res = await POST();
    expect(res.status).toBe(405);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as {
      schemas: string[];
      status: string;
      detail: string;
    };
    expect(body.schemas[0]).toBe("urn:ietf:params:scim:api:messages:2.0:Error");
    expect(body.status).toBe("405");
    expect(body.detail).toBe("Method not supported");
  });
});
