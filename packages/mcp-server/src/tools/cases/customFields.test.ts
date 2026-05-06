import { describe, it, expect, vi, beforeEach } from "vitest";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

// ── Module mock ──────────────────────────────────────────────────────────────
vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  lookup: vi.fn(),
  resolveActiveRepository: vi.fn(),
  resolveDefaultTemplate: vi.fn(),
  resolveCaseWorkflowState: vi.fn(),
}));

import * as apiModule from "../../api.js";
import { resolveCustomFields, writeCustomFieldValues } from "./customFields.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── resolveCustomFields ───────────────────────────────────────────────────────

describe("resolveCustomFields", () => {
  it("returns array of { fieldId, value } for valid names", async () => {
    zenstackMock.mockResolvedValueOnce([
      { id: 1, displayName: "Priority" },
      { id: 2, displayName: "Severity" },
    ]);

    const result = await resolveCustomFields(
      { Priority: "High", Severity: 7 },
      env,
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: 1, value: "High" }),
        expect.objectContaining({ fieldId: 2, value: 7 }),
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input without calling zenstack", async () => {
    const result = await resolveCustomFields({}, env);
    expect(result).toEqual([]);
    expect(zenstackMock).not.toHaveBeenCalled();
  });

  it("returns empty array for undefined input without calling zenstack", async () => {
    const result = await resolveCustomFields(undefined, env);
    expect(result).toEqual([]);
    expect(zenstackMock).not.toHaveBeenCalled();
  });

  it("throws TestPlanItHttpError 422 for unknown field name", async () => {
    zenstackMock.mockResolvedValueOnce([{ id: 1, displayName: "Priority" }]);

    const inputValue = "x";
    await expect(
      resolveCustomFields({ Priority: "High", Phantom: inputValue }, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Phantom");
      expect(err.message).toContain("not found");
      // T-06-05: error message MUST NOT contain the value
      expect(err.message).not.toContain(inputValue);
      return true;
    });
  });

  it("throws TestPlanItHttpError 422 for ambiguous displayName", async () => {
    zenstackMock.mockResolvedValueOnce([
      { id: 1, displayName: "Priority" },
      { id: 99, displayName: "Priority" },
    ]);

    await expect(
      resolveCustomFields({ Priority: "High" }, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Priority");
      expect(err.message).toContain("ambiguous");
      return true;
    });
  });

  it("error message for unknown field does not contain the input value (T-06-05)", async () => {
    const secretValue = "SENSITIVE_DATA_12345";
    zenstackMock.mockResolvedValueOnce([]);

    await expect(
      resolveCustomFields({ UnknownField: secretValue }, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.message).not.toContain(secretValue);
      return true;
    });
  });

  it("error message for ambiguous field does not contain the input value (T-06-05)", async () => {
    const secretValue = "SENSITIVE_DATA_67890";
    zenstackMock.mockResolvedValueOnce([
      { id: 1, displayName: "Priority" },
      { id: 2, displayName: "Priority" },
    ]);

    await expect(
      resolveCustomFields({ Priority: secretValue }, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.message).not.toContain(secretValue);
      return true;
    });
  });
});

// ── writeCustomFieldValues ────────────────────────────────────────────────────

describe("writeCustomFieldValues", () => {
  it("updates existing row when findFirst returns a record", async () => {
    // findFirst returns existing record
    zenstackMock.mockResolvedValueOnce({ id: 55 });
    // update resolves successfully
    zenstackMock.mockResolvedValueOnce({});

    await writeCustomFieldValues(
      42,
      [{ fieldId: 1, value: "High", name: "Priority" }],
      env,
    );

    // Second call should be update with where:{id:55}
    expect(zenstackMock).toHaveBeenCalledTimes(2);
    const updateCall = zenstackMock.mock.calls[1];
    expect(updateCall[0]).toBe("caseFieldValues");
    expect(updateCall[1]).toBe("update");
    expect(updateCall[2]).toMatchObject({
      where: { id: 55 },
      data: { value: "High" },
    });
  });

  it("creates new row when findFirst returns null", async () => {
    // findFirst returns null
    zenstackMock.mockResolvedValueOnce(null);
    // create resolves
    zenstackMock.mockResolvedValueOnce({ id: 100 });

    await writeCustomFieldValues(
      42,
      [{ fieldId: 7, value: "Low", name: "Priority" }],
      env,
    );

    expect(zenstackMock).toHaveBeenCalledTimes(2);
    const createCall = zenstackMock.mock.calls[1];
    expect(createCall[0]).toBe("caseFieldValues");
    expect(createCall[1]).toBe("create");
    expect(createCall[2]).toMatchObject({
      data: {
        testCase: { connect: { id: 42 } },
        field: { connect: { id: 7 } },
        value: "Low",
      },
    });
  });

  it("makes no zenstack calls when resolved array is empty", async () => {
    await writeCustomFieldValues(42, [], env);
    expect(zenstackMock).not.toHaveBeenCalled();
  });

  it("processes multiple fields sequentially — upserts each", async () => {
    // First field: existing row
    zenstackMock.mockResolvedValueOnce({ id: 10 });
    zenstackMock.mockResolvedValueOnce({});
    // Second field: no existing row
    zenstackMock.mockResolvedValueOnce(null);
    zenstackMock.mockResolvedValueOnce({ id: 20 });

    await writeCustomFieldValues(
      99,
      [
        { fieldId: 1, value: "A", name: "FieldA" },
        { fieldId: 2, value: "B", name: "FieldB" },
      ],
      env,
    );

    expect(zenstackMock).toHaveBeenCalledTimes(4);
    // First pair: findFirst then update
    expect(zenstackMock.mock.calls[0][1]).toBe("findFirst");
    expect(zenstackMock.mock.calls[1][1]).toBe("update");
    // Second pair: findFirst then create
    expect(zenstackMock.mock.calls[2][1]).toBe("findFirst");
    expect(zenstackMock.mock.calls[3][1]).toBe("create");
  });
});
