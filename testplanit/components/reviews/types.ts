import type { Prisma } from "@prisma/client";

/**
 * Shared ReviewRequest payload shapes for the Phase 02 review-feature UI.
 *
 * WR-07: the per-component `as` casts in ReviewActionPanel.tsx,
 * ReviewStatusBanner.tsx, and ReviewInboxButton.tsx (anonymous-type
 * casts on userWithRoles) widened the surface enough that a future
 * schema rename (e.g. `assigneeRoleId` -> `reviewerRoleId`) would have
 * compiled cleanly and crashed at runtime. ZenStack's generated typings
 * collapse include shapes to a generic `{}` at the call site because
 * the args object is computed at runtime, so the consuming components
 * cannot directly use `Prisma.ReviewRequestGetPayload<typeof args>`.
 *
 * Defining the include literal here (as `const`) and re-using it across
 * the component + the `Prisma.ReviewRequestGetPayload<{ include: typeof X }>`
 * helper restores end-to-end type safety: rename a field in schema.zmodel
 * and the included relation becomes unresolvable at this seam, which
 * surfaces as a real type error in the consuming components.
 *
 * Each helper exports a paired (includeArgs, Payload) tuple so the
 * consumer can `useFindFirstReviewRequest({ where: ..., include:
 * REVIEW_ACTION_PANEL_INCLUDE })` and trust the generated hook's
 * payload type without an `as` cast.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ReviewActionPanel — uses fromState, toState, requestedBy.
// ─────────────────────────────────────────────────────────────────────────────

export const REVIEW_ACTION_PANEL_INCLUDE = {
  fromState: true,
  toState: true,
  requestedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.ReviewRequestInclude;

export type ReviewActionPanelRequest = Prisma.ReviewRequestGetPayload<{
  include: typeof REVIEW_ACTION_PANEL_INCLUDE;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// ReviewStatusBanner — uses requestedBy, assigneeUser, assigneeRole.
// ─────────────────────────────────────────────────────────────────────────────

export const REVIEW_STATUS_BANNER_INCLUDE = {
  requestedBy: { select: { id: true, name: true, image: true } },
  assigneeUser: { select: { id: true, name: true, image: true } },
  assigneeRole: { select: { id: true, name: true } },
} as const satisfies Prisma.ReviewRequestInclude;

export type ReviewStatusBannerRequest = Prisma.ReviewRequestGetPayload<{
  include: typeof REVIEW_STATUS_BANNER_INCLUDE;
}>;
