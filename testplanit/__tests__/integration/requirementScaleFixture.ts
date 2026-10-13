// Shared scale-fixture builder for every live-DB suite in phase 28 that needs
// a forest of requirement-classified Issue rows larger than any fixture this
// repository has built before (Phase 24's 213-node tree was the previous
// high-water mark). Seeds/tears down against the tpi_req20 scratch database
// ONLY. Every entry point below re-asserts current_database() itself, so a
// caller that forgets its own suite-level guard still cannot reach `ew`.
//
// Not a *.test.ts file: vitest does not collect this module. It is imported
// BY suites, never run standalone.
//
// Batched writes: every generation of the forest is inserted with one
// createMany call (chunked at BATCH_SIZE), not one insert per row -- a
// 1,200-row fixture built one round trip at a time would dominate the
// runtime of every later suite that imports this module.

import { createRawDbClient } from "~/lib/rawDbClient";

export const REQUIREMENT_SCALE_SIZES = {
  belowThreshold: 499,
  atThreshold: 500,
  aboveThreshold: 501,
  large: 1200,
} as const;

export interface SeededForest {
  projectId: number;
  rootIds: number[];
  allIds: number[];
  namePrefix: string;
}

interface SeedRequirementForestOptions {
  size: number;
  namePrefix: string;
  rootCount?: number;
  depth?: number;
  projectId?: number;
}

const BATCH_SIZE = 500;

type RawDbClient = ReturnType<typeof createRawDbClient>;

async function assertScratchDatabase(db: RawDbClient, caller: string) {
  const [{ current_database: dbName }] = await db.$queryRaw<
    Array<{ current_database: string }>
  >`SELECT current_database()`;
  if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
    throw new Error(
      `${caller}: refusing to run against database "${dbName}" -- this fixture builder only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
    );
  }
}

/**
 * Zero-padded ordinal so `ORDER BY name, id` is deterministic and a keyset
 * cursor over (name, id) is testable -- padding width scales with `size` so
 * ordinals never collide lexicographically (e.g. "-10" sorting before "-9"
 * at a fixed 3-digit width).
 */
function paddedName(namePrefix: string, ordinal: number, width: number) {
  return `${namePrefix}-${String(ordinal).padStart(width, "0")}`;
}

interface GenerationRow {
  name: string;
  title: string;
  createdById: string;
  projectId: number;
  isRequirement: true;
  parentId: number | null;
}

async function insertGenerationBatched(
  db: RawDbClient,
  rows: GenerationRow[]
): Promise<Map<string, number>> {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    await db.issue.createMany({ data: batch });
  }
  if (rows.length === 0) return new Map();
  const projectId = rows[0].projectId;
  const inserted = await db.issue.findMany({
    where: { projectId, name: { in: rows.map((r) => r.name) } },
    select: { id: true, name: true },
  });
  return new Map(inserted.map((r) => [r.name, r.id]));
}

/**
 * Seeds a deterministic requirement forest of `opts.size` live, classified
 * (`isRequirement: true`, `isDeleted: false`) requirements, plus one
 * soft-deleted row and one non-requirement row in the same project so every
 * later scope assertion has something to exclude. `rootCount` defaults to
 * roughly half of `size` (flat hierarchies are what a typed import actually
 * produces -- 28-CONTEXT D-03); the remainder are distributed as
 * children/grandchildren under the first half of roots, generation by
 * generation up to `depth` (default 3), so `hasChildren` is true for some
 * roots and false for others within the same page. Any rows left over once
 * `depth` is exhausted become additional flat roots, so the live classified
 * count always equals `size` exactly regardless of the rootCount/depth
 * combination a caller picks.
 */
export async function seedRequirementForest(
  opts: SeedRequirementForestOptions
): Promise<SeededForest> {
  const { size, namePrefix } = opts;
  const rootCount = opts.rootCount ?? Math.max(1, Math.round(size / 2));
  const depth = opts.depth ?? 3;
  const db = createRawDbClient();

  try {
    await assertScratchDatabase(db, "seedRequirementForest");

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
      select: { id: true },
    });
    if (!role) {
      throw new Error(
        "seedRequirementForest: test prerequisite missing -- no default Roles row"
      );
    }

    const admin = await db.user.create({
      data: {
        email: `${namePrefix}-admin@example.com`,
        name: `${namePrefix} Fixture Admin`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });

    let projectId = opts.projectId;
    if (projectId === undefined) {
      const project = await db.projects.create({
        data: { name: `${namePrefix}-project`, createdBy: admin.id },
        select: { id: true },
      });
      projectId = project.id;
    }

    const width = String(size).length;
    const allIds: number[] = [];
    const rootIds: number[] = [];

    // One soft-deleted row and one non-requirement row -- neither counts
    // toward the live classified total, so `size` stays exact.
    const deletedRow = await db.issue.create({
      data: {
        name: `${paddedName(namePrefix, 0, width)}-deleted`,
        title: `${paddedName(namePrefix, 0, width)}-deleted`,
        createdById: admin.id,
        projectId,
        isRequirement: true,
        isDeleted: true,
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    allIds.push(deletedRow.id);

    const nonRequirementRow = await db.issue.create({
      data: {
        name: `${paddedName(namePrefix, 0, width)}-non-requirement`,
        title: `${paddedName(namePrefix, 0, width)}-non-requirement`,
        createdById: admin.id,
        projectId,
        isRequirement: false,
      },
      select: { id: true },
    });
    allIds.push(nonRequirementRow.id);

    // Generation 0: the roots.
    const rootRows: GenerationRow[] = Array.from(
      { length: rootCount },
      (_, i) => ({
        name: paddedName(namePrefix, i + 1, width),
        title: paddedName(namePrefix, i + 1, width),
        createdById: admin.id,
        projectId: projectId!,
        isRequirement: true,
        parentId: null,
      })
    );
    const rootIdByName = await insertGenerationBatched(db, rootRows);
    for (const row of rootRows) {
      const id = rootIdByName.get(row.name);
      if (id === undefined) {
        throw new Error(
          `seedRequirementForest: root row "${row.name}" failed to seed`
        );
      }
      rootIds.push(id);
      allIds.push(id);
    }

    // Remaining rows are distributed as children/grandchildren under the
    // first half of roots, generation by generation -- parents always exist
    // before children because each generation is fully inserted (and its ids
    // looked up) before the next generation's rows are built.
    let ordinal = rootCount + 1;
    let remaining = size - rootCount;
    let currentGeneration = rootIds.slice(0, Math.ceil(rootIds.length / 2));
    let generationDepth = 1;

    while (
      remaining > 0 &&
      currentGeneration.length > 0 &&
      generationDepth < depth
    ) {
      const generationRows: GenerationRow[] = [];
      for (const parentId of currentGeneration) {
        if (remaining <= 0) break;
        const name = paddedName(namePrefix, ordinal, width);
        generationRows.push({
          name,
          title: name,
          createdById: admin.id,
          projectId: projectId!,
          isRequirement: true,
          parentId,
        });
        ordinal++;
        remaining--;
      }

      const idByName = await insertGenerationBatched(db, generationRows);
      const nextGeneration: number[] = [];
      for (const row of generationRows) {
        const id = idByName.get(row.name);
        if (id === undefined) {
          throw new Error(
            `seedRequirementForest: child row "${row.name}" failed to seed`
          );
        }
        allIds.push(id);
        nextGeneration.push(id);
      }

      currentGeneration = nextGeneration;
      generationDepth++;
    }

    // Depth exhausted before size did -- any leftover rows become
    // additional flat roots so the live classified total is exactly `size`.
    if (remaining > 0) {
      const overflowRows: GenerationRow[] = Array.from(
        { length: remaining },
        (_, i) => {
          const name = paddedName(namePrefix, ordinal + i, width);
          return {
            name,
            title: name,
            createdById: admin.id,
            projectId: projectId!,
            isRequirement: true,
            parentId: null,
          };
        }
      );
      const idByName = await insertGenerationBatched(db, overflowRows);
      for (const row of overflowRows) {
        const id = idByName.get(row.name);
        if (id === undefined) {
          throw new Error(
            `seedRequirementForest: overflow root row "${row.name}" failed to seed`
          );
        }
        allIds.push(id);
        rootIds.push(id);
      }
    }

    return { projectId: projectId!, rootIds, allIds, namePrefix };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Removes every row `seedRequirementForest` created, scoped by
 * `namePrefix` -- not merely the ids it returned, so an orphan left behind
 * by a failed prior run under the same prefix is still caught. Asserts zero
 * rows remain afterward; throws (never warns) if any do.
 */
export async function tearDownRequirementForest(
  forest: SeededForest
): Promise<void> {
  const db = createRawDbClient();
  try {
    await assertScratchDatabase(db, "tearDownRequirementForest");

    // Order matters: Projects.createdBy references User with no cascade, so
    // the project must go before the admin user, and Issue rows (which
    // reference both the project and the user) must go before either.
    await db.issue.deleteMany({
      where: { name: { startsWith: forest.namePrefix } },
    });
    await db.projects.deleteMany({
      where: { name: { startsWith: forest.namePrefix } },
    });
    await db.user.deleteMany({
      where: { email: { startsWith: forest.namePrefix } },
    });

    const remaining = await db.issue.count({
      where: { name: { startsWith: forest.namePrefix } },
    });
    if (remaining !== 0) {
      throw new Error(
        `tearDownRequirementForest: ${remaining} row(s) left behind under prefix "${forest.namePrefix}"`
      );
    }
  } finally {
    await db.$disconnect();
  }
}
