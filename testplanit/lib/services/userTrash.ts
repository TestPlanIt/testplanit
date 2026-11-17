import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { baseDb } from "~/lib/db";
import {
  areaPermissionsFrom,
  hasProjectAccess,
  resolveEffectiveProjectAccess,
  type EffectiveProjectAccess,
} from "~/lib/services/areaPermission";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { syncRunCaseStatusAfterResultRemoval } from "~/lib/services/runCaseStatusSync";
import {
  RENAMED_ON_DELETE_DELEGATES,
  USER_TRASH_WINDOW_DAYS_DEFAULT,
  USER_TRASH_WINDOW_DAYS_KEY,
  originalName,
  userTrashItemTypeByName,
  userTrashItemTypes,
  type UserTrashChild,
  type UserTrashItem,
  type UserTrashItemType,
} from "~/lib/userTrash/itemTypes";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import type { TxClient } from "~/lib/zenstack";
import type { ApplicationArea } from "~/zenstack/models";

export { USER_TRASH_WINDOW_DAYS_DEFAULT, USER_TRASH_WINDOW_DAYS_KEY };

/** Per-type cap on the rows the list fans out to; the window already bounds it. */
const PER_TYPE_LIMIT = 200;

export async function readUserTrashWindowDays(
  client: Pick<TxClient, "appConfig"> = baseDb
): Promise<number> {
  const row = await client.appConfig.findUnique({
    where: { key: USER_TRASH_WINDOW_DAYS_KEY },
  });
  if (!row) return USER_TRASH_WINDOW_DAYS_DEFAULT;
  const value = row.value as unknown;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return USER_TRASH_WINDOW_DAYS_DEFAULT;
  }
  return Math.floor(parsed);
}

export function userTrashCutoff(windowDays: number, now = new Date()): Date {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}

type Row = Record<string, unknown> & { id: number | string };

type Delegate = {
  findMany: (args: unknown) => Promise<Row[]>;
  findUnique: (args: unknown) => Promise<Row | null>;
  update: (args: unknown) => Promise<Row>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

function delegateOf(client: unknown, name: string): Delegate {
  const model = (client as Record<string, unknown>)[name];
  if (!model) throw new Error(`Unknown delegate ${name}`);
  return model as Delegate;
}

function nameOf(row: Row | null | undefined, field: string): string {
  const value = row?.[field];
  return typeof value === "string" ? value : "";
}

function displayName(entry: UserTrashItemType, row: Row): string {
  const name = nameOf(row, entry.nameField);
  return RENAMED_ON_DELETE_DELEGATES.has(entry.delegate)
    ? originalName(name)
    : name;
}

/** The update that un-deletes a row, giving a renamed-on-delete row its original name back. */
function restoreData(delegate: string, row: Row): Record<string, unknown> {
  if (!RENAMED_ON_DELETE_DELEGATES.has(delegate)) return { isDeleted: false };
  const name = nameOf(row, "name");
  const original = originalName(name);
  return original === name
    ? { isDeleted: false }
    : { isDeleted: false, name: original };
}

/**
 * Resolves the project id, the permission area and the container label for one
 * row. Returns null when the row cannot reach a project (an attachment whose
 * parent is gone, an issue without a project) or when its container is deleted.
 */
async function resolveScope(
  entry: UserTrashItemType,
  row: Row,
  cache: Map<string, Promise<Row | null>>
): Promise<{
  projectId: number;
  area: ApplicationArea;
  context: string | null;
  parentDeleted: boolean;
} | null> {
  const load = (delegate: string, id: unknown) => {
    const key = `${delegate}:${String(id)}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = delegateOf(baseDb, delegate).findUnique({ where: { id } });
      cache.set(key, pending);
    }
    return pending;
  };

  if (entry.project.kind === "own") {
    const projectId = row.projectId;
    if (typeof projectId !== "number") return null;
    let context: string | null = null;
    let parentDeleted = false;
    if (entry.parent) {
      const parentId = row[entry.parent.fk];
      if (parentId != null) {
        const parent = await load(entry.parent.delegate, parentId);
        if (!parent) return null;
        parentDeleted = parent.isDeleted === true;
        context = nameOf(parent, entry.parent.nameField) || null;
      }
    }
    return { projectId, area: entry.area, context, parentDeleted };
  }

  for (const parentCfg of entry.project.parents) {
    const parentId = row[parentCfg.fk];
    if (parentId == null) continue;
    const parent = await load(parentCfg.delegate, parentId);
    if (!parent) return null;
    let projectRow: Row | null = parent;
    if (parentCfg.projectVia) {
      const viaId = parent[parentCfg.projectVia.fk];
      projectRow =
        viaId == null ? null : await load(parentCfg.projectVia.delegate, viaId);
      if (!projectRow) return null;
    }
    const projectId = projectRow.projectId;
    if (typeof projectId !== "number") return null;
    return {
      projectId,
      area: parentCfg.area,
      context: nameOf(projectRow, parentCfg.nameField) || null,
      parentDeleted: parent.isDeleted === true || projectRow.isDeleted === true,
    };
  }
  return null;
}

/** One ladder walk per (user, project) for the whole list. */
function accessResolver(userId: string) {
  const cache = new Map<number, Promise<EffectiveProjectAccess>>();
  return (projectId: number) => {
    let pending = cache.get(projectId);
    if (!pending) {
      pending = resolveEffectiveProjectAccess(userId, projectId);
      cache.set(projectId, pending);
    }
    return pending;
  };
}

function mayRestore(
  access: EffectiveProjectAccess,
  area: ApplicationArea
): boolean {
  return (
    hasProjectAccess(access) && areaPermissionsFrom(access, area).canAddEdit
  );
}

/**
 * Everything `userId` deleted, inside the window, of a user-restorable type, in
 * a live project they can still edit, whose container is live. Newest first.
 */
export async function listUserTrash(
  userId: string,
  options: { windowDays?: number; now?: Date } = {}
): Promise<{ windowDays: number; items: UserTrashItem[] }> {
  const windowDays = options.windowDays ?? (await readUserTrashWindowDays());
  if (windowDays <= 0) return { windowDays, items: [] };
  const now = options.now ?? new Date();
  const cutoff = userTrashCutoff(windowDays, now);
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const perType = await Promise.all(
    userTrashItemTypes.map(async (entry) => {
      const rows = await delegateOf(baseDb, entry.delegate).findMany({
        where: {
          isDeleted: true,
          deletedById: userId,
          deletedAt: { gte: cutoff },
        },
        orderBy: { deletedAt: "desc" },
        take: PER_TYPE_LIMIT,
      });
      return { entry, rows };
    })
  );

  const rowCache = new Map<string, Promise<Row | null>>();
  const scoped = (
    await Promise.all(
      perType.flatMap(({ entry, rows }) =>
        rows.map(async (row) => {
          const scope = await resolveScope(entry, row, rowCache);
          if (!scope || scope.parentDeleted) return null;
          return { entry, row, scope };
        })
      )
    )
  ).filter((item) => item !== null);

  const projectIds = [...new Set(scoped.map((item) => item.scope.projectId))];
  const projects = projectIds.length
    ? await baseDb.projects.findMany({
        where: { id: { in: projectIds }, isDeleted: false },
        select: { id: true, name: true },
      })
    : [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const resolveAccess = accessResolver(userId);
  const items: UserTrashItem[] = [];
  for (const { entry, row, scope } of scoped) {
    const name = projectName.get(scope.projectId);
    if (name === undefined) continue;
    const access = await resolveAccess(scope.projectId);
    if (!mayRestore(access, scope.area)) continue;
    const deletedAt = row.deletedAt as Date;
    items.push({
      itemType: entry.itemType,
      id: String(row.id),
      name: displayName(entry, row),
      projectId: scope.projectId,
      projectName: name,
      context: scope.context,
      deletedAt: deletedAt.toISOString(),
      restorableUntil: new Date(deletedAt.getTime() + windowMs).toISOString(),
    });
  }
  items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return { windowDays, items };
}

export type { UserTrashItem };

export type UserTrashRestoreFailure =
  | "unknown_type"
  | "not_found"
  | "disabled"
  | "not_owner"
  | "expired"
  | "forbidden"
  | "parent_deleted"
  | "name_conflict";

export class UserTrashRestoreError extends Error {
  constructor(public readonly code: UserTrashRestoreFailure) {
    super(code);
    this.name = "UserTrashRestoreError";
  }
}

/**
 * Run-cases whose results came back in a cascade. `TestRunCases.statusId` is
 * denormalized from the newest live result, and deleting a result (which is
 * what put it in the cascade's path — deleting a run leaves its results alone)
 * re-derived it without that result. Restoring the result has to re-derive it
 * again, once the whole cascade (iterations included) is back.
 */
type TouchedRunCases = Map<
  string,
  { testRunCaseId: number; iterationId: number | null }
>;

const RUN_RESULT_DELEGATE = "testRunResults";

function childSelect(delegate: string): Record<string, true> {
  if (RENAMED_ON_DELETE_DELEGATES.has(delegate)) {
    return { id: true, name: true };
  }
  if (delegate === RUN_RESULT_DELEGATE) {
    return { id: true, testRunCaseId: true, iterationId: true };
  }
  return { id: true };
}

function noteTouchedRunCases(touched: TouchedRunCases, results: Row[]): void {
  for (const result of results) {
    const testRunCaseId = result.testRunCaseId;
    if (typeof testRunCaseId !== "number") continue;
    const iterationId =
      typeof result.iterationId === "number" ? result.iterationId : null;
    touched.set(`${testRunCaseId}:${iterationId ?? ""}`, {
      testRunCaseId,
      iterationId,
    });
  }
}

/**
 * Restores every soft-deleted owned child of `ids`. A self-referencing child
 * (sub-folder, child milestone) is an owner of the same kind, so it receives
 * the whole child set again — that walks the tree to its leaves and restores
 * the cases inside every sub-folder, not only the top one.
 */
async function restoreChildren(
  tx: unknown,
  children: UserTrashChild[],
  ids: Array<number | string>,
  restored: Record<string, number>,
  touched: TouchedRunCases
): Promise<void> {
  if (ids.length === 0) return;
  for (const child of children) {
    const delegate = delegateOf(tx, child.delegate);
    const renamed = RENAMED_ON_DELETE_DELEGATES.has(child.delegate);
    const deleted = await delegate.findMany({
      where: { [child.fk]: { in: ids }, isDeleted: true },
      select: childSelect(child.delegate),
    });
    const childIds = deleted.map((row) => row.id);
    if (childIds.length === 0) continue;
    if (child.delegate === RUN_RESULT_DELEGATE) {
      noteTouchedRunCases(touched, deleted);
    }
    let count: number;
    if (renamed) {
      for (const row of deleted) {
        await delegate.update({
          where: { id: row.id },
          data: restoreData(child.delegate, row),
        });
      }
      count = deleted.length;
    } else {
      ({ count } = await delegate.updateMany({
        where: { id: { in: childIds } },
        data: { isDeleted: false },
      }));
    }
    restored[child.delegate] = (restored[child.delegate] ?? 0) + count;
    await restoreChildren(
      tx,
      child.self ? children : (child.children ?? []),
      childIds,
      restored,
      touched
    );
  }
}

/**
 * Restores one item (and its soft-deleted owned children) on behalf of
 * `actor`. Non-admins must have deleted it themselves, inside the window, and
 * still hold edit permission in a live project; the container must be live.
 * Throws UserTrashRestoreError with a code the route maps to a status.
 */
export async function restoreUserTrashItem(args: {
  actor: { id: string; isAdmin: boolean };
  itemType: string;
  itemId: string;
  now?: Date;
}): Promise<{
  item: Row;
  restored: Record<string, number>;
  projectId: number;
}> {
  const entry = userTrashItemTypeByName[args.itemType];
  if (!entry) throw new UserTrashRestoreError("unknown_type");
  const id = Number.parseInt(args.itemId, 10);
  if (!Number.isInteger(id)) throw new UserTrashRestoreError("not_found");

  const row = await delegateOf(baseDb, entry.delegate).findUnique({
    where: { id },
  });
  if (!row || row.isDeleted !== true) {
    throw new UserTrashRestoreError("not_found");
  }

  const scope = await resolveScope(entry, row, new Map());
  if (!scope) throw new UserTrashRestoreError("not_found");

  if (!args.actor.isAdmin) {
    const windowDays = await readUserTrashWindowDays();
    if (windowDays <= 0) throw new UserTrashRestoreError("disabled");
    if (row.deletedById !== args.actor.id) {
      throw new UserTrashRestoreError("not_owner");
    }
    const deletedAt = row.deletedAt as Date | null;
    if (!deletedAt || deletedAt < userTrashCutoff(windowDays, args.now)) {
      throw new UserTrashRestoreError("expired");
    }
    const project = await baseDb.projects.findUnique({
      where: { id: scope.projectId },
      select: { isDeleted: true },
    });
    if (!project || project.isDeleted) {
      throw new UserTrashRestoreError("forbidden");
    }
    const access = await resolveEffectiveProjectAccess(
      args.actor.id,
      scope.projectId
    );
    if (!mayRestore(access, scope.area)) {
      throw new UserTrashRestoreError("forbidden");
    }
  }
  if (scope.parentDeleted) throw new UserTrashRestoreError("parent_deleted");

  const restored: Record<string, number> = {};
  let item: Row;
  try {
    item = await auditedTransaction(async (tx) => {
      const updated = await delegateOf(tx, entry.delegate).update({
        where: { id },
        data: restoreData(entry.delegate, row),
      });
      const touched: TouchedRunCases = new Map();
      await restoreChildren(tx, entry.children, [id], restored, touched);
      for (const runCase of touched.values()) {
        await syncRunCaseStatusAfterResultRemoval(tx, runCase);
      }
      return updated;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new UserTrashRestoreError("name_conflict");
    }
    throw error;
  }

  await captureAuditEvent({
    action: "UPDATE",
    entityType: entry.modelName,
    entityId: String(id),
    entityName: displayName(entry, item) || undefined,
    projectId: scope.projectId,
    metadata: {
      operation: "restore_from_trash",
      source: "user_trash",
      restoredChildren: restored,
    },
  });

  return { item, restored, projectId: scope.projectId };
}
