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

describe("scim.user.* catalog entries", () => {
  it("scim.user.created is present with category 'system' and the documented payloadKeys", () => {
    const def = WEBHOOK_EVENT_CATALOG.find(
      (e) => e.name === "scim.user.created"
    );
    expect(def).toBeDefined();
    expect(def?.category).toBe("system");
    expect(def?.payloadKeys).toEqual([
      "id",
      "scimExternalId",
      "userName",
      "email",
      "active",
      "name",
      "createdAt",
    ]);
  });

  it("scim.user.updated is present with category 'system' and the documented payloadKeys", () => {
    const def = WEBHOOK_EVENT_CATALOG.find(
      (e) => e.name === "scim.user.updated"
    );
    expect(def).toBeDefined();
    expect(def?.category).toBe("system");
    expect(def?.payloadKeys).toEqual([
      "id",
      "scimExternalId",
      "userName",
      "email",
      "after",
      "diff",
    ]);
  });

  it("scim.user.activated is present with category 'system' and the documented payloadKeys", () => {
    const def = WEBHOOK_EVENT_CATALOG.find(
      (e) => e.name === "scim.user.activated"
    );
    expect(def).toBeDefined();
    expect(def?.category).toBe("system");
    expect(def?.payloadKeys).toEqual(["id", "scimExternalId", "userName"]);
  });

  it("scim.user.deactivated is present with category 'system' and the documented payloadKeys", () => {
    const def = WEBHOOK_EVENT_CATALOG.find(
      (e) => e.name === "scim.user.deactivated"
    );
    expect(def).toBeDefined();
    expect(def?.category).toBe("system");
    expect(def?.payloadKeys).toEqual(["id", "scimExternalId", "userName"]);
  });

  it("scim.user.deleted is present with category 'system' and the documented payloadKeys", () => {
    const def = WEBHOOK_EVENT_CATALOG.find(
      (e) => e.name === "scim.user.deleted"
    );
    expect(def).toBeDefined();
    expect(def?.category).toBe("system");
    expect(def?.payloadKeys).toEqual(["id", "scimExternalId"]);
  });

  it("all five scim.user.* entries have category 'system'", () => {
    const scimEntries = WEBHOOK_EVENT_CATALOG.filter((e) =>
      e.name.startsWith("scim.user.")
    );
    expect(scimEntries).toHaveLength(5);
    for (const entry of scimEntries) {
      expect(entry.category).toBe("system");
    }
  });

  it("does NOT advertise a scim.user.linked event (bind signaled via audit metadata, not a 6th event type)", () => {
    const linkedEntry = WEBHOOK_EVENT_CATALOG.find(
      (e) => e.name === "scim.user.linked"
    );
    expect(linkedEntry).toBeUndefined();
  });
});
