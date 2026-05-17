import type { Prisma } from "@prisma/client";

/**
 * Shared ReviewRequest payload shapes for the Phase 02 review-feature UI.
 *
 * Defining the include literal here (as `const`) and re-using it across the
 * component + the `Prisma.ReviewRequestGetPayload<{ include: typeof X }>`
 * helper restores end-to-end type safety: rename a field in schema.zmodel
 * and the included relation becomes unresolvable at this seam, which
 * surfaces as a real type error in the consuming components rather than a
 * runtime null deref.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ReviewStatusBanner — hosts both the read-only banner and (in PENDING) the
// reviewer's decision-button cluster, so the include carries assignee/role
// identities, decider identity, and from/to state with icon+color.
// ─────────────────────────────────────────────────────────────────────────────

export const REVIEW_STATUS_BANNER_INCLUDE = {
  requestedBy: { select: { id: true, name: true, image: true } },
  assigneeUser: { select: { id: true, name: true, image: true } },
  assigneeRole: { select: { id: true, name: true } },
  // CHANGES_REQUESTED + REJECTED banners render an attribution row with
  // the reviewer pill + RelativeTimeTooltip on `decidedAt`, so we need
  // the decider's identity loaded alongside the request itself.
  decidedBy: { select: { id: true, name: true, image: true } },
  // Both states carry icon+color so `WorkflowStateDisplay` can render
  // the transition pills inline in the PENDING banner ("Review requested
  // from X for fromState → toState"), in the decision dialogs (target
  // state in the dialog body), and as the sheet's `fromStateId` source
  // when the request-again flow re-uses this banner's data.
  fromState: {
    include: {
      icon: { select: { name: true } },
      color: { select: { value: true } },
    },
  },
  toState: {
    include: {
      icon: { select: { name: true } },
      color: { select: { value: true } },
    },
  },
} as const satisfies Prisma.ReviewRequestInclude;

export type ReviewStatusBannerRequest = Prisma.ReviewRequestGetPayload<{
  include: typeof REVIEW_STATUS_BANNER_INCLUDE;
}>;
