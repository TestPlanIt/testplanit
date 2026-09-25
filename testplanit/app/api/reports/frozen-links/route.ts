import bcrypt from "bcrypt";
import {
  parseRelativeDateRange,
  resolveRequestDateRange,
} from "~/lib/reports/dateRangePresets";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { frozenReportMeta } from "~/lib/reports/frozenReportMeta";
import {
  countSnapshotRows,
  getReportSnapshotMaxRows,
  truncateSnapshotPayload,
} from "~/lib/reports/reportSnapshotCap";
import {
  buildSharedReportPayload,
  callerAuthHeaders,
  findReportType,
} from "~/lib/reports/sharedReportPayload";
import { userHasAreaPermission } from "~/lib/services/areaPermission";
import { generateShareKey } from "~/lib/share-tokens";
import { authOptions } from "~/server/auth";
import { ApplicationArea, AuditAction } from "~/zenstack/models";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    entityType: z.enum(["REPORT", "SAVED_REPORT"]),
    reportConfig: z.record(z.string(), z.unknown()),
    projectId: z.number().int().positive().nullish(),
    mode: z
      .enum(["AUTHENTICATED", "PUBLIC", "PASSWORD_PROTECTED"])
      .default("AUTHENTICATED"),
    password: z.string().min(1).nullish(),
    expiresAt: z.iso.datetime({ offset: true }).nullish(),
    notifyOnView: z.boolean().default(false),
    title: z.string().trim().min(1).max(500).nullish(),
    description: z.string().max(4000).nullish(),
    /** Store a truncated copy when the report exceeds the row cap. */
    allowTruncate: z.boolean().default(false),
  })
  .strict();

/**
 * POST /api/reports/frozen-links
 *
 * Creates a frozen report link: a share link (REPORT) or a private saved
 * report (SAVED_REPORT) whose report output is captured now and served from
 * storage on every open, so the link never changes numbers.
 *
 * The report runs server-side with the caller's own credentials, so the
 * capture holds exactly what the caller could see live; the payload is never
 * taken from the client. Project reports also need Reporting add/edit, the
 * same gate requirement snapshots use. The link itself is created through the
 * policy client, so the ShareLink create rules apply unchanged.
 *
 * A report larger than REPORT_SNAPSHOT_MAX_ROWS returns 409 with the row
 * counts and creates nothing; the caller confirms and resends with
 * `allowTruncate: true` to keep the first rows only.
 */
export const POST = withAuditContext(async (request: NextRequest) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let parsedJson: unknown;
    try {
      parsedJson = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const isSavedReport = body.entityType === "SAVED_REPORT";
    const projectId = body.projectId ?? null;

    if (!findReportType(body.reportConfig.reportType)) {
      return NextResponse.json(
        { error: "Unsupported report type" },
        { status: 400 }
      );
    }

    // A saved report is only ever opened by its owner, signed in.
    const mode = isSavedReport ? "AUTHENTICATED" : body.mode;
    if (mode === "PASSWORD_PROTECTED" && !body.password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    if (projectId !== null) {
      const canCapture = await userHasAreaPermission(
        session.user.id,
        projectId,
        ApplicationArea.Reporting,
        "canAddEdit"
      );
      if (!canCapture) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Saved reports keep their project inside the config; the row has none,
    // which is what keeps it private under the ShareLink read rules.
    const storedConfig = isSavedReport
      ? { ...body.reportConfig, ...(projectId !== null && { projectId }) }
      : body.reportConfig;
    // A relative date range ("last week") resolves once, now: the capture
    // runs on these dates and the stored config keeps them, so the frozen
    // report names the range it actually covers.
    const entityConfig = parseRelativeDateRange(storedConfig)
      ? { ...storedConfig, ...resolveRequestDateRange(storedConfig) }
      : storedConfig;

    const built = await buildSharedReportPayload({
      config: entityConfig,
      projectId,
      authHeaders: callerAuthHeaders(request),
    });
    if (!built.ok) {
      return NextResponse.json(
        { error: built.error },
        { status: built.status }
      );
    }

    const maxRows = getReportSnapshotMaxRows();
    const totalRowCount = countSnapshotRows(built.payload);
    const truncated = totalRowCount > maxRows;
    if (truncated && !body.allowTruncate) {
      return NextResponse.json(
        {
          error: "Report exceeds the frozen report row limit",
          code: "SNAPSHOT_TRUNCATION_REQUIRED",
          totalRowCount,
          maxRows,
        },
        { status: 409 }
      );
    }
    const payload = truncated
      ? truncateSnapshotPayload(built.payload, maxRows)
      : built.payload;

    const passwordHash =
      mode === "PASSWORD_PROTECTED" && body.password
        ? await bcrypt.hash(body.password, 10)
        : null;

    const enhancedDb = await getEnhancedDb(session);
    const shareLink = await enhancedDb.shareLink.create({
      data: {
        shareKey: generateShareKey(),
        entityType: body.entityType,
        entityConfig: entityConfig as any,
        ...(!isSavedReport && projectId !== null && { projectId }),
        createdById: session.user.id,
        mode,
        passwordHash,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        notifyOnView: isSavedReport ? false : body.notifyOnView,
        title: body.title ?? null,
        description: body.description || null,
      },
    });

    let snapshot;
    try {
      snapshot = await baseDb.reportSnapshot.create({
        data: {
          shareLinkId: shareLink.id,
          payload: payload as any,
          rowCount: countSnapshotRows(payload),
          totalRowCount,
          truncated,
          capturedById: session.user.id,
        },
      });
    } catch (error) {
      // The key was never handed out, but a link without its snapshot would
      // run live, so retire it before reporting the failure.
      await baseDb.shareLink.update({
        where: { id: shareLink.id },
        data: { isDeleted: true, deletedAt: new Date(), isRevoked: true },
      });
      throw error;
    }

    await baseDb.auditLog.create({
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
          hasPassword: !!passwordHash,
          expiresAt: shareLink.expiresAt?.toISOString() || null,
          notifyOnView: shareLink.notifyOnView,
          frozen: true,
          truncated,
        },
        projectId,
      },
    });

    return NextResponse.json(
      {
        id: shareLink.id,
        shareKey: shareLink.shareKey,
        entityType: shareLink.entityType,
        mode: shareLink.mode,
        title: shareLink.title,
        description: shareLink.description,
        projectId: shareLink.projectId,
        expiresAt: shareLink.expiresAt,
        notifyOnView: shareLink.notifyOnView,
        viewCount: shareLink.viewCount,
        createdAt: shareLink.createdAt,
        frozen: frozenReportMeta({
          ...snapshot,
          capturedBy: { name: session.user.name ?? null },
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Frozen report link creation error:", error);
    return NextResponse.json(
      { error: "Failed to create frozen report" },
      { status: 500 }
    );
  }
});
