"use server";

import type { JSONContent } from "@tiptap/core";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { localeFromPreference } from "~/i18n/navigation";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withActionAuditContext } from "~/lib/auditContextWrappers";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { CommentService } from "~/lib/services/commentService";
import { resolveEffectiveProjectRoleId } from "~/lib/services/effectiveRole";
import { NotificationService } from "~/lib/services/notificationService";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
import { resolveBulkReviewTargets } from "~/lib/services/reviewGate";
import { baseDb } from "~/lib/db";
import { extractMentionedUserIds } from "~/lib/utils/tiptapMentions";
import {
  AlreadyPendingError,
  IneligibleAssigneeError,
  isIneligibleAssigneeError,
} from "~/lib/utils/errors";
import { areaForEntityType } from "~/lib/utils/reviewAreas";
import {
  emitReviewCompletedEvent,
  emitReviewRequestedEvent,
} from "~/lib/webhooks/event-emitters/reviewEvents";
import { getServerAuthSession } from "~/server/auth";

type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

interface RequestReviewInput {
  projectId: number;
  entityType: ReviewableEntityType;
  entityId: number;
  fromStateId: number;
  toStateId: number;
  assigneeUserId: string | null;
  assigneeRoleId: number | null;
  /**
   * Plain text from the Sheet's Comment textarea. Wrapped into a TipTap doc
   * server-side. Optional — common usage is a one-liner ("Please review
   * this.") that the requester shouldn't be forced to type every time. When
   * empty, the paired Comment still carries the @mention so the assignee is
   * notified; the prose is additive context, not a precondition.
   */
  commentText: string;
}

interface RequestReviewSuccess {
  success: true;
  reviewRequestId: string;
  commentId: string;
}

interface RequestReviewFailure {
  success: false;
  error:
    | "INVALID_INPUT"
    | "ALREADY_PENDING"
    | "UNAUTHORIZED"
    | "FEATURE_DISABLED"
    | "INELIGIBLE_ASSIGNEE"
    | "INTERNAL_ERROR";
  message?: string;
}

/**
 * Server-side eligibility chokepoint for review assignees. The UI combobox
 * already filters out roles/users without canApprove on the entity area, but
 * a client can call this server action directly and bypass the combobox, so
 * the same gate runs here before the transaction.
 *
 * Role assignees: load the (roleId, area) RolePermission row and reject when
 * canApprove !== true.
 * User assignees: resolve the user's effective project role and reject when
 * effective role is null OR the (roleId, area) row's canApprove is not true.
 */
async function assertAssigneeCanApprove(params: {
  projectId: number;
  entityType: ReviewableEntityType;
  assigneeUserId: string | null;
  assigneeRoleId: number | null;
}): Promise<void> {
  const area = areaForEntityType(params.entityType);

  if (params.assigneeRoleId !== null) {
    const perm = await baseDb.rolePermission.findUnique({
      where: { roleId_area: { roleId: params.assigneeRoleId, area } },
      select: { canApprove: true },
    });
    if (!perm?.canApprove) {
      throw new IneligibleAssigneeError(params.assigneeRoleId.toString(), area);
    }
    return;
  }

  if (params.assigneeUserId !== null) {
    const effectiveRoleId = await resolveEffectiveProjectRoleId(
      params.assigneeUserId,
      params.projectId,
      baseDb
    );
    if (effectiveRoleId === null) {
      throw new IneligibleAssigneeError(params.assigneeUserId, area);
    }
    const perm = await baseDb.rolePermission.findUnique({
      where: { roleId_area: { roleId: effectiveRoleId, area } },
      select: { canApprove: true },
    });
    if (!perm?.canApprove) {
      throw new IneligibleAssigneeError(params.assigneeUserId, area);
    }
  }
}

export type RequestReviewResult = RequestReviewSuccess | RequestReviewFailure;

/**
 * Submit a new ReviewRequest plus the paired Comment that holds the
 * requester's prose (Phase 2 hybrid design — D-21 follow-up).
 *
 * The pair lands inside a single Prisma `$transaction` so a request never
 * commits without its accompanying conversation thread message. After the tx
 * commits the action calls `CommentService.processMentions` to fan out the
 * existing `@mention` notifications — that step is intentionally outside the
 * tx because notification creation references the committed Comment.id and
 * because mention processing also fetches each mentioned user's project
 * access for the notification copy.
 *
 * The Sheet historically wrote the requester comment into ReviewRequest's
 * `decisionComment` column, which was a misuse — `decisionComment` is meant
 * for the reviewer's response and was getting overwritten on decide. This
 * action stops writing the requester prose to ReviewRequest entirely; it
 * lives on the paired Comment row.
 *
 * For role-assigned reviews (`assigneeRoleId != null`), the auto-comment
 * does NOT inject a TipTap mention node — the existing `@mention`
 * notification path can't address a role. Role-targeted notifications fan
 * out via the bespoke role-aware pathway Phase 3 will build.
 */
export const requestReview = withActionAuditContext(
  async (input: RequestReviewInput): Promise<RequestReviewResult> => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { success: false, error: "UNAUTHORIZED" };
    }
    const requestedByUserId = session.user.id;

    // Defense-in-depth: the schema-layer @@deny rules no longer reference the
    // project / system feature flags, so the app preflight is the only seam
    // that short-circuits a request when the feature is off. Mirror the
    // chokepoint helpers (`assertReviewGatePasses`, `decideReviewRequest`)
    // by failing fast here with a typed FEATURE_DISABLED before we touch the
    // database. Project flag is loaded via the same query so a single
    // round-trip answers both checks.
    const systemEnabled = await isReviewFeatureSystemEnabled(baseDb);
    if (!systemEnabled) {
      return { success: false, error: "FEATURE_DISABLED" };
    }
    const project = await baseDb.projects.findUnique({
      where: { id: input.projectId },
      select: { reviewWorkflowEnabled: true },
    });
    if (!project || project.reviewWorkflowEnabled !== true) {
      return { success: false, error: "FEATURE_DISABLED" };
    }

    try {
      await assertAssigneeCanApprove({
        projectId: input.projectId,
        entityType: input.entityType,
        assigneeUserId: input.assigneeUserId,
        assigneeRoleId: input.assigneeRoleId,
      });
    } catch (eligibilityErr) {
      if (isIneligibleAssigneeError(eligibilityErr)) {
        return { success: false, error: "INELIGIBLE_ASSIGNEE" };
      }
      throw eligibilityErr;
    }

    // One try spans the whole request: the pre-transaction prep below
    // (assignee lookup, default-comment localization) can throw too, and
    // before this widening those throws escaped the action uncaught — no
    // `requestReview failed` log line, just an opaque client toast.
    try {
      const trimmed = input.commentText.trim();

      // Build the TipTap doc that will become the Comment.content. For direct
      // user-assignees, prepend a mention node so the existing comment-mention
      // notification fires for the assignee without extra wiring. Role assignees
      // fall through with no mention node (see method docstring).
      let assigneeMentionNode: JSONContent | null = null;
      if (input.assigneeUserId !== null) {
        const assigneeUser = await baseDb.user.findUnique({
          where: { id: input.assigneeUserId },
          select: { id: true, name: true },
        });
        if (assigneeUser) {
          assigneeMentionNode = {
            type: "mention",
            attrs: { id: assigneeUser.id, label: assigneeUser.name ?? "user" },
          };
        }
      }

      // Default-text fallback: when the requester leaves the comment blank we
      // still want a useful body on the persisted Comment row — both for the
      // assignee's context and for the comment thread to show something other
      // than an empty bubble. Build a "Please review the transition from
      // {from} → {to}" string with the role name appended when role-assigned.
      // Skip the round-trip when the requester actually typed something.
      //
      // The text is localized to the requester's own `UserPreferences.locale`,
      // threaded explicitly into `getTranslations({locale})` — never a bare
      // `getTranslations()`, which delegates locale resolution to
      // i18n/request.ts and broke every review request while that file read
      // `next/root-params` (unsupported in a Server Action; reverted in
      // 9919fa7e). The persisted Comment.content carries whichever language the
      // requester saw at submit time; the comment thread renders it verbatim so
      // a French reviewer reading an English requester's default comment sees
      // the English version (consistent with how user-typed comments work).
      let defaultCommentText: string | null = null;
      if (trimmed.length === 0) {
        const [fromState, toState, assigneeRole, t] = await Promise.all([
          baseDb.workflows.findUnique({
            where: { id: input.fromStateId },
            select: { name: true },
          }),
          baseDb.workflows.findUnique({
            where: { id: input.toStateId },
            select: { name: true },
          }),
          input.assigneeRoleId !== null
            ? baseDb.roles.findUnique({
                where: { id: input.assigneeRoleId },
                select: { name: true },
              })
            : Promise.resolve(null),
          getTranslations({
            locale: localeFromPreference(session.user.preferences?.locale),
            namespace: "reviews.requester",
          }),
        ]);
        const fromName = fromState?.name ?? "";
        const toName = toState?.name ?? "";
        defaultCommentText = assigneeRole
          ? t("defaultCommentRole", {
              fromState: fromName,
              toState: toName,
              roleName: assigneeRole.name,
            })
          : t("defaultComment", { fromState: fromName, toState: toName });
      }

      const bodyText =
        trimmed.length > 0 ? trimmed : (defaultCommentText ?? "");

      const paragraphChildren: JSONContent[] = [];
      if (assigneeMentionNode) {
        paragraphChildren.push(assigneeMentionNode);
        if (bodyText.length > 0) {
          paragraphChildren.push({ type: "text", text: " " });
        }
      }
      if (bodyText.length > 0) {
        paragraphChildren.push({ type: "text", text: bodyText });
      }

      const commentContent: JSONContent = {
        type: "doc",
        content: [{ type: "paragraph", content: paragraphChildren }],
      };

      const entityFkField: "repositoryCaseId" | "testRunId" | "sessionId" =
        input.entityType === "CASE"
          ? "repositoryCaseId"
          : input.entityType === "RUN"
            ? "testRunId"
            : "sessionId";

      const { reviewRequestId, commentId } = await auditedTransaction(
        async (tx) => {
          const reviewRequest = await tx.reviewRequest.create({
            data: {
              projectId: input.projectId,
              entityType: input.entityType,
              entityId: input.entityId,
              fromStateId: input.fromStateId,
              toStateId: input.toStateId,
              requestedByUserId,
              assigneeUserId: input.assigneeUserId,
              assigneeRoleId: input.assigneeRoleId,
              status: "PENDING",
            },
            select: { id: true },
          });

          const comment = await tx.comment.create({
            data: {
              projectId: input.projectId,
              type: "REVIEW_REQUEST",
              reviewRequestId: reviewRequest.id,
              content: commentContent as any,
              creatorId: requestedByUserId,
              [entityFkField]: input.entityId,
            },
            select: { id: true },
          });

          return {
            reviewRequestId: reviewRequest.id,
            commentId: comment.id,
          };
        }
      );

      // Persist mention rows (used by the comment renderer to highlight @mentions
      // in-thread) and dispatch the dedicated REVIEW_REQUESTED notification(s) to
      // every reviewer the request targets — direct user assignee OR the full
      // set of role holders on the project. Runs outside the tx because
      // notification creation depends on the committed Comment.id and queries
      // role membership. Failures here do NOT roll back the review request —
      // we'd rather have an unannounced review than a lost one.
      try {
        const mentionedUserIds = extractMentionedUserIds(commentContent);
        if (mentionedUserIds.length > 0) {
          await CommentService.createCommentMentions(
            commentId,
            mentionedUserIds
          );
        }

        const targetUserIds: string[] =
          input.assigneeUserId !== null
            ? [input.assigneeUserId]
            : input.assigneeRoleId !== null
              ? await NotificationService.resolveRoleHolderUserIds(
                  input.projectId,
                  input.assigneeRoleId,
                  requestedByUserId
                )
              : [];

        const context = await loadReviewContext(
          input.projectId,
          input.entityType,
          input.entityId,
          input.fromStateId,
          input.toStateId
        );

        if (targetUserIds.length > 0 && context) {
          await NotificationService.createReviewRequestNotification({
            targetUserIds,
            requesterUserId: requestedByUserId,
            requesterName: session.user.name ?? "Unknown User",
            projectId: context.projectId,
            projectName: context.projectName,
            entityType: input.entityType,
            entityId: input.entityId,
            entityName: context.entityName,
            fromStateName: context.fromStateName,
            toStateName: context.toStateName,
            reviewRequestId,
            commentText: trimmed,
          });
        }

        if (mentionedUserIds.length > 0 && context) {
          const commentEntityType: "RepositoryCase" | "TestRun" | "Session" =
            input.entityType === "CASE"
              ? "RepositoryCase"
              : input.entityType === "RUN"
                ? "TestRun"
                : "Session";
          await CommentService.processMentions(
            commentId,
            commentContent,
            requestedByUserId,
            session.user.name ?? "Unknown User",
            context.projectId,
            context.projectName,
            commentEntityType,
            context.entityName,
            String(input.entityId)
          );
        }
      } catch (notifyErr) {
        console.error(
          "requestReview: review-request notification dispatch failed",
          notifyErr
        );
      }

      try {
        const context = await loadReviewContext(
          input.projectId,
          input.entityType,
          input.entityId,
          input.fromStateId,
          input.toStateId
        );
        if (context) {
          const [assigneeUser, assigneeRole] = await Promise.all([
            input.assigneeUserId !== null
              ? baseDb.user.findUnique({
                  where: { id: input.assigneeUserId },
                  select: { name: true },
                })
              : Promise.resolve(null),
            input.assigneeRoleId !== null
              ? baseDb.roles.findUnique({
                  where: { id: input.assigneeRoleId },
                  select: { name: true },
                })
              : Promise.resolve(null),
          ]);
          await emitReviewRequestedEvent(
            {
              reviewRequestId,
              projectId: input.projectId,
              entityType: input.entityType,
              entityId: input.entityId,
              entityName: context.entityName,
              fromStateId: input.fromStateId,
              fromStateName: context.fromStateName,
              toStateId: input.toStateId,
              toStateName: context.toStateName,
              toStateColor: context.toStateColor,
              requestedByUserId,
              requesterName: session.user.name ?? "Unknown User",
              assigneeUserId: input.assigneeUserId,
              assigneeUserName: assigneeUser?.name ?? null,
              assigneeRoleId: input.assigneeRoleId,
              assigneeRoleName: assigneeRole?.name ?? null,
              commentText: trimmed.length > 0 ? trimmed : null,
            },
            { actorUserId: requestedByUserId }
          );
        }
      } catch (webhookErr) {
        console.error(
          "requestReview: review-request webhook emit failed",
          webhookErr
        );
      }

      try {
        await captureAuditEvent({
          action: "REVIEW_REQUESTED",
          entityType: "ReviewRequest",
          entityId: reviewRequestId,
          projectId: input.projectId,
          userId: requestedByUserId,
          metadata: {
            fromStateId: input.fromStateId,
            toStateId: input.toStateId,
            assigneeUserId: input.assigneeUserId,
            assigneeRoleId: input.assigneeRoleId,
            requestedByUserId,
            entityType: input.entityType,
            entityId: input.entityId,
            commentText: trimmed.slice(0, 4096),
          },
        });
      } catch (auditErr) {
        console.error("requestReview: audit emission failed", auditErr);
      }

      revalidatePath("/");
      return { success: true, reviewRequestId, commentId };
    } catch (err) {
      if (err instanceof AlreadyPendingError) {
        return { success: false, error: "ALREADY_PENDING" };
      }
      if (
        err instanceof Error &&
        err.message
          .toLowerCase()
          .includes("a pending review request already exists")
      ) {
        return { success: false, error: "ALREADY_PENDING" };
      }
      console.error("requestReview failed", err);
      return { success: false, error: "INTERNAL_ERROR" };
    }
  }
);

/**
 * Hard ceiling on one bulk request. The action creates two rows plus a
 * webhook emit and an audit event per entity, all in one request cycle;
 * beyond this the transaction outgrows the bulk-edit route's own 60s budget.
 * The repository selection UI caps well below this in practice.
 */
const MAX_BULK_REVIEW_REQUESTS = 500;

interface BulkRequestReviewInput {
  projectId: number;
  entityType: ReviewableEntityType;
  entityIds: number[];
  /**
   * The state the requester is trying to move the whole selection to. Each
   * entity's ACTUAL request targets the first gate it lacks on the path to
   * this state, which may be an earlier state (and may differ per entity).
   */
  toStateId: number;
  assigneeUserId: string | null;
  assigneeRoleId: number | null;
}

interface BulkRequestReviewSuccess {
  success: true;
  /** Number of ReviewRequests actually created. */
  created: number;
  reviewRequestIds: string[];
  /** Entities skipped because they already carry a PENDING request. */
  skippedPending: number[];
  /** Entities skipped because nothing on their path needs approval. */
  skippedNotBlocked: number[];
}

interface BulkRequestReviewFailure {
  success: false;
  error:
    | "INVALID_INPUT"
    | "UNAUTHORIZED"
    | "FEATURE_DISABLED"
    | "INELIGIBLE_ASSIGNEE"
    | "SELECTION_TOO_LARGE"
    | "INTERNAL_ERROR";
  message?: string;
}

export type BulkRequestReviewResult =
  BulkRequestReviewSuccess | BulkRequestReviewFailure;

/**
 * Raise review requests for an entire bulk selection against a single
 * assignee, so a blocked bulk edit has a way forward that isn't "open all
 * forty cases individually".
 *
 * Deliberately NOT a loop over {@link requestReview}. That action re-runs the
 * feature-flag pair, the assignee-eligibility lookup, `loadReviewContext`
 * (three queries), and `revalidatePath` once per entity; at fifty cases
 * that's several hundred redundant round-trips. Everything invariant across
 * the batch — flags, eligibility, project name, workflow names, the assignee
 * record, the localized comment template — is hoisted out of the loop here,
 * leaving only the per-entity row writes inside it.
 *
 * Behavioral differences from the single-entity action, all deliberate:
 *
 *   1. **No requester comment.** Bulk requests carry the same localized
 *      auto-comment the single-entity path falls back to ("Please review the
 *      transition from {from} → {to}"), rendered per entity because each one
 *      may be crossing a different gate. There is no shared free-text field:
 *      one prose blob copied verbatim onto forty threads reads as noise, not
 *      context.
 *
 *   2. **One aggregate notification, not N.** A fifty-case batch would
 *      otherwise fire fifty REVIEW_REQUESTED notifications plus fifty
 *      @mention notifications at a single reviewer. The assignee gets one
 *      notification naming the count, linking to the review inbox. Per-entity
 *      CommentMention rows are still written so the @mention highlights
 *      in-thread — it's the notification fan-out that's collapsed, not the
 *      mention itself.
 *
 *   3. **Partial success is the norm.** Entities already carrying a PENDING
 *      request, and entities whose path needs no approval, are skipped and
 *      reported rather than failing the batch. One already-pending case must
 *      not cost the other thirty-nine their requests.
 *
 * Webhook and audit emission stay per-request: consumers of
 * `*.review_requested` and the audit trail both key on a single
 * ReviewRequest, and collapsing them would silently drop fidelity.
 */
export const bulkRequestReview = withActionAuditContext(
  async (input: BulkRequestReviewInput): Promise<BulkRequestReviewResult> => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { success: false, error: "UNAUTHORIZED" };
    }
    const requestedByUserId = session.user.id;

    const uniqueEntityIds = Array.from(new Set(input.entityIds));
    if (uniqueEntityIds.length === 0) {
      return { success: false, error: "INVALID_INPUT" };
    }
    if (uniqueEntityIds.length > MAX_BULK_REVIEW_REQUESTS) {
      return { success: false, error: "SELECTION_TOO_LARGE" };
    }

    // Exactly one assignee kind, mirroring the ReviewRequest @@validate pair.
    // Checked before any query so a malformed direct call fails cheaply.
    const hasUserAssignee = input.assigneeUserId !== null;
    const hasRoleAssignee = input.assigneeRoleId !== null;
    if (hasUserAssignee === hasRoleAssignee) {
      return { success: false, error: "INVALID_INPUT" };
    }
    if (input.assigneeUserId === requestedByUserId) {
      return { success: false, error: "INELIGIBLE_ASSIGNEE" };
    }

    const systemEnabled = await isReviewFeatureSystemEnabled(baseDb);
    if (!systemEnabled) {
      return { success: false, error: "FEATURE_DISABLED" };
    }
    const project = await baseDb.projects.findUnique({
      where: { id: input.projectId },
      select: { id: true, name: true, reviewWorkflowEnabled: true },
    });
    if (!project || project.reviewWorkflowEnabled !== true) {
      return { success: false, error: "FEATURE_DISABLED" };
    }

    try {
      await assertAssigneeCanApprove({
        projectId: input.projectId,
        entityType: input.entityType,
        assigneeUserId: input.assigneeUserId,
        assigneeRoleId: input.assigneeRoleId,
      });
    } catch (eligibilityErr) {
      if (isIneligibleAssigneeError(eligibilityErr)) {
        return { success: false, error: "INELIGIBLE_ASSIGNEE" };
      }
      throw eligibilityErr;
    }

    try {
      // Authoritative work-list. The client shows the same blocked set via
      // `useBulkTransitionGateStatus`, but the resolution is recomputed here
      // rather than trusted from the payload — a direct caller could
      // otherwise name any gate it liked.
      const { targets, skippedPending, skippedNotBlocked } =
        await resolveBulkReviewTargets(
          baseDb,
          input.projectId,
          input.entityType,
          uniqueEntityIds,
          input.toStateId
        );

      if (targets.length === 0) {
        return {
          success: true,
          created: 0,
          reviewRequestIds: [],
          skippedPending,
          skippedNotBlocked,
        };
      }

      // Every lookup below is batch-scoped: one query per KIND of thing,
      // regardless of how many entities the batch covers.
      const stateIds = Array.from(
        new Set(targets.flatMap((t) => [t.fromStateId, t.gateId]))
      );
      const [states, entityNames, assigneeUser, assigneeRole, t] =
        await Promise.all([
          baseDb.workflows.findMany({
            where: { id: { in: stateIds } },
            select: {
              id: true,
              name: true,
              color: { select: { value: true } },
            },
          }),
          loadEntityNames(
            input.entityType,
            targets.map((x) => x.entityId)
          ),
          input.assigneeUserId !== null
            ? baseDb.user.findUnique({
                where: { id: input.assigneeUserId },
                select: { id: true, name: true },
              })
            : Promise.resolve(null),
          input.assigneeRoleId !== null
            ? baseDb.roles.findUnique({
                where: { id: input.assigneeRoleId },
                select: { name: true },
              })
            : Promise.resolve(null),
          getTranslations({
            locale: localeFromPreference(session.user.preferences?.locale),
            namespace: "reviews.requester",
          }),
        ]);

      const stateById = new Map(
        (
          states as Array<{
            id: number;
            name: string;
            color: { value: string } | null;
          }>
        ).map((s) => [s.id, s])
      );

      // The mention node is identical across the batch — one assignee — so
      // it's built once and reused in every comment doc.
      const assigneeMentionNode: JSONContent | null = assigneeUser
        ? {
            type: "mention",
            attrs: { id: assigneeUser.id, label: assigneeUser.name ?? "user" },
          }
        : null;

      const entityFkField: "repositoryCaseId" | "testRunId" | "sessionId" =
        input.entityType === "CASE"
          ? "repositoryCaseId"
          : input.entityType === "RUN"
            ? "testRunId"
            : "sessionId";

      // One transaction for the whole batch: a half-written set of requests
      // would leave the selection in a state the user can neither re-request
      // (some now PENDING) nor complete. The batch is bounded by
      // MAX_BULK_REVIEW_REQUESTS so it stays inside the pool's statement
      // budget — `auditedTransaction` accepts no timeout override under v3.
      const written = await auditedTransaction(async (tx) => {
        const rows: Array<{
          reviewRequestId: string;
          commentId: string;
          entityId: number;
          fromStateId: number;
          gateId: number;
        }> = [];

        for (const target of targets) {
          const fromName = stateById.get(target.fromStateId)?.name ?? "";
          const toName = stateById.get(target.gateId)?.name ?? "";
          const bodyText = assigneeRole
            ? t("defaultCommentRole", {
                fromState: fromName,
                toState: toName,
                roleName: assigneeRole.name,
              })
            : t("defaultComment", { fromState: fromName, toState: toName });

          const paragraphChildren: JSONContent[] = [];
          if (assigneeMentionNode) {
            paragraphChildren.push(assigneeMentionNode);
            paragraphChildren.push({ type: "text", text: " " });
          }
          paragraphChildren.push({ type: "text", text: bodyText });

          const reviewRequest = await tx.reviewRequest.create({
            data: {
              projectId: input.projectId,
              entityType: input.entityType,
              entityId: target.entityId,
              fromStateId: target.fromStateId,
              toStateId: target.gateId,
              requestedByUserId,
              assigneeUserId: input.assigneeUserId,
              assigneeRoleId: input.assigneeRoleId,
              status: "PENDING",
            },
            select: { id: true },
          });

          const comment = await tx.comment.create({
            data: {
              projectId: input.projectId,
              type: "REVIEW_REQUEST",
              reviewRequestId: reviewRequest.id,
              content: {
                type: "doc",
                content: [{ type: "paragraph", content: paragraphChildren }],
              } as any,
              creatorId: requestedByUserId,
              [entityFkField]: target.entityId,
            },
            select: { id: true },
          });

          rows.push({
            reviewRequestId: reviewRequest.id,
            commentId: comment.id,
            entityId: target.entityId,
            fromStateId: target.fromStateId,
            gateId: target.gateId,
          });
        }

        return rows;
      });

      // --- Post-commit fan-out. Failures here never roll back the requests:
      // an unannounced review beats a lost one (same posture as
      // `requestReview`). ---

      try {
        if (input.assigneeUserId !== null) {
          await Promise.all(
            written.map((row) =>
              CommentService.createCommentMentions(row.commentId, [
                input.assigneeUserId!,
              ])
            )
          );
        }

        const targetUserIds: string[] =
          input.assigneeUserId !== null
            ? [input.assigneeUserId]
            : input.assigneeRoleId !== null
              ? await NotificationService.resolveRoleHolderUserIds(
                  input.projectId,
                  input.assigneeRoleId,
                  requestedByUserId
                )
              : [];

        if (targetUserIds.length > 0) {
          const first = written[0]!;
          await NotificationService.createBulkReviewRequestNotification({
            targetUserIds,
            requesterUserId: requestedByUserId,
            requesterName: session.user.name ?? "Unknown User",
            projectId: input.projectId,
            projectName: project.name,
            entityType: input.entityType,
            count: written.length,
            // A representative entity keeps the notification payload shape
            // identical to the single-request one, so the bell and email
            // renderers can share their entity-link branch.
            sampleEntityId: first.entityId,
            sampleEntityName: entityNames.get(first.entityId) ?? "",
            sampleReviewRequestId: first.reviewRequestId,
          });
        }
      } catch (notifyErr) {
        console.error(
          "bulkRequestReview: notification dispatch failed",
          notifyErr
        );
      }

      try {
        const requesterName = session.user.name ?? "Unknown User";
        await Promise.all(
          written.map((row) =>
            emitReviewRequestedEvent(
              {
                reviewRequestId: row.reviewRequestId,
                projectId: input.projectId,
                entityType: input.entityType,
                entityId: row.entityId,
                entityName: entityNames.get(row.entityId) ?? "",
                fromStateId: row.fromStateId,
                fromStateName: stateById.get(row.fromStateId)?.name ?? "",
                toStateId: row.gateId,
                toStateName: stateById.get(row.gateId)?.name ?? "",
                toStateColor: stateById.get(row.gateId)?.color?.value ?? null,
                requestedByUserId,
                requesterName,
                assigneeUserId: input.assigneeUserId,
                assigneeUserName: assigneeUser?.name ?? null,
                assigneeRoleId: input.assigneeRoleId,
                assigneeRoleName: assigneeRole?.name ?? null,
                commentText: null,
              },
              { actorUserId: requestedByUserId }
            )
          )
        );
      } catch (webhookErr) {
        console.error("bulkRequestReview: webhook emit failed", webhookErr);
      }

      try {
        await Promise.all(
          written.map((row) =>
            captureAuditEvent({
              action: "REVIEW_REQUESTED",
              entityType: "ReviewRequest",
              entityId: row.reviewRequestId,
              projectId: input.projectId,
              userId: requestedByUserId,
              metadata: {
                fromStateId: row.fromStateId,
                toStateId: row.gateId,
                assigneeUserId: input.assigneeUserId,
                assigneeRoleId: input.assigneeRoleId,
                requestedByUserId,
                entityType: input.entityType,
                entityId: row.entityId,
                commentText: "",
                // Distinguishes a batch member from a hand-raised request
                // when reading the trail back.
                bulk: true,
                bulkSize: written.length,
                bulkTargetStateId: input.toStateId,
              },
            })
          )
        );
      } catch (auditErr) {
        console.error("bulkRequestReview: audit emission failed", auditErr);
      }

      revalidatePath("/");
      return {
        success: true,
        created: written.length,
        reviewRequestIds: written.map((r) => r.reviewRequestId),
        skippedPending,
        skippedNotBlocked,
      };
    } catch (err) {
      console.error("bulkRequestReview failed", err);
      return { success: false, error: "INTERNAL_ERROR" };
    }
  }
);

/**
 * Batch-resolve display names for a set of entities of one type. Replaces the
 * per-entity `loadReviewContext` round-trip inside a bulk loop.
 */
async function loadEntityNames(
  entityType: ReviewableEntityType,
  entityIds: number[]
): Promise<Map<number, string>> {
  const args = {
    where: { id: { in: entityIds } },
    select: { id: true, name: true },
  } as const;

  const rows: Array<{ id: number; name: string }> =
    entityType === "CASE"
      ? await baseDb.repositoryCases.findMany(args)
      : entityType === "RUN"
        ? await baseDb.testRuns.findMany(args)
        : await baseDb.sessions.findMany(args);

  return new Map(rows.map((r) => [r.id, r.name]));
}

async function loadReviewContext(
  projectId: number,
  entityType: ReviewableEntityType,
  entityId: number,
  fromStateId: number,
  toStateId: number
): Promise<{
  projectId: number;
  projectName: string;
  entityName: string;
  fromStateName: string;
  toStateName: string;
  toStateColor: string | null;
} | null> {
  const [project, fromState, toState] = await Promise.all([
    baseDb.projects.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    baseDb.workflows.findUnique({
      where: { id: fromStateId },
      select: { name: true },
    }),
    baseDb.workflows.findUnique({
      where: { id: toStateId },
      select: { name: true, color: { select: { value: true } } },
    }),
  ]);
  if (!project) return null;

  let entityName: string | null = null;
  if (entityType === "CASE") {
    const row = await baseDb.repositoryCases.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  } else if (entityType === "RUN") {
    const row = await baseDb.testRuns.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  } else {
    const row = await baseDb.sessions.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  }
  if (entityName === null) return null;

  return {
    projectId: project.id,
    projectName: project.name,
    entityName,
    fromStateName: fromState?.name ?? "",
    toStateName: toState?.name ?? "",
    toStateColor: toState?.color?.value ?? null,
  };
}

interface CancelReviewSuccess {
  success: true;
  reviewRequestId: string;
}

interface CancelReviewFailure {
  success: false;
  error:
    | "UNAUTHORIZED"
    | "NOT_FOUND"
    | "ALREADY_DECIDED"
    | "FORBIDDEN"
    | "FEATURE_DISABLED"
    | "INTERNAL_ERROR";
  message?: string;
}

export type CancelReviewResult = CancelReviewSuccess | CancelReviewFailure;

/**
 * Cancel a PENDING ReviewRequest. Mirrors `decideReviewRequest`'s shape: the
 * status flip lands inside a tx, then notification + webhook + audit fan out
 * outside the tx so transient downstream failures don't roll back the row
 * change.
 *
 * Permission model: only the original requester or a system admin can
 * cancel. (Phase 1 the cancel affordance is gated on the same predicate
 * client-side; the server-side check is the authoritative one.)
 *
 * Soft-delete invariant: this is a STATUS flip, not a row deletion.
 */
export const cancelReviewRequest = withActionAuditContext(
  async (reviewRequestId: string): Promise<CancelReviewResult> => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { success: false, error: "UNAUTHORIZED" };
    }
    const userId = session.user.id;

    const systemEnabled = await isReviewFeatureSystemEnabled(baseDb);
    if (!systemEnabled) {
      return { success: false, error: "FEATURE_DISABLED" };
    }

    const req = await baseDb.reviewRequest.findUnique({
      where: { id: reviewRequestId },
      include: {
        project: {
          select: { id: true, name: true, reviewWorkflowEnabled: true },
        },
        fromState: { select: { id: true, name: true } },
        toState: {
          select: {
            id: true,
            name: true,
            color: { select: { value: true } },
          },
        },
      },
    });
    if (!req) {
      return { success: false, error: "NOT_FOUND" };
    }
    if (req.project.reviewWorkflowEnabled !== true) {
      return { success: false, error: "FEATURE_DISABLED" };
    }
    if (req.status !== "PENDING") {
      return { success: false, error: "ALREADY_DECIDED" };
    }

    const isAdmin = session.user.access === "ADMIN";
    const isRequester = req.requestedByUserId === userId;
    if (!isAdmin && !isRequester) {
      return { success: false, error: "FORBIDDEN" };
    }

    try {
      // Atomic flip — `updateMany` scoped to status=PENDING so a concurrent
      // decide on the same row can't co-commit. Loser sees count === 0 and
      // surfaces as ALREADY_DECIDED.
      const result = await baseDb.reviewRequest.updateMany({
        where: { id: reviewRequestId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (result.count === 0) {
        return { success: false, error: "ALREADY_DECIDED" };
      }
    } catch (err) {
      console.error("cancelReviewRequest: status flip failed", err);
      return { success: false, error: "INTERNAL_ERROR" };
    }

    // Resolve recipients: direct user-assignee or every role holder, minus
    // the canceler themselves.
    let targetUserIds: string[] = [];
    try {
      if (req.assigneeUserId !== null && req.assigneeUserId !== userId) {
        targetUserIds = [req.assigneeUserId];
      } else if (req.assigneeRoleId !== null) {
        targetUserIds = await NotificationService.resolveRoleHolderUserIds(
          req.project.id,
          req.assigneeRoleId,
          userId
        );
      }
    } catch (resolveErr) {
      console.error(
        "cancelReviewRequest: role-holder resolution failed",
        resolveErr
      );
    }

    try {
      const entityName = await loadEntityName(req.entityType, req.entityId);
      if (entityName !== null && targetUserIds.length > 0) {
        await NotificationService.createReviewCancelledNotification({
          targetUserIds,
          cancelerUserId: userId,
          cancelerName: session.user.name ?? "Unknown User",
          projectId: req.project.id,
          projectName: req.project.name,
          entityType: req.entityType,
          entityId: req.entityId,
          entityName,
          fromStateName: req.fromState.name,
          toStateName: req.toState.name,
          reviewRequestId,
        });
      }
    } catch (notifyErr) {
      console.error(
        "cancelReviewRequest: cancel-notification dispatch failed",
        notifyErr
      );
    }

    try {
      const entityName = await loadEntityName(req.entityType, req.entityId);
      if (entityName !== null) {
        await emitReviewCompletedEvent(
          {
            reviewRequestId,
            projectId: req.project.id,
            entityType: req.entityType,
            entityId: req.entityId,
            entityName,
            fromStateId: req.fromStateId,
            toStateId: req.toStateId,
            toStateName: req.toState.name,
            toStateColor: req.toState.color?.value ?? null,
            decision: "CANCELLED",
            decidedByUserId: userId,
            deciderName: session.user.name ?? "Unknown User",
            decisionComment: null,
            requestedByUserId: req.requestedByUserId,
            requesterName: session.user.name ?? "Unknown User",
          },
          { actorUserId: userId }
        );
      }
    } catch (webhookErr) {
      console.error(
        "cancelReviewRequest: review-cancelled webhook emit failed",
        webhookErr
      );
    }

    try {
      await captureAuditEvent({
        action: "REVIEW_CANCELLED",
        entityType: "ReviewRequest",
        entityId: reviewRequestId,
        projectId: req.project.id,
        userId,
        metadata: {
          fromStateId: req.fromStateId,
          toStateId: req.toStateId,
          cancelerUserId: userId,
          requestedByUserId: req.requestedByUserId,
          entityType: req.entityType,
          entityId: req.entityId,
        },
      });
    } catch (auditErr) {
      console.error("cancelReviewRequest: audit emission failed", auditErr);
    }

    revalidatePath("/");
    return { success: true, reviewRequestId };
  }
);

async function loadEntityName(
  entityType: ReviewableEntityType,
  entityId: number
): Promise<string | null> {
  if (entityType === "CASE") {
    const row = await baseDb.repositoryCases.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    return row?.name ?? null;
  }
  if (entityType === "RUN") {
    const row = await baseDb.testRuns.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    return row?.name ?? null;
  }
  const row = await baseDb.sessions.findUnique({
    where: { id: entityId },
    select: { name: true },
  });
  return row?.name ?? null;
}
