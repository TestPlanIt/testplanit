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

/**
 * Helper to build the field row shape that the new resolveCustomFields
 * expects (with `type` and `fieldOptions`). Text-typed fields have no
 * options; Dropdown / Multi-Select pass an options array.
 */
function makeField(opts: {
  id: number;
  displayName: string;
  type?: string | null;
  options?: Array<{ id: number; name: string }>;
}) {
  return {
    id: opts.id,
    displayName: opts.displayName,
    type: opts.type !== undefined ? { type: opts.type } : null,
    fieldOptions: (opts.options ?? []).map((o) => ({ fieldOption: o })),
  };
}

/**
 * Wrap field rows as TemplateCaseAssignment rows — the shape the
 * template-scoped resolver now reads (`{ caseField }`).
 */
function asTemplate(fields: ReturnType<typeof makeField>[]) {
  return fields.map((caseField) => ({ caseField }));
}

const TEMPLATE_ID = 22;

describe("resolveCustomFields (template-scoped)", () => {
  it("queries TemplateCaseAssignment scoped to the given templateId", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([makeField({ id: 1, displayName: "Priority", type: "Text" })]),
    );

    await resolveCustomFields({ Priority: "High" }, TEMPLATE_ID, env);

    const [model, op, body] = zenstackMock.mock.calls[0];
    expect(model).toBe("templateCaseAssignment");
    expect(op).toBe("findMany");
    expect((body as { where: Record<string, unknown> }).where).toMatchObject({
      templateId: TEMPLATE_ID,
      caseField: { isDeleted: false, isEnabled: true },
    });
  });

  it("returns array of { fieldId, value } for valid names (Text/Number pass through)", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([
        makeField({ id: 1, displayName: "Priority", type: "Text" }),
        makeField({ id: 2, displayName: "Severity", type: "Number" }),
      ]),
    );

    const result = await resolveCustomFields(
      { Priority: "High", Severity: 7 },
      TEMPLATE_ID,
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
    const result = await resolveCustomFields({}, TEMPLATE_ID, env);
    expect(result).toEqual([]);
    expect(zenstackMock).not.toHaveBeenCalled();
  });

  it("returns empty array for undefined input without calling zenstack", async () => {
    const result = await resolveCustomFields(undefined, TEMPLATE_ID, env);
    expect(result).toEqual([]);
    expect(zenstackMock).not.toHaveBeenCalled();
  });

  it("throws TestPlanItHttpError 422 for a field not on the template", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([makeField({ id: 1, displayName: "Priority", type: "Text" })]),
    );

    const inputValue = "x";
    await expect(
      resolveCustomFields(
        { Priority: "High", Phantom: inputValue },
        TEMPLATE_ID,
        env,
      ),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Phantom");
      expect(err.message).toContain("not part of the selected template");
      // T-06-05: error message MUST NOT contain the value
      expect(err.message).not.toContain(inputValue);
      return true;
    });
  });

  it("disambiguates a globally-duplicated display name via the template scope", async () => {
    // Two enabled CaseFields share the name "Description" deployment-wide, but
    // only one (id 7) is assigned to this template — the resolver picks it
    // without the global-ambiguity error the old global lookup raised.
    zenstackMock.mockResolvedValueOnce(
      asTemplate([makeField({ id: 7, displayName: "Description", type: "Text" })]),
    );

    const result = await resolveCustomFields(
      { Description: "hello" },
      TEMPLATE_ID,
      env,
    );
    expect(result).toEqual([
      expect.objectContaining({ fieldId: 7, value: "hello", name: "Description" }),
    ]);
  });

  it("throws 422 when the template itself has two fields with the same display name", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([
        makeField({ id: 1, displayName: "Priority", type: "Text" }),
        makeField({ id: 99, displayName: "Priority", type: "Text" }),
      ]),
    );

    await expect(
      resolveCustomFields({ Priority: "High" }, TEMPLATE_ID, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Priority");
      expect(err.message).toContain("ambiguous");
      return true;
    });
  });

  it("error message for an out-of-template field does not contain the input value (T-06-05)", async () => {
    const secretValue = "SENSITIVE_DATA_12345";
    zenstackMock.mockResolvedValueOnce(asTemplate([]));

    await expect(
      resolveCustomFields({ UnknownField: secretValue }, TEMPLATE_ID, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.message).not.toContain(secretValue);
      return true;
    });
  });

  // ── WR-01 / WR-02: Dropdown / Multi-Select round-trip ────────────────────

  it("WR-02: Dropdown by option NAME resolves to canonical option ID (round-trip from read path)", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([
        makeField({
          id: 1,
          displayName: "Priority",
          type: "Dropdown",
          options: [
            { id: 147, name: "High" },
            { id: 148, name: "Medium" },
          ],
        }),
      ]),
    );

    const result = await resolveCustomFields({ Priority: "High" }, TEMPLATE_ID, env);
    expect(result).toEqual([
      expect.objectContaining({ fieldId: 1, value: 147, name: "Priority" }),
    ]);
  });

  it("WR-02: Dropdown by option ID stays as ID", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([
        makeField({
          id: 1,
          displayName: "Priority",
          type: "Dropdown",
          options: [
            { id: 147, name: "High" },
            { id: 148, name: "Medium" },
          ],
        }),
      ]),
    );

    const result = await resolveCustomFields({ Priority: 147 }, TEMPLATE_ID, env);
    expect(result).toEqual([
      expect.objectContaining({ fieldId: 1, value: 147 }),
    ]);
  });

  it("WR-02: Dropdown with unknown option name throws 422 with field name only (T-06-05)", async () => {
    const secretValue = "Phantom_OPTION_VALUE";
    zenstackMock.mockResolvedValueOnce(
      asTemplate([
        makeField({
          id: 1,
          displayName: "Priority",
          type: "Dropdown",
          options: [{ id: 147, name: "High" }],
        }),
      ]),
    );

    await expect(
      resolveCustomFields({ Priority: secretValue }, TEMPLATE_ID, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Priority");
      expect(err.message).not.toContain(secretValue);
      return true;
    });
  });

  it("WR-02: Multi-Select by option names resolves to canonical option ID array", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([
        makeField({
          id: 5,
          displayName: "Tags",
          type: "Multi-Select",
          options: [
            { id: 10, name: "alpha" },
            { id: 11, name: "beta" },
            { id: 12, name: "gamma" },
          ],
        }),
      ]),
    );

    const result = await resolveCustomFields(
      { Tags: ["alpha", "gamma"] },
      TEMPLATE_ID,
      env,
    );
    const value = result[0]!.value as number[];
    expect(value).toEqual([10, 12]);
  });

  it("WR-02: Multi-Select with non-array value throws 422", async () => {
    zenstackMock.mockResolvedValueOnce(
      asTemplate([
        makeField({
          id: 5,
          displayName: "Tags",
          type: "Multi-Select",
          options: [{ id: 10, name: "alpha" }],
        }),
      ]),
    );

    await expect(
      resolveCustomFields({ Tags: "alpha" }, TEMPLATE_ID, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Tags");
      expect(err.message).toContain("array");
      return true;
    });
  });
});

// ── resolveCustomFields (global, templateId undefined — cases_list filter) ────

describe("resolveCustomFields (global, no template)", () => {
  it("queries the global CaseFields catalog filtered by the input names", async () => {
    zenstackMock.mockResolvedValueOnce([
      makeField({ id: 1, displayName: "Priority", type: "Text" }),
    ]);

    const result = await resolveCustomFields({ Priority: "High" }, undefined, env);

    const [model, op, body] = zenstackMock.mock.calls[0];
    expect(model).toBe("caseFields");
    expect(op).toBe("findMany");
    expect((body as { where: Record<string, unknown> }).where).toMatchObject({
      displayName: { in: ["Priority"] },
      isDeleted: false,
      isEnabled: true,
    });
    expect(result).toEqual([
      expect.objectContaining({ fieldId: 1, value: "High", name: "Priority" }),
    ]);
  });

  it("throws 422 'not found ... in this deployment' for an unknown name", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await expect(
      resolveCustomFields({ Phantom: "x" }, undefined, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Phantom");
      expect(err.message).toContain("deployment");
      return true;
    });
  });

  it("throws 422 'ambiguous ... multiple enabled fields' for a globally-duplicated name", async () => {
    zenstackMock.mockResolvedValueOnce([
      makeField({ id: 1, displayName: "Description", type: "Text" }),
      makeField({ id: 2, displayName: "Description", type: "Text" }),
    ]);

    await expect(
      resolveCustomFields({ Description: "x" }, undefined, env),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof TestPlanItHttpError)) return false;
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain("Description");
      expect(err.message).toContain("ambiguous");
      expect(err.message).toContain("multiple enabled fields");
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
