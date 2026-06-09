import { Prisma } from "@prisma/client";
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
  deleteScimUser,
  getScimUserById,
  patchScimUser,
  putScimUser,
  ScimNotFoundError,
  ScimUniquenessError,
  ScimValidationError,
} from "~/lib/scim/services/users";

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

vi.mock("~/lib/scim/services/users", () => ({
  getScimUserById: vi.fn(),
  putScimUser: vi.fn(),
  patchScimUser: vi.fn(),
  deleteScimUser: vi.fn(),
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
  ScimValidationError: class extends Error {
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
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: "u_1",
  userName: "jdoe@example.com",
  emails: [{ value: "jdoe@example.com", primary: true }],
  active: true,
  meta: {
    resourceType: "User" as const,
    location: "http://localhost:3000/scim/v2/Users/u_1",
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
  const url = opts.url ?? "http://localhost/scim/v2/Users/u_1";
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
  const ctx = { params: Promise.resolve({ id: "u_1" }) };
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
  vi.mocked(getScimUserById).mockReset();
  vi.mocked(putScimUser).mockReset();
  vi.mocked(patchScimUser).mockReset();
  vi.mocked(deleteScimUser).mockReset();
});

describe("GET /api/scim/v2/Users/[id]", () => {
  it("returns 200 with the SCIM resource", async () => {
    vi.mocked(getScimUserById).mockResolvedValueOnce(SAMPLE_RESOURCE);
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("u_1");
    expect(getScimUserById).toHaveBeenCalledWith("u_1", {
      tokenId: "tk_test",
      systemUserId: "system-scim-user",
    });
  });

  it("returns 404 on ScimNotFoundError", async () => {
    vi.mocked(getScimUserById).mockRejectedValueOnce(
      new ScimNotFoundError("User u_1 not found")
    );
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { detail: string; scimType?: string };
    expect(body.detail).toBe("User u_1 not found");
    expect(body.scimType).toBeUndefined();
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
    expect(getScimUserById).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(getScimUserById).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [req, ctx] = makeReq({ method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Internal server error");
    errSpy.mockRestore();
  });
});

describe("PUT /api/scim/v2/Users/[id]", () => {
  const validBody = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: "jdoe@example.com",
    emails: [{ value: "jdoe@example.com", primary: true }],
    active: true,
  };

  it("returns 200 with the updated resource on success", async () => {
    vi.mocked(putScimUser).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
      status: 200,
    });
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(putScimUser).toHaveBeenCalledWith(
      "u_1",
      expect.objectContaining({ userName: "jdoe@example.com" }),
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
  });

  it("returns 404 on ScimNotFoundError", async () => {
    vi.mocked(putScimUser).mockRejectedValueOnce(
      new ScimNotFoundError("User u_1 not found")
    );
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 409 uniqueness on ScimUniquenessError", async () => {
    vi.mocked(putScimUser).mockRejectedValueOnce(
      new ScimUniquenessError("email already in use")
    );
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("uniqueness");
    expect(body.detail).toBe("email already in use");
  });

  it("returns 409 uniqueness on Prisma P2002 pass-through", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" }
    );
    vi.mocked(putScimUser).mockRejectedValueOnce(p2002);
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
  });

  it("returns ScimValidationError's carried response verbatim", async () => {
    vi.mocked(putScimUser).mockRejectedValueOnce(
      new ScimValidationError(
        scimError(400, "invalidValue", "email is required")
      )
    );
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidValue");
    expect(body.detail).toBe("email is required");
  });

  it("returns 400 invalidSyntax on unparseable JSON body", async () => {
    const [req, ctx] = makeReq({ method: "PUT", bodyText: "{nope" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
  });

  it("returns 400 invalidSyntax on zod-rejected body (empty userName)", async () => {
    const [req, ctx] = makeReq({
      method: "PUT",
      body: { ...validBody, userName: "" },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(putScimUser).not.toHaveBeenCalled();
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "PUT", body: validBody });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(401);
    expect(putScimUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/scim/v2/Users/[id]", () => {
  const validPatch = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{ op: "replace", path: "active", value: false }],
  };

  it("returns 200 with the updated resource on success", async () => {
    vi.mocked(patchScimUser).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
    });
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(patchScimUser).toHaveBeenCalledWith(
      "u_1",
      expect.objectContaining({ Operations: expect.any(Array) }),
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
  });

  it("returns 400 with the ScimPatchApplyError carried envelope verbatim", async () => {
    vi.mocked(patchScimUser).mockRejectedValueOnce(
      new ScimPatchApplyError(
        scimError(
          400,
          "mutability",
          "Attribute is not user-modifiable via SCIM"
        )
      )
    );
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("mutability");
    expect(body.detail).toBe("Attribute is not user-modifiable via SCIM");
  });

  it("returns 400 with ScimPatchApplyError invalidSyntax envelope when op is unsupported", async () => {
    vi.mocked(patchScimUser).mockRejectedValueOnce(
      new ScimPatchApplyError(
        scimError(400, "invalidSyntax", "Unsupported PATCH op 'replace'")
      )
    );
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
  });

  it("returns 404 on ScimNotFoundError", async () => {
    vi.mocked(patchScimUser).mockRejectedValueOnce(
      new ScimNotFoundError("User u_1 not found")
    );
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 400 invalidSyntax on a PATCH body with no Operations entries", async () => {
    const [req, ctx] = makeReq({
      method: "PATCH",
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [],
      },
    });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(patchScimUser).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax on unparseable JSON body", async () => {
    const [req, ctx] = makeReq({ method: "PATCH", bodyText: "{not json" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "PATCH", body: validPatch });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(401);
    expect(patchScimUser).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/scim/v2/Users/[id]", () => {
  it("returns 204 with empty body and application/scim+json Content-Type", async () => {
    vi.mocked(deleteScimUser).mockResolvedValueOnce({ status: 204 });
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const text = await res.text();
    expect(text).toBe("");
    expect(deleteScimUser).toHaveBeenCalledWith("u_1", {
      tokenId: "tk_test",
      systemUserId: "system-scim-user",
    });
  });

  it("returns 404 on ScimNotFoundError", async () => {
    vi.mocked(deleteScimUser).mockRejectedValueOnce(
      new ScimNotFoundError("User u_1 not found")
    );
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("User u_1 not found");
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(401);
    expect(deleteScimUser).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(deleteScimUser).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [req, ctx] = makeReq({ method: "DELETE" });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });
});

describe("POST /api/scim/v2/Users/[id]", () => {
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
