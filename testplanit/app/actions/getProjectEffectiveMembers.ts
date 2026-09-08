"use server";

import { getProjectEffectiveMemberIds } from "~/lib/services/projectMembers";

/**
 * Server-action wrapper. The implementation lives in
 * `lib/services/projectMembers.ts` so BullMQ workers — which cannot import a
 * `"use server"` module — can share it.
 */
export async function getProjectEffectiveMembers(
  projectId: number
): Promise<string[]> {
  return getProjectEffectiveMemberIds(projectId);
}
