import { NextRequest, NextResponse } from "next/server";
import { calculateDiff, captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

// Password policy fields that this endpoint manages
const POLICY_FIELDS = [
  "minPasswordLength",
  "requireUppercase",
  "requireLowercase",
  "requireNumbers",
  "requiredSpecialChars",
  "passwordHistoryDepth",
  "passwordExpirationDays",
  "lockoutThreshold",
  "lockoutDurationMinutes",
] as const;

export async function PATCH(request: NextRequest) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Only accept known policy fields — strip anything else
  const updateData: Record<string, unknown> = {};
  for (const field of POLICY_FIELDS) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid policy fields provided" },
      { status: 400 }
    );
  }

  // Basic validation
  if (updateData.minPasswordLength !== undefined) {
    const len = Number(updateData.minPasswordLength);
    if (isNaN(len) || len < 8 || len > 128) {
      return NextResponse.json(
        { error: "minPasswordLength must be between 8 and 128" },
        { status: 400 }
      );
    }
  }
  if (updateData.passwordHistoryDepth !== undefined) {
    const depth = Number(updateData.passwordHistoryDepth);
    if (isNaN(depth) || depth < 0) {
      return NextResponse.json(
        { error: "passwordHistoryDepth must be 0 or greater" },
        { status: 400 }
      );
    }
  }
  if (updateData.passwordExpirationDays !== undefined) {
    const days = Number(updateData.passwordExpirationDays);
    if (isNaN(days) || days < 0) {
      return NextResponse.json(
        { error: "passwordExpirationDays must be 0 or greater" },
        { status: 400 }
      );
    }
  }
  if (updateData.lockoutThreshold !== undefined) {
    const threshold = Number(updateData.lockoutThreshold);
    if (isNaN(threshold) || threshold < 1) {
      return NextResponse.json(
        { error: "lockoutThreshold must be 1 or greater" },
        { status: 400 }
      );
    }
  }
  if (updateData.lockoutDurationMinutes !== undefined) {
    const duration = Number(updateData.lockoutDurationMinutes);
    if (isNaN(duration) || duration < 1) {
      return NextResponse.json(
        { error: "lockoutDurationMinutes must be 1 or greater" },
        { status: 400 }
      );
    }
  }

  try {
    // Fetch current settings for audit diff (per D-13)
    // Include id for the update where clause
    const currentSettings = await db.registrationSettings.findFirst({
      select: {
        id: true,
        ...Object.fromEntries(POLICY_FIELDS.map((f) => [f, true])),
      },
    });

    if (!currentSettings) {
      return NextResponse.json(
        { error: "Registration settings not found" },
        { status: 404 }
      );
    }

    // Build "old" snapshot for only the fields being changed
    const oldSnapshot: Record<string, unknown> = {};
    const newSnapshot: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateData)) {
      oldSnapshot[key] = (currentSettings as Record<string, unknown>)[key];
      newSnapshot[key] = value;
    }

    // Apply update (per D-10: idempotent update)
    const updated = await db.registrationSettings.update({
      where: { id: (currentSettings as Record<string, unknown>).id as string },
      data: updateData,
    });

    // Calculate diff and fire audit event only if something actually changed (per D-13)
    const diff = calculateDiff(oldSnapshot, newSnapshot);
    if (diff) {
      await captureAuditEvent({
        action: "PASSWORD_POLICY_CHANGED",
        entityType: "RegistrationSettings",
        entityId: (currentSettings as Record<string, unknown>).id as string,
        userId: session.user.id,
        metadata: { diff },
      });
    }

    return NextResponse.json({ success: true, settings: updated });
  } catch (error) {
    console.error("Error updating registration settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
