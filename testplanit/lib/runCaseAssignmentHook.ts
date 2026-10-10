/**
 * Finds which run cases actually change hands in an assignment write, so
 * the assignee can be told afterwards. Reads the current assignees before
 * the write (TestRunCases keeps no before-image: it is the hottest table in
 * the app) and hands back the ids whose assignee differs.
 */

export type AssigneeReader = {
  testRunCases: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; assignedToId: true };
    }): Promise<Array<{ id: number; assignedToId: string | null }>>;
  };
};

const ASSIGNING_OPERATIONS = new Set(["update", "updateMany", "upsert"]);

export interface PendingAssignment {
  assignedToId: string;
  testRunCaseIds: number[];
}

/**
 * Call before the write. Returns the assignment to announce once the write
 * has committed, or null when the write assigns nobody or changes nothing.
 */
export async function prepareRunCaseAssignment(
  model: string,
  operation: string,
  args: unknown,
  reader: AssigneeReader
): Promise<PendingAssignment | null> {
  if (model !== "TestRunCases" || !ASSIGNING_OPERATIONS.has(operation)) {
    return null;
  }
  const payload = args as {
    where?: Record<string, unknown>;
    data?: { assignedToId?: unknown };
    update?: { assignedToId?: unknown };
  };
  const data = operation === "upsert" ? payload?.update : payload?.data;
  const assignedToId = data?.assignedToId;
  if (typeof assignedToId !== "string" || !assignedToId) return null;

  const rows = await reader.testRunCases.findMany({
    where: { AND: [payload.where ?? {}, { isDeleted: false }] },
    select: { id: true, assignedToId: true },
  });
  const changed = rows
    .filter((r) => r.assignedToId !== assignedToId)
    .map((r) => r.id);
  return changed.length > 0 ? { assignedToId, testRunCaseIds: changed } : null;
}
