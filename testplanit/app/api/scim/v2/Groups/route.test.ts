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
import { InvalidFilterError } from "~/lib/scim/filter";
import {
  createScimGroup,
  listScimGroups,
  ScimUniquenessError,
  ScimValidationError,
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
  createScimGroup: vi.fn(),
  listScimGroups: vi.fn(),
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

function makeRequest(
  opts: {
    method?: string;
    url?: string;
    body?: unknown;
    bodyText?: string;
  } = {}
): NextRequest {
  const method = opts.method ?? "POST";
  const url = opts.url ?? "http://localhost/api/scim/v2/Groups";
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/scim+json";
  } else if (opts.bodyText !== undefined) {
    body = opts.bodyText;
    headers["content-type"] = "application/scim+json";
  }
  return new NextRequest(url, { method, body, headers });
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
  vi.mocked(createScimGroup).mockReset();
  vi.mocked(listScimGroups).mockReset();
});

describe("POST /api/scim/v2/Groups", () => {
  const validBody = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    displayName: "Eng",
    externalId: "e-1",
    members: [],
  };

  it("returns 201 with the SCIM resource on a brand-new create", async () => {
    vi.mocked(createScimGroup).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
      linked: false,
    });
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { id: string; displayName: string };
    expect(body.id).toBe("11");
    expect(body.displayName).toBe("Eng");
    expect(createScimGroup).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Eng" }),
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
  });

  it("returns 200 on a JIT-bind result (existing live row, no externalId before)", async () => {
    vi.mocked(createScimGroup).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
      linked: true,
    });
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
  });

  it("returns 401 SCIM error envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { schemas: string[]; detail: string };
    expect(body.schemas[0]).toBe("urn:ietf:params:scim:api:messages:2.0:Error");
    expect(body.detail).toBe("Missing Authorization header");
    expect(createScimGroup).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax on unparseable JSON body", async () => {
    const res = await POST(makeRequest({ bodyText: "{not json" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(body.detail).toBe("Request body is not valid JSON");
  });

  it("returns 400 invalidSyntax when displayName is empty", async () => {
    const res = await POST(
      makeRequest({ body: { ...validBody, displayName: "" } })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(createScimGroup).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax when displayName is missing", async () => {
    const { displayName: _drop, ...incomplete } = validBody;
    void _drop;
    const res = await POST(makeRequest({ body: incomplete }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
  });

  it("returns 400 invalidSyntax when members[] exceeds 1000", async () => {
    const big = Array.from({ length: 1001 }, (_, i) => ({ value: `u${i}` }));
    const res = await POST(
      makeRequest({ body: { ...validBody, members: big } })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(createScimGroup).not.toHaveBeenCalled();
  });

  it("accepts URN-prefixed extension keys via passthrough", async () => {
    vi.mocked(createScimGroup).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
      linked: false,
    });
    const res = await POST(
      makeRequest({
        body: { ...validBody, "urn:custom:ext": { customAttr: "v" } },
      })
    );
    expect(res.status).toBe(201);
    expect(createScimGroup).toHaveBeenCalledWith(
      expect.objectContaining({ "urn:custom:ext": { customAttr: "v" } }),
      expect.anything()
    );
  });

  it("returns 409 uniqueness when service throws ScimUniquenessError", async () => {
    vi.mocked(createScimGroup).mockRejectedValueOnce(
      new ScimUniquenessError("externalId already exists")
    );
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("uniqueness");
    expect(body.detail).toBe("externalId already exists");
  });

  it("returns 409 uniqueness on Prisma P2002 pass-through", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" }
    );
    vi.mocked(createScimGroup).mockRejectedValueOnce(p2002);
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("displayName or externalId already exists");
  });

  it("returns ScimValidationError's carried response verbatim", async () => {
    vi.mocked(createScimGroup).mockRejectedValueOnce(
      new ScimValidationError(
        scimError(400, "invalidValue", "displayName is required")
      )
    );
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidValue");
    expect(body.detail).toBe("displayName is required");
  });

  it("returns 500 with English detail (no err.message) on unexpected error", async () => {
    vi.mocked(createScimGroup).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Internal server error");
    expect(body.detail).not.toContain("boom");
    errSpy.mockRestore();
  });
});

describe("GET /api/scim/v2/Groups", () => {
  it("returns 200 with the SCIM ListResponse envelope", async () => {
    vi.mocked(listScimGroups).mockResolvedValueOnce({
      resources: [SAMPLE_RESOURCE, { ...SAMPLE_RESOURCE, id: "12" }],
      totalResults: 7,
    });
    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Groups" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as {
      schemas: string[];
      totalResults: number;
      itemsPerPage: number;
      startIndex: number;
      Resources: unknown[];
    };
    expect(body.schemas[0]).toBe(
      "urn:ietf:params:scim:api:messages:2.0:ListResponse"
    );
    expect(body.totalResults).toBe(7);
    expect(body.itemsPerPage).toBe(2);
    expect(body.startIndex).toBe(1);
    expect(body.Resources).toHaveLength(2);
  });

  it("threads startIndex + count + filter into listScimGroups", async () => {
    vi.mocked(listScimGroups).mockResolvedValueOnce({
      resources: [],
      totalResults: 0,
    });
    const res = await GET(
      makeRequest({
        method: "GET",
        url: 'http://localhost/api/scim/v2/Groups?filter=displayName eq "Eng"&startIndex=21&count=20',
      })
    );
    expect(res.status).toBe(200);
    expect(listScimGroups).toHaveBeenCalledWith(
      { filter: 'displayName eq "Eng"', startIndex: 21, count: 20 },
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
  });

  it("returns 400 invalidFilter when filter exceeds 1024 chars (without calling service)", async () => {
    const longFilter = `displayName eq "${"a".repeat(1100)}"`;
    const res = await GET(
      makeRequest({
        method: "GET",
        url: `http://localhost/api/scim/v2/Groups?filter=${encodeURIComponent(longFilter)}`,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidFilter");
    expect(body.detail).toBe("Filter exceeds maximum length");
    expect(listScimGroups).not.toHaveBeenCalled();
  });

  it("returns 400 invalidFilter when service throws InvalidFilterError", async () => {
    vi.mocked(listScimGroups).mockRejectedValueOnce(
      new InvalidFilterError("Attribute 'title' is not filterable")
    );
    const res = await GET(
      makeRequest({
        method: "GET",
        url: 'http://localhost/api/scim/v2/Groups?filter=title eq "x"',
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidFilter");
  });

  it("returns 401 SCIM envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Groups" })
    );
    expect(res.status).toBe(401);
    expect(listScimGroups).not.toHaveBeenCalled();
  });

  it("returns 500 with English detail on unexpected error", async () => {
    vi.mocked(listScimGroups).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Groups" })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Internal server error");
    errSpy.mockRestore();
  });

  it("defaults startIndex to 1 when omitted", async () => {
    vi.mocked(listScimGroups).mockResolvedValueOnce({
      resources: [],
      totalResults: 0,
    });
    await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Groups" })
    );
    expect(listScimGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        startIndex: 1,
        filter: undefined,
        count: undefined,
      }),
      expect.anything()
    );
  });
});

describe("non-mutation methods on /api/scim/v2/Groups", () => {
  const errorEnvelope = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: "405",
    detail: "Method not supported",
  };

  it("PUT returns 405 SCIM envelope", async () => {
    const res = await PUT();
    expect(res.status).toBe(405);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(await res.json()).toEqual(errorEnvelope);
  });

  it("PATCH returns 405 SCIM envelope", async () => {
    const res = await PATCH();
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual(errorEnvelope);
  });

  it("DELETE returns 405 SCIM envelope", async () => {
    const res = await DELETE();
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual(errorEnvelope);
  });
});
