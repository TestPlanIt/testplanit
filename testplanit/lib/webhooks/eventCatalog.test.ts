import { describe, expect, it } from "vitest";
import { WEBHOOK_EVENT_CATALOG, listEventCatalog } from "./eventCatalog";

describe("WEBHOOK_EVENT_CATALOG", () => {
  it("returns the same array via the public accessor", () => {
    expect(listEventCatalog()).toBe(WEBHOOK_EVENT_CATALOG);
  });

  it("has unique event names", () => {
    const names = WEBHOOK_EVENT_CATALOG.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every entry has a non-empty description and at least one payload key", () => {
    for (const entry of WEBHOOK_EVENT_CATALOG) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.payloadKeys.length).toBeGreaterThan(0);
    }
  });

  it("every event name is dot-namespaced (entity.verb[.sub])", () => {
    for (const entry of WEBHOOK_EVENT_CATALOG) {
      expect(entry.name).toMatch(/^[a-z][a-z_]+\.[a-z][a-z_]+(\.[a-z_]+)?$/);
    }
  });

  it("categories are restricted to the known set", () => {
    const allowed = new Set([
      "test-case",
      "test-run",
      "iteration",
      "session",
      "issue",
      "review",
      "system",
    ]);
    for (const entry of WEBHOOK_EVENT_CATALOG) {
      expect(allowed.has(entry.category)).toBe(true);
    }
  });
});
