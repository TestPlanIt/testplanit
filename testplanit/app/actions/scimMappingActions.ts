"use server";

import { z } from "zod/v4";

import { captureAuditEvent } from "~/lib/services/auditLog";
import { getScimAccessRecomputeQueue } from "~/lib/queues";
import { prisma } from "~/lib/prisma";
import { ACCESS_RANK, resolveEffectiveAccess } from "~/lib/scim/access/resolve";
import { readScimFallbackDefault } from "~/lib/scim/access/fallbackDefault";
import { getServerAuthSession } from "~/server/auth";
import type { Access } from "~/zenstack/models";
import type { ScimAccessRecomputeJobData } from "~/workers/scimAccessRecomputeWorker";

const groupIdSchema = z.number().int().positive();
const accessSchema = z
  .enum(["ADMIN", "PROJECTADMIN", "USER", "NONE"])
  .nullable();

export interface DowngradedUser {
  userId: string;
  name: string;
  currentAccess: Access;
  newAccess: Access;
}

export async function previewGroupMappingChange(
  groupId: number,
  newMappedAccess: Access | null
): Promise<
  | { success: true; downgraded: DowngradedUser[] }
  | { success: false; error: string }
> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validatedGroupId: number;
  try {
    validatedGroupId = groupIdSchema.parse(groupId);
    accessSchema.parse(newMappedAccess);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  const fallbackDefault = await readScimFallbackDefault(prisma);

  const members = await prisma.groupAssignment.findMany({
    where: { groupId: validatedGroupId },
    select: { userId: true },
  });

  const downgraded: DowngradedUser[] = [];

  for (const { userId } of members) {
    const [user, allAssignments] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, access: true, accessSource: true },
      }),
      prisma.groupAssignment.findMany({
        where: { userId },
        select: { group: { select: { id: true, mappedAccess: true } } },
      }),
    ]);
    if (!user) continue;

    const simulatedTiers = allAssignments
      .map((a) =>
        a.group.id === validatedGroupId ? newMappedAccess : a.group.mappedAccess
      )
      .filter(Boolean) as Access[];

    const governedAfter =
      simulatedTiers.length > 0 || user.accessSource === "GROUP_MAPPING";
    const newAccess = governedAfter
      ? resolveEffectiveAccess(simulatedTiers, fallbackDefault)
      : user.access;

    if (ACCESS_RANK[newAccess] < ACCESS_RANK[user.access]) {
      downgraded.push({
        userId,
        name: user.name ?? userId,
        currentAccess: user.access,
        newAccess,
      });
    }
  }

  return { success: true, downgraded };
}

export async function previewFallbackDefaultChange(
  newDefault: Access | null
): Promise<
  | { success: true; downgraded: DowngradedUser[] }
  | { success: false; error: string }
> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    accessSchema.parse(newDefault);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  const proposedFallback: Access = newDefault ?? "NONE";
  const currentFallback = await readScimFallbackDefault(prisma);

  const users = await prisma.user.findMany({
    where: { accessSource: "GROUP_MAPPING", isDeleted: false },
    select: { id: true, name: true, access: true },
  });

  const downgraded: DowngradedUser[] = [];

  for (const user of users) {
    const assignments = await prisma.groupAssignment.findMany({
      where: { userId: user.id },
      select: { group: { select: { mappedAccess: true } } },
    });

    const tiers = assignments
      .map((a) => a.group.mappedAccess)
      .filter(Boolean) as Access[];

    const currentEffective = resolveEffectiveAccess(tiers, currentFallback);
    const newEffective = resolveEffectiveAccess(tiers, proposedFallback);

    if (ACCESS_RANK[newEffective] < ACCESS_RANK[currentEffective]) {
      downgraded.push({
        userId: user.id,
        name: user.name ?? user.id,
        currentAccess: currentEffective,
        newAccess: newEffective,
      });
    }
  }

  return { success: true, downgraded };
}

export async function saveMappingChange(
  groupId: number,
  newMappedAccess: Access | null
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validatedGroupId: number;
  try {
    validatedGroupId = groupIdSchema.parse(groupId);
    accessSchema.parse(newMappedAccess);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  try {
    const oldGroup = await prisma.groups.findUnique({
      where: { id: validatedGroupId },
      select: { mappedAccess: true, name: true },
    });

    await prisma.groups.update({
      where: { id: validatedGroupId },
      data: { mappedAccess: newMappedAccess },
    });

    await captureAuditEvent({
      action: "UPDATE",
      entityType: "Groups",
      entityId: String(validatedGroupId),
      entityName: oldGroup?.name ?? String(validatedGroupId),
      userId: session.user.id,
      changes: {
        mappedAccess: {
          old: oldGroup?.mappedAccess ?? null,
          new: newMappedAccess,
        },
      },
      metadata: { source: "admin-mapping-config" },
    });

    const queue = getScimAccessRecomputeQueue();
    if (queue) {
      const jobData: ScimAccessRecomputeJobData = {
        adminUserId: session.user.id,
        groupId: validatedGroupId,
      };
      await queue.add("scim-access-recompute", jobData);
    }

    return { success: true };
  } catch (err) {
    console.error("[scimMappingActions] saveMappingChange failed", err);
    return { success: false, error: "Failed to save mapping" };
  }
}

export async function enqueueFallbackDefaultRecompute(): Promise<{
  success: boolean;
  error?: string;
}> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const queue = getScimAccessRecomputeQueue();
    if (queue) {
      const jobData: ScimAccessRecomputeJobData = {
        adminUserId: session.user.id,
      };
      await queue.add("scim-access-recompute", jobData);
    }
    return { success: true };
  } catch (err) {
    console.error(
      "[scimMappingActions] enqueueFallbackDefaultRecompute failed",
      err
    );
    return { success: false, error: "Failed to enqueue recompute" };
  }
}
