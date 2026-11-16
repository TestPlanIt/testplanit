import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, findProjects, queryRaw, executed, pageRows } = vi.hoisted(
  () => ({
    findMany: vi.fn(),
    findProjects: vi.fn(),
    queryRaw: vi.fn(),
    /** Every statement the page query sent, as compiled SQL. */
    executed: [] as { sql: string; parameters: readonly unknown[] }[],
    /** What the next page query returns. */
    pageRows: { current: [] as { id: number; total: bigint }[] },
  })
);

vi.mock("~/server/db", async () => {
  const {
    DummyDriver,
    Kysely,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
  } = await import("kysely");

  // A real Postgres query compiler over a driver that records the statement
  // and answers with canned rows, so tests see the SQL that would be sent.
  class RecordingDriver extends DummyDriver {
    async acquireConnection() {
      return {
        executeQuery: async (compiled: any) => {
          executed.push({ sql: compiled.sql, parameters: compiled.parameters });
          return { rows: pageRows.current };
        },
        streamQuery: async function* () {},
      } as any;
    }
  }

  return {
    db: {
      attachments: { findMany },
      projects: { findMany: findProjects },
      $queryRaw: queryRaw,
      $qb: new Kysely<any>({
        dialect: {
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => new RecordingDriver(),
          createIntrospector: (db) => new PostgresIntrospector(db),
          createQueryCompiler: () => new PostgresQueryCompiler(),
        },
      }),
    },
  };
});

import {
  adminAttachmentQuerySchema,
  listAttachmentMimeTypes,
  listAdminAttachmentIds,
  listAdminAttachments,
} from "./adminAttachments";

const query = (input: Record<string, string> = {}) =>
  adminAttachmentQuerySchema.parse(input);

const baseRow = {
  id: 1,
  name: "shot.png",
  note: null,
  url: "/api/storage/uploads/attachments/shot.png",
  mimeType: "image/png",
  size: BigInt(2048),
  createdAt: new Date("2026-11-01T10:00:00Z"),
  createdBy: { id: "u1", name: "Ada" },
  isDeleted: false,
  deletedAt: null,
};

describe("adminAttachmentQuerySchema", () => {
  it("lists attachments, newest first, 25 at a time by default", () => {
    expect(query()).toMatchObject({
      sortBy: "createdAt",
      sortDir: "desc",
      skip: 0,
      take: 25,
    });
  });

  it("rejects a sort column it does not offer and an oversized page", () => {
    expect(
      adminAttachmentQuerySchema.safeParse({ sortBy: "url" }).success
    ).toBe(false);
    expect(adminAttachmentQuerySchema.safeParse({ take: "5000" }).success).toBe(
      false
    );
  });
});

/** Run a list and return the page statement it sent, whitespace collapsed. */
async function pageQuery(input: Record<string, string> = {}) {
  executed.length = 0;
  await listAdminAttachments(query(input));
  const [statement] = executed;
  return {
    sql: statement.sql.replace(/\s+/g, " "),
    parameters: statement.parameters,
  };
}

describe("listAdminAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageRows.current = [];
    findMany.mockResolvedValue([]);
    findProjects.mockResolvedValue([{ id: 7, name: "Web" }]);
  });

  describe("the page query", () => {
    it("lists files and external links together when nothing narrows it", async () => {
      const { sql } = await pageQuery();
      expect(sql).not.toContain("WHERE a.");
      expect(sql).toMatch(/FROM "Attachments" a ORDER BY/);
    });

    it("narrows to external links through the type filter", async () => {
      const { sql, parameters } = await pageQuery({
        mimeTypes: "text/uri-list",
      });
      expect(sql).toContain('a."mimeType" IN ($1)');
      expect(parameters[0]).toBe("text/uri-list");
    });

    it("filters by what the attachment hangs off", async () => {
      const { sql } = await pageQuery({ parentTypes: "testRun" });
      expect(sql).toContain('a."testRunsId" IS NOT NULL');
    });

    it("keeps attachments on any of several parent types", async () => {
      const { sql } = await pageQuery({ parentTypes: "case,session,none" });
      expect(sql).toMatch(
        /\(a\."testCaseId" IS NOT NULL OR a\."sessionId" IS NOT NULL OR COALESCE\(.*\) IS NULL\)/
      );
    });

    it("keeps attachments in any of several states", async () => {
      const { sql } = await pageQuery({ statuses: "softDeleted,noParent" });
      expect(sql).toMatch(
        /\(a\."isDeleted" = true OR COALESCE\(.*\) IS NULL\)/
      );
    });

    it("finds files served by a host other than the configured storage", async () => {
      vi.stubEnv("AWS_BUCKET_NAME", "bucket");
      vi.stubEnv("AWS_ENDPOINT_URL", "https://Files.example.com");
      const custom = await pageQuery({ statuses: "otherHost" });
      expect(custom.sql).toContain("a.\"url\" ~* '^https?://'");
      expect(custom.sql).toContain(
        "position('/api/storage/' in a.\"url\") = 0"
      );
      expect(custom.parameters).toContain("https://files.example.com/");
      expect(custom.sql).not.toContain("amazonaws.com");

      vi.stubEnv("AWS_ENDPOINT_URL", "");
      const aws = await pageQuery({ statuses: "otherHost" });
      expect(aws.sql).toContain("LIKE '%.amazonaws.com'");
      expect(aws.parameters).toContain("bucket.");
      vi.unstubAllEnvs();
    });

    it("rejects a parent type or state it does not know", () => {
      expect(() => query({ parentTypes: "case,folder" })).toThrow();
      expect(() => query({ statuses: "gone" })).toThrow();
    });

    it("finds attachments with no parent at all", async () => {
      const inputs: Record<string, string>[] = [
        { statuses: "noParent" },
        { parentTypes: "none" },
      ];
      for (const input of inputs) {
        const { sql } = await pageQuery(input);
        expect(sql).toMatch(
          /COALESCE\( a\."testCaseId".*a\."issueId" \) IS NULL/
        );
        expect(sql).not.toContain('LEFT JOIN "RepositoryCases"');
      }
    });

    it("separates the trash from what is live", async () => {
      expect((await pageQuery({ statuses: "live" })).sql).toContain(
        'a."isDeleted" = false'
      );
      expect((await pageQuery({ statuses: "softDeleted" })).sql).toContain(
        'a."isDeleted" = true'
      );
    });

    it("joins the parents only to look for a deleted one or a project", async () => {
      expect((await pageQuery()).sql).not.toContain(
        'LEFT JOIN "RepositoryCases"'
      );

      const deleted = await pageQuery({ statuses: "parentDeleted" });
      expect(deleted.sql).toContain('LEFT JOIN "RepositoryCases" c');
      expect(deleted.sql).toContain('tsrrr."isDeleted"');

      const project = await pageQuery({ projectIds: "7,9" });
      expect(project.sql).toContain('LEFT JOIN "TestRuns" tr');
      expect(project.sql).toMatch(
        /COALESCE\( c\."projectId".*i\."projectId" \) IN \(\$1, \$2\)/
      );
      expect(project.parameters.slice(0, 2)).toEqual([7, 9]);
      expect(() => query({ projectIds: "7,abc" })).toThrow();
    });

    it("keeps attachments created by any of several users", async () => {
      const { sql, parameters } = await pageQuery({ createdByIds: "u1, u2" });
      expect(sql).toContain('a."createdById" IN ($1, $2)');
      expect(parameters.slice(0, 2)).toEqual(["u1", "u2"]);
    });

    it("searches the name and the note for the term as plain text", async () => {
      const { sql, parameters } = await pageQuery({ q: " 100%_done " });
      expect(sql).toContain('(a."name" ILIKE $1 OR a."note" ILIKE $2)');
      expect(parameters[0]).toBe("%100\\%\\_done%");
    });

    it("pages and sorts in the database", async () => {
      const { sql, parameters } = await pageQuery({
        skip: "50",
        take: "25",
        sortBy: "size",
        sortDir: "asc",
      });
      expect(sql).toContain('ORDER BY a."size" ASC, a.id DESC');
      expect(parameters.slice(-3, -1)).toEqual([25, 50]);
    });

    it("narrows to the attachments stored as one attachment's file", async () => {
      const { sql, parameters } = await pageQuery({ sameFileAs: "12" });
      expect(sql).toMatch(
        /a\."url" = \(\s*SELECT same\."url" FROM "Attachments" same WHERE same\.id = \$1/
      );
      expect(parameters).toContain(12);
    });

    it("keeps only the file types asked for", async () => {
      const { sql, parameters } = await pageQuery({
        mimeTypes: "image/png, application/pdf",
      });
      expect(sql).toContain('a."mimeType" IN ($1, $2)');
      expect(parameters.slice(0, 2)).toEqual(["image/png", "application/pdf"]);
      expect((await pageQuery()).sql).not.toContain('a."mimeType" IN');
    });

    it("finds the files that were stored with no type", async () => {
      const { parameters } = await pageQuery({ mimeTypes: "none,image/png" });
      expect(parameters.slice(0, 2)).toEqual(["", "image/png"]);
    });

    it("counts the files that share a URL, never the links", async () => {
      const { sql, parameters } = await pageQuery();
      expect(sql).toContain('COALESCE(uses.n, 1) - 1 AS "sharedWith"');
      expect(sql).toMatch(/WHERE o\."mimeType" <> \$\d+/);
      expect(parameters.at(-1)).toBe("text/uri-list");
    });
  });

  it("returns a file with its storage key, its case and the project name", async () => {
    pageRows.current = [{ id: 1, total: BigInt(40) }];
    findMany.mockResolvedValue([
      {
        ...baseRow,
        testCase: { id: 5, name: "Login", projectId: 7, isDeleted: false },
      },
    ]);

    const { items, totalCount } = await listAdminAttachments(query());

    expect(totalCount).toBe(40);
    expect(items[0]).toMatchObject({
      id: 1,
      kind: "file",
      size: 2048,
      storageKey: "uploads/attachments/shot.png",
      createdAt: "2026-11-01T10:00:00.000Z",
      parent: {
        type: "case",
        entity: "case",
        entityId: 5,
        name: "Login",
        projectId: 7,
        projectName: "Web",
        isDeleted: false,
      },
    });
  });

  it("says how many other attachments share a file, and nothing for a link", async () => {
    pageRows.current = [
      { id: 1, total: BigInt(2), sharedWith: BigInt(3) },
      { id: 2, total: BigInt(2), sharedWith: BigInt(3) },
    ] as any;
    findMany.mockResolvedValue([
      baseRow,
      { ...baseRow, id: 2, mimeType: "text/uri-list" },
    ]);

    const { items } = await listAdminAttachments(query());

    expect(items.map((item) => item.sharedWith)).toEqual([3, 0]);
  });

  it("keeps the page query's order whatever order the rows come back in", async () => {
    pageRows.current = [
      { id: 2, total: BigInt(2) },
      { id: 1, total: BigInt(2) },
    ];
    findMany.mockResolvedValue([baseRow, { ...baseRow, id: 2 }]);

    const { items } = await listAdminAttachments(query());

    expect(items.map((item) => item.id)).toEqual([2, 1]);
  });

  it("names the run a result belongs to and flags a deleted result", async () => {
    pageRows.current = [{ id: 1, total: BigInt(1) }];
    findMany.mockResolvedValue([
      {
        ...baseRow,
        testRunResults: {
          id: 90,
          isDeleted: true,
          testRun: { id: 3, name: "Smoke", projectId: 7, isDeleted: false },
        },
      },
    ]);

    const { items } = await listAdminAttachments(query());

    expect(items[0].parent).toMatchObject({
      type: "testRunResult",
      id: 90,
      entity: "testRun",
      entityId: 3,
      name: "Smoke",
      isDeleted: true,
    });
  });

  it("gives a link no storage key and an unattached row no parent", async () => {
    pageRows.current = [{ id: 1, total: BigInt(1) }];
    findMany.mockResolvedValue([
      { ...baseRow, mimeType: "text/uri-list", url: "https://example.com/x" },
    ]);

    const { items } = await listAdminAttachments(query());

    expect(items[0]).toMatchObject({
      kind: "link",
      storageKey: null,
      parent: null,
    });
    expect(findProjects).not.toHaveBeenCalled();
  });

  it("reads no rows when the page is empty", async () => {
    const result = await listAdminAttachments(query());
    expect(result).toEqual({ items: [], totalCount: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("listAdminAttachmentIds", () => {
  it("returns the ids the same filters match, up to one action's worth", async () => {
    executed.length = 0;
    pageRows.current = [{ id: 9 }, { id: 4 }] as any;

    const ids = await listAdminAttachmentIds(
      query({ statuses: "softDeleted", q: "shot" })
    );

    expect(ids).toEqual([9, 4]);
    const statement = executed[0]!;
    expect(statement.sql).toContain('a."isDeleted" = true');
    expect(statement.sql).toContain('a."name" ILIKE');
    expect(statement.parameters.at(-1)).toBe(50000);
  });
});

describe("listAttachmentMimeTypes", () => {
  it("returns each file type with its count as a number", async () => {
    queryRaw.mockResolvedValue([
      { mimeType: "image/png", count: BigInt(12) },
      { mimeType: "application/pdf", count: BigInt(3) },
    ]);

    expect(await listAttachmentMimeTypes()).toEqual([
      { mimeType: "image/png", count: 12 },
      { mimeType: "application/pdf", count: 3 },
    ]);
  });
});
