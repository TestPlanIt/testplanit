/**
 * GET /api/admin/audit-logs/archives/:id
 *
 * Downloads one archive: a gzipped NDJSON file, one AuditLog row per line. The
 * object is streamed through the app so private archive buckets work without a
 * public storage endpoint. Each download is recorded as a DATA_EXPORTED audit
 * event. Admin session or admin API token.
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

import { getS3Client } from "~/lib/s3Client";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { db } from "~/server/db";

import { requireArchiveAdmin } from "../auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireArchiveAdmin(request);
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = Number.parseInt(rawId, 10);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id)) {
    return NextResponse.json({ error: "Invalid archive id" }, { status: 400 });
  }

  try {
    const archive = await db.auditLogArchive.findUnique({ where: { id } });
    if (!archive) {
      return NextResponse.json({ error: "Archive not found" }, { status: 404 });
    }

    const object = await getS3Client().send(
      new GetObjectCommand({ Bucket: archive.bucket, Key: archive.key })
    );
    if (!object.Body) {
      return NextResponse.json(
        { error: "Archive object is empty" },
        { status: 502 }
      );
    }

    const fileName =
      archive.key.split("/").pop() ?? `audit-log-archive-${id}.ndjson.gz`;

    await captureAuditEvent({
      action: "DATA_EXPORTED",
      entityType: "AuditLogArchive",
      entityId: String(archive.id),
      entityName: fileName,
      userId: auth.userId,
      userEmail: auth.userEmail,
      userName: auth.userName,
      metadata: {
        exportType: "audit-log-archive",
        firstTimestamp: archive.firstTimestamp.toISOString(),
        lastTimestamp: archive.lastTimestamp.toISOString(),
        rowCount: archive.rowCount,
      },
    });

    return new Response(object.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(archive.byteSize),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Archive-SHA256": archive.sha256,
        "X-Archive-Row-Count": String(archive.rowCount),
      },
    });
  } catch (error) {
    console.error("Error downloading audit log archive:", error);
    return NextResponse.json(
      { error: "Failed to download audit log archive" },
      { status: 500 }
    );
  }
}
