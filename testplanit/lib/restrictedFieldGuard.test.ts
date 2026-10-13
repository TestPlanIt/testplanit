import { beforeEach, describe, expect, it, vi } from "vitest";

const permission = vi.hoisted(() => ({ allowed: false }));
vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: vi.fn(async () => permission.allowed),
}));

import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import {
  assertRestrictedFieldWrite,
  type RestrictedFieldReader,
} from "./restrictedFieldGuard";

const RESTRICTED = { id: 9, displayName: "Secret" };

function reader(
  stored: unknown,
  type = "Text String",
  restricted = true
): RestrictedFieldReader {
  return {
    caseFields: {
      findMany: vi.fn(async () =>
        restricted ? [{ ...RESTRICTED, type: { type } }] : []
      ),
    },
    caseFieldValues: {
      findFirst: vi.fn(async () => ({
        fieldId: RESTRICTED.id,
        testCaseId: 5,
        value: stored,
      })),
    },
    repositoryCases: {
      findUnique: vi.fn(async () => ({ projectId: 1 })),
    },
  } as unknown as RestrictedFieldReader;
}

const USER = { id: "u1", access: "USER" };

const update = (value: unknown, r: RestrictedFieldReader, actor = USER) =>
  assertRestrictedFieldWrite(
    "CaseFieldValues",
    "update",
    { where: { id: 3 }, data: { value } },
    actor,
    r
  );

describe("assertRestrictedFieldWrite", () => {
  beforeEach(() => {
    permission.allowed = false;
    vi.clearAllMocks();
  });

  it("refuses a change to a restricted field without permission", async () => {
    await expect(update("changed", reader("original"))).rejects.toThrow(
      "Custom field 'Secret' is restricted"
    );
  });

  it("allows the change with the restricted-fields permission", async () => {
    permission.allowed = true;
    await expect(
      update("changed", reader("original"))
    ).resolves.toBeUndefined();
    expect(userCanAddEditArea).toHaveBeenCalledWith(
      "u1",
      1,
      "TestCaseRestrictedFields",
      "USER"
    );
  });

  it("lets an unchanged value through, however it is serialized", async () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };
    // A document the editor re-serialized, a number sent as a string, the
    // same options in another order, and an empty value that stays empty.
    await update(JSON.stringify(doc), reader(doc, "Text Long"));
    await update("5", reader(5, "Integer"));
    await update([2, 1], reader([1, 2], "Multi-Select"));
    await update("", reader(null));
    expect(userCanAddEditArea).not.toHaveBeenCalled();
  });

  it("checks a new restricted value on create", async () => {
    await expect(
      assertRestrictedFieldWrite(
        "CaseFieldValues",
        "create",
        {
          data: {
            testCase: { connect: { id: 5 } },
            field: { connect: { id: 9 } },
            value: "x",
          },
        },
        USER,
        reader(undefined)
      )
    ).rejects.toThrow(/restricted/);
  });

  it("skips admins, server-side writes and unrestricted fields", async () => {
    await update("changed", reader("original"), { id: "a", access: "ADMIN" });
    await assertRestrictedFieldWrite(
      "CaseFieldValues",
      "update",
      { where: { id: 3 }, data: { value: "changed" } },
      undefined,
      reader("original")
    );
    await update("changed", reader("original", "Text String", false));
    expect(userCanAddEditArea).not.toHaveBeenCalled();
  });
});
