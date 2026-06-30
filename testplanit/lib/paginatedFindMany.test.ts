import { describe, expect, it, vi } from "vitest";
import { paginatedFindManyWithRelations } from "./paginatedFindMany";

function makeModel(
  rows: Array<{ id: number; order: number; name: string; rel?: unknown }>
) {
  return {
    findMany: vi.fn(async (args: any) => {
      let data = [...rows];
      const idIn = args?.where?.id?.in as number[] | undefined;
      if (idIn) data = data.filter((r) => idIn.includes(r.id));
      if (args?.orderBy?.order === "asc")
        data.sort((a, b) => a.order - b.order || a.id - b.id);
      if (typeof args?.skip === "number") data = data.slice(args.skip);
      if (typeof args?.take === "number") data = data.slice(0, args.take);
      if (
        args?.select &&
        Object.keys(args.select).length === 1 &&
        args.select.id
      )
        return data.map((r) => ({ id: r.id }));
      return data;
    }),
  };
}

describe("paginatedFindManyWithRelations", () => {
  it("returns the same page (rows + order) as a single ordered/paginated findMany", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      order: i + 1,
      name: `case ${i + 1}`,
      rel: { heavy: true },
    }));
    const model = makeModel(rows);
    const page = await paginatedFindManyWithRelations(model, {
      where: { projectId: 1 },
      orderBy: { order: "asc" },
      select: { id: true, name: true, rel: true },
      skip: 10,
      take: 10,
    });
    expect(page.map((r: any) => r.id)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(page.every((r: any) => r.rel)).toBe(true);
  });

  it("runs phase 1 with id-only select and phase 2 narrowed to the page ids", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      order: i + 1,
      name: `c${i + 1}`,
    }));
    const model = makeModel(rows);
    await paginatedFindManyWithRelations(model, {
      where: { projectId: 1 },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
      skip: 0,
      take: 5,
    });
    const calls = model.findMany.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({
      select: { id: true },
      skip: 0,
      take: 5,
      orderBy: { order: "asc" },
    });
    expect(calls[1][0].where).toMatchObject({
      projectId: 1,
      id: { in: [1, 2, 3, 4, 5] },
    });
    expect(calls[1][0].skip).toBeUndefined();
    expect(calls[1][0].take).toBeUndefined();
  });

  it("short-circuits to [] without a phase-2 query when the page is empty", async () => {
    const model = makeModel([]);
    const page = await paginatedFindManyWithRelations(model, {
      where: { projectId: 1 },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
      skip: 0,
      take: 10,
    });
    expect(page).toEqual([]);
    expect(model.findMany).toHaveBeenCalledTimes(1);
  });

  it("preserves phase-1 order even if phase 2 returns ids in a different order", async () => {
    const model = {
      findMany: vi.fn(async (args: any) => {
        if (args.select && Object.keys(args.select).length === 1)
          return [{ id: 3 }, { id: 1 }, { id: 2 }];
        return [
          { id: 1, name: "b" },
          { id: 2, name: "c" },
          { id: 3, name: "a" },
        ];
      }),
    };
    const page = await paginatedFindManyWithRelations(model, {
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    });
    expect(page.map((r: any) => r.id)).toEqual([3, 1, 2]);
  });

  it("drops page ids that phase 2 elides (e.g. policy-filtered between phases)", async () => {
    const model = {
      findMany: vi.fn(async (args: any) => {
        if (args.select && Object.keys(args.select).length === 1)
          return [{ id: 1 }, { id: 2 }, { id: 3 }];
        return [
          { id: 1, name: "x" },
          { id: 3, name: "z" },
        ];
      }),
    };
    const page = await paginatedFindManyWithRelations(model, {
      select: { id: true, name: true },
    });
    expect(page.map((r: any) => r.id)).toEqual([1, 3]);
  });
});
