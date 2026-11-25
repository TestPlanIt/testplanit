import { readDraftCasesOptions } from "~/lib/webhooks/actions/schemas";

interface NamedRecipients {
  notifyUserIds?: string[];
  notifyGroupIds?: number[];
}

/** The users a rule names: those listed, plus the members of its groups. */
export async function namedRecipients(
  db: any,
  options: NamedRecipients
): Promise<string[]> {
  const ids = new Set(options.notifyUserIds ?? []);
  if (options.notifyGroupIds?.length) {
    const members: { userId: string }[] = await db.groupAssignment.findMany({
      where: { groupId: { in: options.notifyGroupIds } },
      select: { userId: true },
    });
    for (const member of members) ids.add(member.userId);
  }
  return [...ids];
}

/**
 * The recipients of the Draft test cases rule that last drafted cases for
 * this issue, read from the action log. Empty when no rule drafted for it,
 * the rule is gone, or it names nobody.
 */
export async function draftRuleRecipients(
  db: any,
  projectId: number,
  issueId: number
): Promise<string[]> {
  const drafted = await db.webhookActionLog.findFirst({
    where: {
      projectId,
      issueId,
      outcome: "cases_drafted",
      webhookActionId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { webhookAction: { select: { options: true } } },
  });
  if (!drafted?.webhookAction) return [];
  return namedRecipients(
    db,
    readDraftCasesOptions(drafted.webhookAction.options)
  );
}

const SYSTEM_USER_ID = "system-automation-user";

/** The project's creator and the project administrators assigned to it. */
export async function projectAdminIds(
  db: any,
  projectId: number
): Promise<string[]> {
  const project = await db.projects.findUnique({
    where: { id: projectId },
    select: {
      createdBy: true,
      assignedUsers: {
        where: {
          user: { access: "PROJECTADMIN", isActive: true, isDeleted: false },
        },
        select: { userId: true },
      },
    },
  });
  if (!project) return [];
  return [
    ...new Set([
      project.createdBy,
      ...project.assignedUsers.map(
        (assigned: { userId: string }) => assigned.userId
      ),
    ]),
  ];
}

/**
 * The people who reviewed these cases: each case's recorded reviewer, and
 * whoever requested the review that reviewer approved.
 */
export async function reviewersOf(
  db: any,
  cases: { id: number; reviewedById: string | null }[]
): Promise<string[]> {
  const reviewed = cases.filter((row) => row.reviewedById);
  if (reviewed.length === 0) return [];
  const approvals: {
    entityId: number;
    requestedByUserId: string;
    decidedByUserId: string | null;
  }[] = await db.reviewRequest.findMany({
    where: {
      entityType: "CASE",
      entityId: { in: reviewed.map((row) => row.id) },
      status: "APPROVED",
    },
    select: {
      entityId: true,
      requestedByUserId: true,
      decidedByUserId: true,
    },
  });
  const ids = new Set<string>();
  for (const row of reviewed) {
    ids.add(row.reviewedById!);
    for (const approval of approvals) {
      if (
        approval.entityId === row.id &&
        approval.decidedByUserId === row.reviewedById
      ) {
        ids.add(approval.requestedByUserId);
      }
    }
  }
  return [...ids];
}

/**
 * Who hears about an Update test cases rule's work on an issue: the rule's
 * own recipients; when it names nobody, those of the Draft rule that drafted
 * the issue's cases; when there are none of those either, the project's
 * administrators; and when none of them is an active user, the system
 * administrators, so a check is never silent. `alsoTell` (case reviewers,
 * review requesters) is added to whichever list applies. Each person appears
 * once; the System user, and anyone inactive or deleted, never.
 */
export async function upkeepRecipients(
  db: any,
  params: {
    projectId: number;
    issueId: number;
    options: NamedRecipients;
    alsoTell?: (string | null | undefined)[];
  }
): Promise<string[]> {
  let base = await namedRecipients(db, params.options);
  if (base.length === 0) {
    base = await draftRuleRecipients(db, params.projectId, params.issueId);
  }
  if (base.length === 0) {
    base = await projectAdminIds(db, params.projectId);
  }
  return activeOrSystemAdmins(db, base, params.alsoTell);
}

/**
 * The active users among `base` and `alsoTell`. When nobody in `base` is an
 * active user, the active system administrators are told as well, so the
 * news is never silent. Each person appears once; the System user, and
 * anyone inactive or deleted, never.
 */
export async function activeOrSystemAdmins(
  db: any,
  base: string[],
  alsoTell: (string | null | undefined)[] = []
): Promise<string[]> {
  const wanted = [
    ...new Set([
      ...base,
      ...alsoTell.filter((id): id is string => Boolean(id)),
    ]),
  ];
  const live: { id: string }[] =
    wanted.length === 0
      ? []
      : await db.user.findMany({
          where: {
            id: { in: wanted, not: SYSTEM_USER_ID },
            isActive: true,
            isDeleted: false,
          },
          select: { id: true },
        });
  const liveIds = new Set(live.map((user) => user.id));
  const told = wanted.filter((id) => liveIds.has(id));
  if (base.some((id) => liveIds.has(id))) return told;
  const admins: { id: string }[] = await db.user.findMany({
    where: {
      access: "ADMIN",
      id: { not: SYSTEM_USER_ID },
      isActive: true,
      isDeleted: false,
    },
    select: { id: true },
  });
  return [...new Set([...admins.map((user) => user.id), ...told])];
}
