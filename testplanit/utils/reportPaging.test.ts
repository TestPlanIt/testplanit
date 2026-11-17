import { describe, expect, it } from "vitest";
import { pageReportRows } from "./reportPaging";

const rows = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  group: Math.floor(i / 5), // groups of 5, 5, 2
}));

describe("pageReportRows", () => {
  it("serves the complete set when pageSize is All or absent", () => {
    expect(
      pageReportRows(rows, { pageSize: "All" }, { maxPageSize: 500 })
    ).toEqual({
      rows,
      offset: 0,
      page: 1,
      pageSize: "All",
    });
    expect(pageReportRows(rows, {}, { maxPageSize: 500 }).rows).toHaveLength(
      12
    );
  });

  it("slices by page number, clamped to the maximum page size", () => {
    const page = pageReportRows(
      rows,
      { page: 2, pageSize: 4 },
      { maxPageSize: 500 }
    );
    expect(page.rows.map((r) => r.id)).toEqual([4, 5, 6, 7]);
    expect(page).toMatchObject({ offset: 4, page: 2, pageSize: 4 });

    const clamped = pageReportRows(
      rows,
      { page: 1, pageSize: 10_000 },
      { maxPageSize: 3 }
    );
    expect(clamped.rows.map((r) => r.id)).toEqual([0, 1, 2]);
    expect(clamped.pageSize).toBe(3);
  });

  it("prefers offset over page, and reports the page the offset implies", () => {
    const page = pageReportRows(
      rows,
      { page: 1, pageSize: 4, offset: 7 },
      { maxPageSize: 500 }
    );
    expect(page.rows.map((r) => r.id)).toEqual([7, 8, 9, 10]);
    expect(page).toMatchObject({ offset: 7, page: 2, pageSize: 4 });
  });

  it("runs a window past its size to finish the group at its end", () => {
    const page = pageReportRows(
      rows,
      { pageSize: 3 },
      { maxPageSize: 500, keepTogether: (a, b) => a.group === b.group }
    );
    // 3 rows asked; rows 3 and 4 belong to row 2's group, so they come too.
    expect(page.rows.map((r) => r.id)).toEqual([0, 1, 2, 3, 4]);

    const next = pageReportRows(
      rows,
      { pageSize: 3, offset: 5 },
      { maxPageSize: 500, keepTogether: (a, b) => a.group === b.group }
    );
    expect(next.rows.map((r) => r.id)).toEqual([5, 6, 7, 8, 9]);

    const last = pageReportRows(
      rows,
      { pageSize: 3, offset: 10 },
      { maxPageSize: 500, keepTogether: (a, b) => a.group === b.group }
    );
    expect(last.rows.map((r) => r.id)).toEqual([10, 11]);
  });

  it("returns an empty window past the end and tolerates nonsense numbers", () => {
    expect(
      pageReportRows(rows, { pageSize: 5, offset: 99 }, { maxPageSize: 500 })
        .rows
    ).toEqual([]);
    const odd = pageReportRows(
      rows,
      { page: "x", pageSize: -4, offset: "nope" },
      { maxPageSize: 500 }
    );
    expect(odd).toMatchObject({ offset: 0, page: 1, pageSize: 1 });
    expect(odd.rows.map((r) => r.id)).toEqual([0]);
  });
});
