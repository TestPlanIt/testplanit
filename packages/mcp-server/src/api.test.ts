import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  zenstack,
  lookup,
  resolveActiveRepository,
  resolveDefaultTemplate,
  resolveCaseWorkflowState,
} from "./api.js";
import { TestPlanItHttpError } from "./http.js";

const ENV = { apiUrl: "https://app.testplanit.com", apiToken: "tpi_test_xxxxxxxx" };
const HEADERS = {
  Authorization: `Bearer ${ENV.apiToken}`,
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// zenstack() — GET dispatch (read operations)
// ---------------------------------------------------------------------------

describe("zenstack() — GET dispatch", () => {
  it("TC-01: findMany builds ?q= with URI-encoded JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 1 }] }));

    const result = await zenstack(
      "repositoryCases",
      "findMany",
      { where: { projectId: 7 } },
      ENV,
    );

    expect(result).toEqual([{ id: 1 }]);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const opts = call[1] as RequestInit;
    expect(url).toBe(
      "https://app.testplanit.com/api/model/repositoryCases/findMany?q=%7B%22where%22%3A%7B%22projectId%22%3A7%7D%7D",
    );
    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(HEADERS.Authorization);
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(HEADERS["Content-Type"]);
    expect(opts.body).toBeUndefined();
  });

  it.each(["findUnique", "findFirst", "count", "aggregate", "groupBy"])(
    "TC-02: %s uses GET with ?q=",
    async (operation) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
      await zenstack("projects", operation, { where: { id: 1 } }, ENV);
      const call = fetchMock.mock.calls[0];
      const url = call[0] as string;
      const opts = call[1] as RequestInit;
      expect(opts.method).toBe("GET");
      expect(url).toContain("?q=");
    },
  );

  it("TC-03: empty body omits ?q=", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await zenstack("projects", "findMany", undefined, ENV);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url).toBe("https://app.testplanit.com/api/model/projects/findMany");
    expect(url).not.toContain("?q=");
  });
});

// ---------------------------------------------------------------------------
// zenstack() — POST dispatch (create operations)
// ---------------------------------------------------------------------------

describe("zenstack() — POST/PATCH/DELETE dispatch", () => {
  it("TC-04: create uses POST + JSON body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: 42 } }));
    const result = await zenstack("tags", "create", { data: { name: "x" } }, ENV);
    expect(result).toEqual({ id: 42 });
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const opts = call[1] as RequestInit;
    expect(opts.method).toBe("POST");
    expect(url).toBe("https://app.testplanit.com/api/model/tags/create");
    expect(url).not.toContain("?q=");
    expect(opts.body).toBe(JSON.stringify({ data: { name: "x" } }));
  });

  it.each(["update", "updateMany"])("TC-05: %s uses PATCH", async (operation) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: {} }));
    await zenstack("repositoryCases", operation, { where: { id: 1 }, data: { isDeleted: true } }, ENV);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("PATCH");
  });

  it.each(["delete", "deleteMany"])("TC-06: %s uses DELETE", async (operation) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: {} }));
    await zenstack("repositoryCases", operation, { where: { id: 1 } }, ENV);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// zenstack() — error handling
// ---------------------------------------------------------------------------

describe("zenstack() — error handling", () => {
  it("TC-07: HTTP non-2xx → throws TestPlanItHttpError with statusCode + code; no token in message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "denied", code: "FORBIDDEN" }));
    await expect(
      zenstack("repositoryCases", "findMany", {}, ENV),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(TestPlanItHttpError);
      const e = err as TestPlanItHttpError;
      expect(e.statusCode).toBe(403);
      expect(e.code).toBe("FORBIDDEN");
      expect(e.message).toContain("/api/model/repositoryCases/findMany");
      expect(e.message).toContain("HTTP 403");
      expect(e.message).not.toContain("tpi_");
      return true;
    });
  });

  it("TC-08: HTTP 422 (host remap of ZenStack 403/404) → preserves statusCode=422 and code", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { error: { message: "denied by policy", code: "POLICY_DENIAL" } }),
    );
    await expect(zenstack("repositoryCases", "create", {}, ENV)).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as TestPlanItHttpError;
        expect(e.statusCode).toBe(422);
        expect(e.code).toBe("POLICY_DENIAL");
        return true;
      },
    );
  });

  it("TC-09: HTTP 422 with no body code → statusCode preserved, code undefined", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { error: "no related record" }));
    await expect(zenstack("repositoryCases", "create", {}, ENV)).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as TestPlanItHttpError;
        expect(e.statusCode).toBe(422);
        expect(e.code).toBeUndefined();
        return true;
      },
    );
  });

  it("TC-10: 2xx with error envelope → throws TestPlanItHttpError with envelope code/message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { error: { message: "validation failed", code: "VALIDATION" } }),
    );
    await expect(zenstack("repositoryCases", "create", {}, ENV)).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as TestPlanItHttpError;
        expect(e).toBeInstanceOf(TestPlanItHttpError);
        expect(e.code).toBe("VALIDATION");
        expect(e.message).toContain("validation failed");
        return true;
      },
    );
  });

  it("TC-11: 2xx with data → returns data (unwraps envelope)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 1 }, { id: 2 }] }));
    const result = await zenstack("repositoryCases", "findMany", {}, ENV);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("TC-12: non-JSON body on non-2xx → throws TestPlanItHttpError, code undefined, no token in message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );
    await expect(zenstack("repositoryCases", "findMany", {}, ENV)).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as TestPlanItHttpError;
        expect(e).toBeInstanceOf(TestPlanItHttpError);
        expect(e.statusCode).toBe(500);
        expect(e.code).toBeUndefined();
        expect(e.message).not.toContain("tpi_");
        return true;
      },
    );
  });

  it("TC-13: fetch abort → error propagated", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(zenstack("repositoryCases", "findMany", {}, ENV)).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// lookup()
// ---------------------------------------------------------------------------

describe("lookup()", () => {
  it("TC-14: POSTs /api/cli/lookup with body and returns parsed response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 9, name: "tag-x", created: true }),
    );
    const result = await lookup(
      { type: "tag", name: "tag-x", createIfMissing: true },
      ENV,
    );
    expect(result).toEqual({ id: 9, name: "tag-x", created: true });
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const opts = call[1] as RequestInit;
    expect(url).toBe("https://app.testplanit.com/api/cli/lookup");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe(JSON.stringify({ type: "tag", name: "tag-x", createIfMissing: true }));
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(HEADERS.Authorization);
  });

  it("TC-15: lookup non-2xx → throws TestPlanItHttpError with statusCode + code from body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not found", code: "NOT_FOUND" }));
    await expect(lookup({ type: "tag", name: "missing" }, ENV)).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as TestPlanItHttpError;
        expect(e.statusCode).toBe(404);
        expect(e.code).toBe("NOT_FOUND");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveActiveRepository()
// ---------------------------------------------------------------------------

describe("resolveActiveRepository()", () => {
  it("TC-16: returns id on found; query scoped to projectId + isActive + isDeleted + isArchived", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 11 }] }));
    const result = await resolveActiveRepository(7, ENV);
    expect(result).toBe(11);

    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain("/api/model/repositories/findMany");
    const qParam = new URL(url).searchParams.get("q");
    const body = JSON.parse(decodeURIComponent(qParam!));
    expect(body.where).toEqual({
      projectId: 7,
      isActive: true,
      isDeleted: false,
      isArchived: false,
    });
  });

  it("TC-17: empty array → throws TestPlanItHttpError 422 with helpful message including projectId", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await expect(resolveActiveRepository(7, ENV)).rejects.toSatisfy((err: unknown) => {
      const e = err as TestPlanItHttpError;
      expect(e).toBeInstanceOf(TestPlanItHttpError);
      expect(e.statusCode).toBe(422);
      expect(e.message).toContain("No active repository");
      expect(e.message).toContain("7");
      expect(e.message).not.toContain("tpi_");
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// resolveDefaultTemplate()
// ---------------------------------------------------------------------------

describe("resolveDefaultTemplate()", () => {
  it("TC-18: empty array → throws TestPlanItHttpError 422 with message containing 'template'", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await expect(resolveDefaultTemplate(7, ENV)).rejects.toSatisfy((err: unknown) => {
      const e = err as TestPlanItHttpError;
      expect(e).toBeInstanceOf(TestPlanItHttpError);
      expect(e.statusCode).toBe(422);
      expect(e.message.toLowerCase()).toContain("template");
      expect(e.message).not.toContain("tpi_");
      return true;
    });
  });

  it("TC-18b: returns id on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 5 }] }));
    const result = await resolveDefaultTemplate(7, ENV);
    expect(result).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// resolveCaseWorkflowState()
// ---------------------------------------------------------------------------

describe("resolveCaseWorkflowState()", () => {
  it("TC-19: queries scope=CASES (not RUNS); filters by name; uses /api/model/workflows/findMany (never /api/cli/lookup)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 5, name: "Active" }] }));
    const result = await resolveCaseWorkflowState(7, ENV, "Active");
    expect(result).toEqual({ id: 5, name: "Active" });

    // Must use workflows/findMany, never /api/cli/lookup
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain("/api/model/workflows/findMany");
    expect(url).not.toContain("/api/cli/lookup");

    const qParam = new URL(url).searchParams.get("q");
    const body = JSON.parse(decodeURIComponent(qParam!));
    expect(body.where.scope).toBe("CASES");
    expect(body.where.name).toBe("Active");
  });

  it("TC-20: no name → returns first by order asc (take: 1, orderBy order asc)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 3, name: "Draft" }] }));
    const result = await resolveCaseWorkflowState(7, ENV);
    expect(result.id).toBe(3);

    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const qParam = new URL(url).searchParams.get("q");
    const body = JSON.parse(decodeURIComponent(qParam!));
    expect(body.orderBy).toEqual({ order: "asc" });
    expect(body.take).toBe(1);
    expect(body.where.name).toBeUndefined();
  });

  it("TC-20b: no match → throws TestPlanItHttpError 422", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await expect(resolveCaseWorkflowState(7, ENV)).rejects.toSatisfy((err: unknown) => {
      const e = err as TestPlanItHttpError;
      expect(e.statusCode).toBe(422);
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// TC-21: Defense-in-depth — no raw token in any error message
// ---------------------------------------------------------------------------

describe("TC-21: no raw token in any error message", () => {
  it("HTTP 403 error does not contain tpi_test", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "denied", code: "FORBIDDEN" }));
    const err = await zenstack("repositoryCases", "findMany", {}, ENV).catch((e) => e);
    expect((err as TestPlanItHttpError).message).not.toContain("tpi_test");
  });

  it("HTTP 422 with code does not contain tpi_test", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { error: { message: "denied", code: "POLICY_DENIAL" } }),
    );
    const err = await zenstack("repositoryCases", "create", {}, ENV).catch((e) => e);
    expect((err as TestPlanItHttpError).message).not.toContain("tpi_test");
  });

  it("HTTP 422 without code does not contain tpi_test", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { error: "no related record" }));
    const err = await zenstack("repositoryCases", "create", {}, ENV).catch((e) => e);
    expect((err as TestPlanItHttpError).message).not.toContain("tpi_test");
  });

  it("non-JSON 500 does not contain tpi_test", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));
    const err = await zenstack("repositoryCases", "findMany", {}, ENV).catch((e) => e);
    expect((err as TestPlanItHttpError).message).not.toContain("tpi_test");
  });

  it("lookup 404 does not contain tpi_test", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not found", code: "NOT_FOUND" }));
    const err = await lookup({ type: "tag", name: "missing" }, ENV).catch((e) => e);
    expect((err as TestPlanItHttpError).message).not.toContain("tpi_test");
  });

  it("resolveActiveRepository empty → error does not contain tpi_test", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    const err = await resolveActiveRepository(7, ENV).catch((e) => e);
    expect((err as TestPlanItHttpError).message).not.toContain("tpi_test");
  });

  it("resolveDefaultTemplate empty → error does not contain tpi_test", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    const err = await resolveDefaultTemplate(7, ENV).catch((e) => e);
    expect((err as TestPlanItHttpError).message).not.toContain("tpi_test");
  });
});
