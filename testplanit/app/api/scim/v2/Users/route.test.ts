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
import { InvalidFilterError } from "~/lib/scim/filter";
import {
  createScimUser,
  listScimUsers,
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
  createScimUser: vi.fn(),
  listScimUsers: vi.fn(),
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
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: "u_1",
  userName: "jdoe@example.com",
  emails: [{ value: "jdoe@example.com", primary: true }],
  active: true,
  meta: {
    resourceType: "User" as const,
    location: "http://localhost:3000/api/scim/v2/Users/u_1",
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
  const url = opts.url ?? "http://localhost/api/scim/v2/Users";
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
  vi.mocked(createScimUser).mockReset();
  vi.mocked(listScimUsers).mockReset();
});

describe("POST /api/scim/v2/Users", () => {
  const validBody = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: "jdoe@example.com",
    emails: [{ value: "jdoe@example.com", primary: true }],
    active: true,
  };

  it("returns 201 with the SCIM resource on a brand-new create", async () => {
    vi.mocked(createScimUser).mockResolvedValueOnce({
      resource: SAMPLE_RESOURCE,
      linked: false,
    });
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { id: string; userName: string };
    expect(body.id).toBe("u_1");
    expect(body.userName).toBe("jdoe@example.com");
    expect(createScimUser).toHaveBeenCalledWith(
      expect.objectContaining({ userName: "jdoe@example.com" }),
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
  });

  it("returns 200 on a JIT-bind result (existing row, no scimExternalId before)", async () => {
    vi.mocked(createScimUser).mockResolvedValueOnce({
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
    expect(createScimUser).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax on unparseable JSON body", async () => {
    const res = await POST(makeRequest({ bodyText: "{not json" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(body.detail).toBe("Request body is not valid JSON");
  });

  it("returns 400 invalidSyntax on zod schema mismatch (empty userName)", async () => {
    const res = await POST(
      makeRequest({
        body: { ...validBody, userName: "" },
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
    expect(createScimUser).not.toHaveBeenCalled();
  });

  it("returns 400 invalidSyntax when userName is missing", async () => {
    const { userName: _drop, ...incomplete } = validBody;
    void _drop;
    const res = await POST(makeRequest({ body: incomplete }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("invalidSyntax");
  });

  it("returns 409 uniqueness when the service throws ScimUniquenessError", async () => {
    vi.mocked(createScimUser).mockRejectedValueOnce(
      new ScimUniquenessError("userName already exists")
    );
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("uniqueness");
    expect(body.detail).toBe("userName already exists");
  });

  it("returns 409 uniqueness when the service throws a unique-constraint violation directly", async () => {
    const p2002 = Object.assign(
      new ORMError(
        ORMErrorReason.DB_QUERY_ERROR,
        'duplicate key value violates unique constraint "uq"'
      ),
      { dbErrorCode: "23505" }
    );
    vi.mocked(createScimUser).mockRejectedValueOnce(p2002);
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { scimType: string };
    expect(body.scimType).toBe("uniqueness");
  });

  it("returns ScimValidationError's carried response verbatim", async () => {
    vi.mocked(createScimUser).mockRejectedValueOnce(
      new ScimValidationError(
        scimError(400, "invalidValue", "email is required")
      )
    );
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidValue");
    expect(body.detail).toBe("email is required");
  });

  it("returns 500 with an English detail on an unexpected error", async () => {
    vi.mocked(createScimUser).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeRequest({ body: validBody }));
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Internal server error");
    errSpy.mockRestore();
  });
});

describe("GET /api/scim/v2/Users", () => {
  it("returns 200 with the SCIM ListResponse envelope", async () => {
    vi.mocked(listScimUsers).mockResolvedValueOnce({
      resources: [SAMPLE_RESOURCE, { ...SAMPLE_RESOURCE, id: "u_2" }],
      totalResults: 42,
    });
    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Users" })
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
    expect(body.totalResults).toBe(42);
    expect(body.itemsPerPage).toBe(2);
    expect(body.startIndex).toBe(1);
    expect(body.Resources).toHaveLength(2);
  });

  it("threads startIndex + count + filter into listScimUsers", async () => {
    vi.mocked(listScimUsers).mockResolvedValueOnce({
      resources: [],
      totalResults: 0,
    });
    const res = await GET(
      makeRequest({
        method: "GET",
        url: 'http://localhost/api/scim/v2/Users?filter=userName eq "j"&startIndex=51&count=50',
      })
    );
    expect(res.status).toBe(200);
    expect(listScimUsers).toHaveBeenCalledWith(
      { filter: 'userName eq "j"', startIndex: 51, count: 50 },
      { tokenId: "tk_test", systemUserId: "system-scim-user" }
    );
    const body = (await res.json()) as { startIndex: number };
    expect(body.startIndex).toBe(51);
  });

  it("returns 401 SCIM error envelope when bearer is missing", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Users" })
    );
    expect(res.status).toBe(401);
    expect(listScimUsers).not.toHaveBeenCalled();
  });

  it("returns 400 invalidFilter for a filter longer than 1024 chars without calling the service", async () => {
    const longFilter = `userName eq "${"a".repeat(1100)}"`;
    const res = await GET(
      makeRequest({
        method: "GET",
        url: `http://localhost/api/scim/v2/Users?filter=${encodeURIComponent(longFilter)}`,
      })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidFilter");
    expect(body.detail).toBe("Filter exceeds maximum length");
    expect(listScimUsers).not.toHaveBeenCalled();
  });

  it("returns 400 invalidFilter when listScimUsers throws InvalidFilterError", async () => {
    vi.mocked(listScimUsers).mockRejectedValueOnce(
      new InvalidFilterError("Attribute 'title' is not filterable")
    );
    const res = await GET(
      makeRequest({
        method: "GET",
        url: 'http://localhost/api/scim/v2/Users?filter=title eq "x"',
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType: string; detail: string };
    expect(body.scimType).toBe("invalidFilter");
    expect(body.detail).toBe("Attribute 'title' is not filterable");
  });

  it("returns 500 on unexpected listScimUsers errors", async () => {
    vi.mocked(listScimUsers).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Users" })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Internal server error");
    errSpy.mockRestore();
  });

  it("defaults startIndex to 1 when omitted", async () => {
    vi.mocked(listScimUsers).mockResolvedValueOnce({
      resources: [],
      totalResults: 0,
    });
    await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/scim/v2/Users" })
    );
    expect(listScimUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        startIndex: 1,
        filter: undefined,
        count: undefined,
      }),
      expect.anything()
    );
  });
});

describe("non-mutation methods on /api/scim/v2/Users", () => {
  const errorEnvelope = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: "405",
    detail: "Method not supported",
  };

  it("PUT returns a 405 SCIM error envelope", async () => {
    const res = await PUT();
    expect(res.status).toBe(405);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(await res.json()).toEqual(errorEnvelope);
  });

  it("PATCH returns a 405 SCIM error envelope", async () => {
    const res = await PATCH();
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual(errorEnvelope);
  });

  it("DELETE returns a 405 SCIM error envelope", async () => {
    const res = await DELETE();
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual(errorEnvelope);
  });
});
