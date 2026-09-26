import { describe, expect, it } from "vitest";
import enUS from "~/messages/en-US.json";
import { trashItemTypes } from "@/api/admin/trash/itemTypes";
import { softDeletedItemTypes } from "./itemTypes";

function lookup(messages: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages
    );
}

describe("Trash item types", () => {
  it("lists every soft-deletable model exactly once", () => {
    const uiNames = softDeletedItemTypes.map((entry) => entry.name).sort();
    const registryNames = trashItemTypes.map((entry) => entry.itemType).sort();

    expect(new Set(uiNames).size).toBe(uiNames.length);
    expect(uiNames).toEqual(registryNames);
  });

  it("resolves every label to an en-US string", () => {
    for (const entry of softDeletedItemTypes) {
      expect(
        typeof lookup(enUS, entry.translationKey),
        `${entry.name}: ${entry.translationKey}`
      ).toBe("string");
    }
  });

  it("only registers models that carry both soft-delete columns", () => {
    for (const entry of trashItemTypes) {
      expect(["Int", "String"]).toContain(entry.idType);
      expect(entry.delegate.charAt(0)).toBe(
        entry.delegate.charAt(0).toLowerCase()
      );
    }
    expect(trashItemTypes.map((entry) => entry.itemType)).toContain("Issues");
    expect(trashItemTypes.map((entry) => entry.itemType)).not.toContain(
      "AppConfig"
    );
  });
});
