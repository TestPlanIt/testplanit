import { ORMError, ORMErrorReason } from "@zenstackhq/orm";

type MilestoneRow = {
  id: number;
  parentId: number | null;
  projectId: number;
  isDeleted: boolean;
  isCompleted: boolean;
};

/** The reads the guard needs, on a client without plugins. */
export type MilestoneReader = {
  milestones: {
    findUnique(args: {
      where: { id: number };
      select: {
        id: true;
        parentId: true;
        projectId: true;
        isDeleted: true;
        isCompleted: true;
      };
    }): Promise<MilestoneRow | null>;
  };
};

const MILESTONE_SELECT = {
  id: true,
  parentId: true,
  projectId: true,
  isDeleted: true,
  isCompleted: true,
} as const;

// Deeper than any real tree; a chain longer than this is already a cycle.
const MAX_DEPTH = 1000;

export const REOPEN_UNDER_COMPLETED_PARENT_MESSAGE =
  "A milestone cannot be reopened while its parent milestone is completed.";

const reject = (message: string): never => {
  const error = new ORMError(ORMErrorReason.INVALID_INPUT, message);
  error.model = "Milestones";
  throw error;
};

const idOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

/**
 * The parent a milestone write asks for: a number, `null` for a top-level
 * milestone, or `undefined` when the write leaves the parent alone.
 */
function requestedParent(
  data: Record<string, unknown>
): number | null | undefined {
  if ("parentId" in data) {
    return data.parentId === null ? null : idOf(data.parentId);
  }
  const parent = data.parent as
    { connect?: { id?: unknown }; disconnect?: unknown } | undefined;
  if (parent?.disconnect) return null;
  return idOf(parent?.connect?.id);
}

function projectOf(data: Record<string, unknown>): number | undefined {
  return (
    idOf(data.projectId) ??
    idOf((data.project as { connect?: { id?: unknown } })?.connect?.id)
  );
}

/**
 * Reject a milestone create or update that would corrupt the tree or undo a
 * parent's completion: a parent that is missing or deleted, in another
 * project, or the milestone itself or one of its descendants; and reopening
 * a milestone whose parent is completed, which the web UI does not allow.
 * The milestone pages, the completion cascade and the delete cascade all walk
 * the tree recursively, so a cycle hangs every one of them.
 */
export async function assertValidMilestoneParent(
  model: string,
  operation: string,
  args: unknown,
  reader: MilestoneReader
): Promise<void> {
  if (model !== "Milestones") return;
  if (operation !== "create" && operation !== "update") return;
  const payload = args as {
    where?: { id?: unknown };
    data?: Record<string, unknown>;
  };
  const data = payload?.data;
  if (!data || typeof data !== "object") return;

  const parentId = requestedParent(data);
  const reopening = operation === "update" && data.isCompleted === false;
  if (parentId == null && !reopening) return;

  let milestoneId: number | undefined;
  let milestone: MilestoneRow | null = null;
  let projectId: number | undefined;
  if (operation === "create") {
    projectId = projectOf(data);
  } else {
    milestoneId = idOf(payload.where?.id);
    if (milestoneId === undefined) return;
    milestone = await reader.milestones.findUnique({
      where: { id: milestoneId },
      select: MILESTONE_SELECT,
    });
    if (!milestone) return;
    projectId = milestone.projectId;
  }

  const effectiveParentId =
    parentId === undefined ? (milestone?.parentId ?? null) : parentId;

  if (reopening && milestone?.isCompleted) {
    if (effectiveParentId != null) {
      const parent = await reader.milestones.findUnique({
        where: { id: effectiveParentId },
        select: MILESTONE_SELECT,
      });
      if (parent && !parent.isDeleted && parent.isCompleted) {
        reject(REOPEN_UNDER_COMPLETED_PARENT_MESSAGE);
      }
    }
  }

  if (parentId == null) return;

  const parent = await reader.milestones.findUnique({
    where: { id: parentId },
    select: MILESTONE_SELECT,
  });
  if (!parent || parent.isDeleted) {
    reject(`Parent milestone ${parentId} does not exist.`);
  }
  if (projectId !== undefined && parent!.projectId !== projectId) {
    reject(`Parent milestone ${parentId} belongs to another project.`);
  }

  if (milestoneId === undefined) return;
  let current: MilestoneRow | null = parent!;
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current.id === milestoneId) {
      reject(
        "A milestone cannot be moved under itself or one of its child milestones."
      );
    }
    if (current.parentId == null) return;
    current = await reader.milestones.findUnique({
      where: { id: current.parentId },
      select: MILESTONE_SELECT,
    });
  }
  if (current) reject("The milestone tree above the new parent is too deep.");
}
