import type { Session } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";

/**
 * Policy-scoped visibility gate for milestone API routes (T-18-01-02 /
 * T-18-05-01): resolves the milestone through the enhanced client so the
 * project-scoped `Milestones` read ACL decides whether this session can see
 * it. Returns null when the milestone doesn't exist OR the user lacks
 * project access — callers return 404 either way, so an unauthorized probe
 * can't distinguish "no such milestone" from "not yours" (no existence
 * oracle).
 *
 * Routes that need more milestone fields should gate with this first, then
 * fetch details via `baseDb` — visibility is already decided.
 */
export async function getVisibleMilestone(
  session: Session,
  milestoneId: number
): Promise<{ id: number; projectId: number } | null> {
  const db = await getEnhancedDb(session);
  const milestone = await db.milestones.findFirst({
    where: { id: milestoneId },
    select: { id: true, projectId: true },
  });
  return milestone ?? null;
}
