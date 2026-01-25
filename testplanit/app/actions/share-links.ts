"use server";

import bcrypt from "bcrypt";
import { generateShareKey } from "~/lib/share-tokens";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { AuditAction } from "@prisma/client";

/**
 * Server action to prepare share link data
 * Generates share key and hashes password if needed
 */
export async function prepareShareLinkData(data: {
  password?: string | null;
}) {
  const shareKey = generateShareKey();

  let passwordHash: string | null = null;
  if (data.password) {
    passwordHash = await bcrypt.hash(data.password, 10);
  }

  return {
    shareKey,
    passwordHash,
  };
}

/**
 * Server action to create audit log for share link creation
 * Called after successful ZenStack creation
 */
export async function auditShareLinkCreation(shareLink: {
  id: string;
  shareKey: string;
  entityType: string;
  mode: string;
  title: string | null;
  projectId?: number;
  expiresAt: Date | null;
  notifyOnView: boolean;
  passwordHash: string | null;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return;
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      userEmail: session.user.email,
      userName: session.user.name,
      action: AuditAction.SHARE_LINK_CREATED,
      entityType: "ShareLink",
      entityId: shareLink.id,
      entityName: shareLink.title || `${shareLink.entityType} share`,
      metadata: {
        shareKey: shareLink.shareKey,
        entityType: shareLink.entityType,
        mode: shareLink.mode,
        hasPassword: !!shareLink.passwordHash,
        expiresAt: shareLink.expiresAt?.toISOString() || null,
        notifyOnView: shareLink.notifyOnView,
      },
      projectId: shareLink.projectId ?? null,
    },
  });
}

/**
 * Server action to revoke a share link and create audit log
 */
export async function revokeShareLink(shareLinkId: string) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    throw new Error("Authentication required");
  }

  // Fetch share link details for audit log
  const shareLink = await prisma.shareLink.findUnique({
    where: { id: shareLinkId },
  });

  if (!shareLink) {
    throw new Error("Share link not found");
  }

  // Check permissions
  const project = shareLink.projectId
    ? await prisma.projects.findUnique({
        where: { id: shareLink.projectId },
      })
    : null;

  const canRevoke =
    session.user.access === "ADMIN" ||
    shareLink.createdById === session.user.id ||
    (project && project.createdBy === session.user.id);

  if (!canRevoke) {
    throw new Error("You do not have permission to revoke this share link");
  }

  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      userEmail: session.user.email,
      userName: session.user.name,
      action: AuditAction.SHARE_LINK_REVOKED,
      entityType: "ShareLink",
      entityId: shareLink.id,
      entityName: shareLink.title || `${shareLink.entityType} share`,
      metadata: {
        shareKey: shareLink.shareKey,
        entityType: shareLink.entityType,
        mode: shareLink.mode,
        viewCount: shareLink.viewCount,
      },
      projectId: shareLink.projectId,
    },
  });

  return { success: true };
}
