/**
 * Configuration-group membership for TestRuns and Sessions.
 *
 * Runs (and sessions) that cover the same logical work across different
 * configurations are linked by a shared `configurationGroupId` uuid. Members
 * are FLAT PEERS — there is no parent/original row, and joining is symmetric.
 * (`duplicatedFromId` is unrelated provenance and is never read or written
 * here.) Two members MAY share the same configuration on purpose, so there is
 * deliberately no uniqueness rule on (group, configuration).
 *
 * Both models carry an identical `configurationGroupId String?` column, so the
 * model-specific bits (which table) are parameterised and runs + sessions share
 * one implementation.
 *
 * Invariants enforced here and at the RPC chokepoint
 * (`app/api/model/[...path]/route.ts`):
 *   - every member of a group shares one `projectId`;
 *   - a record cannot join a group it is already in (no-op) and cannot join
 *     itself (no-op);
 *   - AUTO-DISSOLVE: when a record leaves a group (or is soft-deleted) and
 *     exactly ONE member would remain, the survivor's group id is cleared too.
 *     Five badge sites render "multi-configuration" purely on the field being
 *     non-empty, so a lone survivor would otherwise keep claiming membership.
 *
 * Error messages are server-side and stay English.
 */

import { v4 as uuidv4 } from "uuid";

/** Prisma/ZenStack accessors for the two models that carry the field. */
export type ConfigurationGroupModel = "testRuns" | "sessions";

export const CONFIGURATION_GROUP_MODELS: readonly ConfigurationGroupModel[] = [
  "testRuns",
  "sessions",
];

/**
 * RPC paths arrive verbatim from the client — first-party callers use both
 * `testRuns` (generated hooks) and `TestRuns` (hand-rolled fetches, e.g.
 * `components/tables/TestRunsListDisplay.tsx`). Resolve case-insensitively so
 * the guard cannot be sidestepped by changing the path's casing, and return the
 * canonical accessor for the db client.
 */
export function resolveConfigurationGroupModel(
  model: string | null | undefined
): ConfigurationGroupModel | null {
  if (typeof model !== "string") return null;
  const normalized = model.toLowerCase();
  if (normalized === "testruns") return "testRuns";
  if (normalized === "sessions") return "sessions";
  return null;
}

/** Human label used in the English error messages. */
function modelLabel(model: ConfigurationGroupModel, plural = true): string {
  if (model === "testRuns") return plural ? "test runs" : "test run";
  return plural ? "sessions" : "session";
}

/** Thrown for every invariant violation; surfaced as a 400 at the RPC route. */
export class ConfigurationGroupError extends Error {
  readonly code = "CONFIGURATION_GROUP_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationGroupError";
  }
}

export function isConfigurationGroupError(
  error: unknown
): error is ConfigurationGroupError {
  return (
    error instanceof ConfigurationGroupError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "CONFIGURATION_GROUP_INVALID")
  );
}

/** The slice of a run/session row this module reads. */
export interface ConfigurationGroupMember {
  id: number;
  projectId: number;
  configurationGroupId: string | null;
}

/** A single field write this module wants applied. */
export interface ConfigurationGroupWrite {
  id: number;
  configurationGroupId: string | null;
}

/**
 * Structural db client. Both `baseDb` and a `$transaction` tx satisfy it; plain
 * objects do too, which keeps the unit tests free of a live database.
 */
type GroupDelegate = {
  findUnique: (args: any) => Promise<any>;
  findMany: (args: any) => Promise<any[]>;
  update: (args: any) => Promise<any>;
};
export type ConfigurationGroupDb = Record<string, any> & {
  [K in ConfigurationGroupModel]?: GroupDelegate;
};

const MEMBER_SELECT = {
  id: true,
  projectId: true,
  configurationGroupId: true,
} as const;

/**
 * Mint a group id. Same uuid flavour the create modals use
 * (`AddTestRunModal` / `AddSessionModal`), so ids are indistinguishable
 * whether the group was formed at create time or joined after the fact.
 */
export function newConfigurationGroupId(): string {
  return uuidv4();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Group ids are always uuids — the create modals and this module mint them. */
export function isValidConfigurationGroupId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ───────────────────────────────────────────────────────────────────────────
// Pure planners. Exported so a caller that already holds the rows (the UI's
// switcher / group panel, which reads members through ZenStack hooks) can plan
// the exact writes without a second round trip, and so the rules are testable
// without a db.
// ───────────────────────────────────────────────────────────────────────────

export interface JoinPlan {
  /** The group both records end up in; null when the join is a no-op. */
  groupId: string | null;
  /** Field writes to apply, in order. Empty for a no-op. */
  writes: ConfigurationGroupWrite[];
  /** Group the joining record left, if any — feed to `planDissolve`. */
  vacatedGroupId: string | null;
  /** True when nothing needs to change (self-join, or already in the group). */
  noop: boolean;
}

/**
 * Plan a JOIN of `record` into `target`'s group.
 *
 * When the target has NO group yet — the common case, linking A to B where B
 * was created alone — a fresh uuid is minted and BOTH records are stamped.
 * `mintId` is injectable so tests get deterministic ids.
 */
export function planJoin(
  record: ConfigurationGroupMember,
  target: ConfigurationGroupMember,
  options: {
    model?: ConfigurationGroupModel;
    mintId?: () => string;
  } = {}
): JoinPlan {
  const mintId = options.mintId ?? newConfigurationGroupId;
  if (record.id === target.id) {
    // Joining itself is a no-op, not an error: the UI can't usefully
    // distinguish "already the right answer" from "nothing to do".
    return {
      groupId: record.configurationGroupId,
      writes: [],
      vacatedGroupId: null,
      noop: true,
    };
  }
  if (record.projectId !== target.projectId) {
    throw new ConfigurationGroupError(
      `All ${modelLabel(options.model ?? "testRuns")} in a configuration group must belong to the same project`
    );
  }
  if (
    record.configurationGroupId !== null &&
    record.configurationGroupId === target.configurationGroupId
  ) {
    return {
      groupId: record.configurationGroupId,
      writes: [],
      vacatedGroupId: null,
      noop: true,
    };
  }

  const groupId = target.configurationGroupId ?? mintId();
  const writes: ConfigurationGroupWrite[] = [
    { id: record.id, configurationGroupId: groupId },
  ];
  if (target.configurationGroupId === null) {
    writes.push({ id: target.id, configurationGroupId: groupId });
  }
  return {
    groupId,
    writes,
    vacatedGroupId: record.configurationGroupId,
    noop: false,
  };
}

/**
 * AUTO-DISSOLVE. Given the members that REMAIN in a group after a departure,
 * return the write that clears the lone survivor — or an empty list when the
 * group is empty or still has 2+ members.
 */
export function planDissolve(
  remaining: Array<Pick<ConfigurationGroupMember, "id">>
): ConfigurationGroupWrite[] {
  if (remaining.length !== 1) return [];
  return [{ id: remaining[0].id, configurationGroupId: null }];
}

// ───────────────────────────────────────────────────────────────────────────
// Async helpers. `db` may be `baseDb` or a `$transaction` tx.
// ───────────────────────────────────────────────────────────────────────────

function delegate(db: ConfigurationGroupDb, model: ConfigurationGroupModel) {
  const d = (db as any)[model] as GroupDelegate | undefined;
  if (!d) {
    throw new ConfigurationGroupError(
      `Database client has no ${model} accessor`
    );
  }
  return d;
}

async function loadRecord(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  id: number
): Promise<ConfigurationGroupMember | null> {
  const row = await delegate(db, model).findUnique({
    where: { id },
    select: MEMBER_SELECT,
  });
  return row ?? null;
}

/**
 * Resolve the group of a run/session: its group id and the live (non-deleted)
 * members. A record with no group resolves to `groupId: null` and a single-
 * element `members` list containing itself, so callers can render "1 of 1"
 * without branching.
 */
export async function resolveConfigurationGroup(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  recordId: number
): Promise<{
  record: ConfigurationGroupMember | null;
  groupId: string | null;
  members: ConfigurationGroupMember[];
}> {
  const record = await loadRecord(db, model, recordId);
  if (!record) return { record: null, groupId: null, members: [] };
  if (!record.configurationGroupId) {
    return { record, groupId: null, members: [record] };
  }
  const members = await listGroupMembers(
    db,
    model,
    record.configurationGroupId
  );
  return { record, groupId: record.configurationGroupId, members };
}

/** Live members of a group, oldest id first. */
export async function listGroupMembers(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  groupId: string
): Promise<ConfigurationGroupMember[]> {
  return (await delegate(db, model).findMany({
    where: { configurationGroupId: groupId, isDeleted: false },
    select: MEMBER_SELECT,
    orderBy: { id: "asc" },
  })) as ConfigurationGroupMember[];
}

async function applyWrites(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  writes: ConfigurationGroupWrite[]
): Promise<void> {
  const d = delegate(db, model);
  for (const write of writes) {
    await d.update({
      where: { id: write.id },
      data: { configurationGroupId: write.configurationGroupId },
    });
  }
}

/**
 * AUTO-DISSOLVE for one group id. Clears the survivor when exactly one live
 * member remains. Returns the id that was cleared, or null.
 *
 * Reads at most two rows — the answer only depends on "0, 1, or more".
 */
export async function dissolveIfSingleMember(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  groupId: string | null | undefined
): Promise<number | null> {
  if (!groupId) return null;
  const remaining = (await delegate(db, model).findMany({
    where: { configurationGroupId: groupId, isDeleted: false },
    select: { id: true },
    take: 2,
  })) as Array<{ id: number }>;
  const writes = planDissolve(remaining);
  if (writes.length === 0) return null;
  await applyWrites(db, model, writes);
  return writes[0].id;
}

/** Convenience for the RPC route, which may vacate several groups at once. */
export async function dissolveOrphanedGroups(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  groupIds: Array<string | null | undefined>
): Promise<number[]> {
  const unique = Array.from(
    new Set(groupIds.filter((g): g is string => typeof g === "string" && !!g))
  );
  const dissolved: number[] = [];
  for (const groupId of unique) {
    const id = await dissolveIfSingleMember(db, model, groupId);
    if (id !== null) dissolved.push(id);
  }
  return dissolved;
}

export interface JoinResult {
  groupId: string | null;
  /** False when the join was a no-op (self-join, or already a member). */
  changed: boolean;
  /** Ids whose `configurationGroupId` was written. */
  stamped: number[];
  /** Survivor cleared by auto-dissolve of the group the record left. */
  dissolvedId: number | null;
}

/**
 * JOIN: put `recordId` into `targetId`'s group.
 *
 * If the target has no group yet, a uuid is minted and BOTH records are
 * stamped. If the joining record was already in a different group, that group
 * is auto-dissolved when it drops to a single member.
 */
export async function joinConfigurationGroup(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  args: { recordId: number; targetId: number; mintId?: () => string }
): Promise<JoinResult> {
  const { recordId, targetId } = args;
  const record = await loadRecord(db, model, recordId);
  if (!record) {
    throw new ConfigurationGroupError(
      `The ${modelLabel(model, false)} being updated was not found`
    );
  }
  if (recordId === targetId) {
    return {
      groupId: record.configurationGroupId,
      changed: false,
      stamped: [],
      dissolvedId: null,
    };
  }
  const target = await loadRecord(db, model, targetId);
  if (!target) {
    throw new ConfigurationGroupError(
      `The ${modelLabel(model, false)} to link with was not found`
    );
  }
  if (record.projectId !== target.projectId) {
    throw new ConfigurationGroupError(
      `All ${modelLabel(model)} in a configuration group must belong to the same project`
    );
  }

  const plan = planJoin(record, target, { model, mintId: args.mintId });
  if (plan.noop) {
    return {
      groupId: plan.groupId,
      changed: false,
      stamped: [],
      dissolvedId: null,
    };
  }
  await applyWrites(db, model, plan.writes);
  const dissolvedId = await dissolveIfSingleMember(
    db,
    model,
    plan.vacatedGroupId
  );
  return {
    groupId: plan.groupId,
    changed: true,
    stamped: plan.writes.map((w) => w.id),
    dissolvedId,
  };
}

export interface LeaveResult {
  changed: boolean;
  /** The group the record left. */
  groupId: string | null;
  /** Survivor cleared by auto-dissolve, when the group dropped to one. */
  dissolvedId: number | null;
}

/** LEAVE: clear this record's group, then auto-dissolve the remainder. */
export async function leaveConfigurationGroup(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  args: { recordId: number }
): Promise<LeaveResult> {
  const record = await loadRecord(db, model, args.recordId);
  if (!record || !record.configurationGroupId) {
    return { changed: false, groupId: null, dissolvedId: null };
  }
  const groupId = record.configurationGroupId;
  await applyWrites(db, model, [{ id: record.id, configurationGroupId: null }]);
  const dissolvedId = await dissolveIfSingleMember(db, model, groupId);
  return { changed: true, groupId, dissolvedId };
}

/**
 * Delete hook. A soft-deleted member leaves the group exactly like an explicit
 * LEAVE does — the row keeps its `configurationGroupId`, but every membership
 * read filters `isDeleted: false`, so the remainder can fall to one.
 *
 * `groupId` is optional: after a soft delete the row is still readable, so the
 * hook can recover it. Pass it explicitly for hard deletes (pre-snapshot).
 */
export async function handleMemberDeleted(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  args: { recordId: number; groupId?: string | null }
): Promise<number | null> {
  let groupId = args.groupId ?? null;
  if (!groupId) {
    const record = await loadRecord(db, model, args.recordId);
    groupId = record?.configurationGroupId ?? null;
  }
  return dissolveIfSingleMember(db, model, groupId);
}

// ───────────────────────────────────────────────────────────────────────────
// RPC guard. Consumed by app/api/model/[...path]/route.ts.
// ───────────────────────────────────────────────────────────────────────────

/** What an update/updateMany/upsert body intends to do to the group field. */
export interface ConfigurationGroupIntent {
  /** The payload assigns `configurationGroupId` (including to null). */
  touchesGroup: boolean;
  /** Assigned value; `undefined` when the payload doesn't touch the field. */
  groupId: string | null | undefined;
  /** The payload soft-deletes the row (`isDeleted: true`). */
  removesMember: boolean;
}

const GROUP_WRITE_OPERATIONS = new Set(["update", "updateMany", "upsert"]);

/**
 * Read the group write-intent out of a ZenStack RPC body.
 *
 *   update / updateMany : body.data.configurationGroupId
 *   upsert              : body.update.configurationGroupId  (the update branch;
 *                         upsert.create is a brand-new row and is covered by
 *                         the create-time path in the modals)
 *   delete              : the row is going away entirely
 *
 * Returns `null` when the operation can't touch an existing row's membership,
 * so the caller short-circuits before paying any query cost.
 */
export function readConfigurationGroupIntent(
  operation: string,
  body: any
): ConfigurationGroupIntent | null {
  if (operation === "delete" || operation === "deleteMany") {
    return { touchesGroup: false, groupId: undefined, removesMember: true };
  }
  if (!GROUP_WRITE_OPERATIONS.has(operation)) return null;
  const payload = operation === "upsert" ? body?.update : body?.data;
  if (!payload || typeof payload !== "object") return null;
  const touchesGroup = Object.prototype.hasOwnProperty.call(
    payload,
    "configurationGroupId"
  );
  const removesMember = payload.isDeleted === true;
  if (!touchesGroup && !removesMember) return null;
  return {
    touchesGroup,
    groupId: touchesGroup ? payload.configurationGroupId : undefined,
    removesMember,
  };
}

/**
 * Ids the payload targets, or `null` when they can't be resolved (a
 * `updateMany` whose `where` is a non-id filter). Accepts the scalar and
 * `{ in: [...] }` shapes.
 */
export function readTargetRecordIds(
  operation: string,
  body: any
): number[] | null {
  const raw = body?.where?.id;
  if (raw === undefined || raw === null) return null;
  const coerce = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const scalar = coerce(raw);
  if (scalar !== null) return [scalar];
  if (operation === "updateMany" || operation === "deleteMany") {
    const inList = (raw as { in?: unknown })?.in;
    if (Array.isArray(inList)) {
      const ids = inList.map(coerce);
      if (ids.every((id): id is number => id !== null) && ids.length > 0) {
        return ids;
      }
    }
  }
  return null;
}

/**
 * `configurationGroupId` values a create/createMany payload wants to stamp,
 * paired with the projectId the new row lands in (null when the payload
 * expresses it in a shape we can't read — the guard then relies on the existing
 * members alone). Returns `null` when the operation can't mint membership, so
 * the caller pays no query cost.
 *
 * The create modals are the canonical caller: they mint one fresh uuid and
 * stamp it on every row of a multi-configuration batch, which has no existing
 * members and therefore always passes.
 */
export function readConfigurationGroupCreateIntents(
  operation: string,
  body: any
): Array<{ groupId: string; projectId: number | null }> | null {
  if (operation !== "create" && operation !== "createMany") return null;
  const raw = body?.data;
  const rows: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const intents: Array<{ groupId: string; projectId: number | null }> = [];
  for (const rowData of rows) {
    const groupId = rowData?.configurationGroupId;
    if (typeof groupId !== "string" || groupId === "") continue;
    const rawProjectId =
      rowData?.projectId ?? rowData?.project?.connect?.id ?? null;
    const projectId =
      typeof rawProjectId === "number" && Number.isFinite(rawProjectId)
        ? rawProjectId
        : typeof rawProjectId === "string" && rawProjectId !== ""
          ? Number(rawProjectId)
          : null;
    intents.push({
      groupId,
      projectId:
        projectId !== null && Number.isFinite(projectId) ? projectId : null,
    });
  }
  return intents.length > 0 ? intents : null;
}

/**
 * Shared invariant: the union of the projectIds already in the group and the
 * projectIds joining it must be a single project.
 */
async function assertOneProjectPerGroup(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  groupId: string,
  incomingProjectIds: number[],
  ignoreMemberIds: number[] = []
): Promise<void> {
  const members = (await delegate(db, model).findMany({
    where: { configurationGroupId: groupId, isDeleted: false },
    select: MEMBER_SELECT,
  })) as ConfigurationGroupMember[];

  const projectIds = new Set<number>(incomingProjectIds);
  for (const member of members ?? []) {
    // A record re-asserting its own membership is a no-op, not a join.
    if (ignoreMemberIds.includes(member.id)) continue;
    projectIds.add(member.projectId);
  }
  if (projectIds.size > 1) {
    throw new ConfigurationGroupError(
      `All ${modelLabel(model)} in a configuration group must belong to the same project`
    );
  }
}

/**
 * Server-side invariant check for a `configurationGroupId` assignment on a
 * create / createMany payload.
 */
export async function assertConfigurationGroupCreateAllowed(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  intents: Array<{ groupId: string; projectId: number | null }>
): Promise<void> {
  const byGroup = new Map<string, number[]>();
  for (const intent of intents) {
    if (!isValidConfigurationGroupId(intent.groupId)) {
      throw new ConfigurationGroupError(
        "configurationGroupId must be a UUID or null"
      );
    }
    const list = byGroup.get(intent.groupId) ?? [];
    if (intent.projectId !== null) list.push(intent.projectId);
    byGroup.set(intent.groupId, list);
  }
  for (const [groupId, projectIds] of byGroup) {
    await assertOneProjectPerGroup(db, model, groupId, projectIds);
  }
}

/**
 * Server-side invariant check for a `configurationGroupId` assignment arriving
 * on the generic RPC route. Clearing the field (null) is always allowed —
 * leaving a group is unconditional, and completed / composition-locked records
 * may join and leave freely by product decision.
 */
export async function assertConfigurationGroupWriteAllowed(
  db: ConfigurationGroupDb,
  model: ConfigurationGroupModel,
  args: { recordIds: number[] | null; groupId: string | null | undefined }
): Promise<void> {
  const { groupId, recordIds } = args;
  if (groupId === null || groupId === undefined) return;
  if (!isValidConfigurationGroupId(groupId)) {
    throw new ConfigurationGroupError(
      "configurationGroupId must be a UUID or null"
    );
  }
  if (!recordIds || recordIds.length === 0) {
    throw new ConfigurationGroupError(
      "configurationGroupId can only be set on specific records identified by id"
    );
  }

  const records = (await delegate(db, model).findMany({
    where: { id: { in: recordIds } },
    select: MEMBER_SELECT,
  })) as ConfigurationGroupMember[];

  await assertOneProjectPerGroup(
    db,
    model,
    groupId,
    (records ?? []).map((r) => r.projectId),
    recordIds
  );
}
