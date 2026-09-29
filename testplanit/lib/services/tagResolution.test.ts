import { beforeEach, describe, expect, it, vi } from "vitest";

const tags = vi.hoisted(() => ({
  rows: [] as Array<{ id: number; name: string; isDeleted: boolean }>,
  nextId: 100,
}));

vi.mock("~/lib/db", () => {
  const matches = (where: any) => (t: any) =>
    t.isDeleted === where.isDeleted &&
    t.name.toLowerCase() === where.name.equals.toLowerCase();
  return {
    baseDb: {
      tags: {
        findFirst: vi.fn(async ({ where }: any) => {
          const t = tags.rows.find(matches(where));
          return t ? { id: t.id, name: t.name } : null;
        }),
        update: vi.fn(async ({ where }: any) => {
          const t = tags.rows.find((r) => r.id === where.id)!;
          t.isDeleted = false;
          return { id: t.id, name: t.name };
        }),
        create: vi.fn(async ({ data }: any) => {
          const t = { id: tags.nextId++, name: data.name, isDeleted: false };
          tags.rows.push(t);
          return { id: t.id, name: t.name };
        }),
      },
    },
  };
});

import { baseDb } from "~/lib/db";
import { resolveTagByName } from "./tagResolution";

describe("resolveTagByName", () => {
  beforeEach(() => {
    tags.rows = [
      { id: 1, name: "Smoke", isDeleted: false },
      { id: 2, name: "API/Auth", isDeleted: false },
      { id: 3, name: "Legacy", isDeleted: true },
    ];
    vi.clearAllMocks();
  });

  it("matches an existing tag regardless of case and surrounding spaces", async () => {
    expect(
      await resolveTagByName(" smoke ", { createIfMissing: true })
    ).toEqual({ id: 1, name: "Smoke", created: false });
    expect(baseDb.tags.create).not.toHaveBeenCalled();
  });

  it("still matches a tag stored with characters the UI would replace", async () => {
    expect(
      await resolveTagByName("API/Auth", { createIfMissing: true })
    ).toMatchObject({ id: 2, created: false });
  });

  it("creates a new tag under the name the UI would give it", async () => {
    const tag = await resolveTagByName(" UI:Login ", { createIfMissing: true });
    expect(tag).toMatchObject({ name: "UI_Login", created: true });
  });

  it("restores a deleted case-variant instead of creating a duplicate", async () => {
    const tag = await resolveTagByName("legacy", { createIfMissing: true });
    expect(tag).toEqual({ id: 3, name: "Legacy", created: true });
    expect(baseDb.tags.create).not.toHaveBeenCalled();
  });

  it("ignores a blank name and does not create when asked not to", async () => {
    expect(await resolveTagByName("   ", { createIfMissing: true })).toBeNull();
    expect(
      await resolveTagByName("Brand new", { createIfMissing: false })
    ).toBeNull();
    expect(baseDb.tags.create).not.toHaveBeenCalled();
  });
});
