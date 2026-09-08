import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";

// Soft-delete a repository folder and its entire subtree in ONE request.
//
// The client used to do this by (1) reading every descendant case with the
// full `folderId: { in: [...] }` array in a GET query string (→ HTTP 414 on a
// deep tree) and (2) firing one PUT per descendant folder via Promise.all (→
// net::ERR_INSUFFICIENT_RESOURCES once a tree had hundreds/thousands of
// folders). Both scale with the subtree size on the wire. Here the client sends
// only the single root folderId; the server resolves the subtree with a
// recursive CTE and performs the whole delete as one bounded, atomic write.
const requestSchema = z.object({
  folderId: z.number().int(),
});

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { projectId: projectIdParam } = await params;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) {
        return NextResponse.json(
          { error: "Invalid project ID" },
          { status: 400 }
        );
      }

      const body = await request.json();
      const { folderId } = requestSchema.parse(body);

      const db = await getEnhancedDb(session);

      // Load the root folder through the policy client: confirms it exists,
      // belongs to this project, isn't already deleted, and the caller has READ
      // access. `order` is selected so the authorization probe below is a true
      // no-op (re-sets the column to its current value).
      const root = await db.repositoryFolders.findUnique({
        where: { id: folderId },
        select: { id: true, projectId: true, isDeleted: true, order: true },
      });

      if (!root || root.isDeleted || root.projectId !== projectId) {
        return NextResponse.json(
          { error: "Folder not found or access denied" },
          { status: 404 }
        );
      }

      // Authorize the destructive operation against the REAL RepositoryFolders
      // `@@allow('update')` policy without mutating anything: a policy-denied
      // update throws. The policy is project-uniform (it depends on the
      // project/user/role, not per-folder fields), so being allowed to update
      // the root means being allowed to update every folder in the subtree.
      try {
        await db.repositoryFolders.update({
          where: { id: folderId },
          data: { order: root.order },
        });
      } catch {
        return NextResponse.json(
          { error: "You do not have permission to delete this folder" },
          { status: 403 }
        );
      }

      // Resolve the subtree server-side (root + every non-deleted descendant in
      // the same project). Mirrors the CTE in cases/by-folder-descendants. Safe
      // raw read: authorization is already enforced above.
      const descendantRows = await baseDb.$queryRaw<Array<{ id: number }>>`
        WITH RECURSIVE descendants AS (
          SELECT id
          FROM "RepositoryFolders"
          WHERE id = ${folderId}
            AND "projectId" = ${projectId}
            AND "isDeleted" = false
          UNION ALL
          SELECT f.id
          FROM "RepositoryFolders" f
          INNER JOIN descendants d ON f."parentId" = d.id
          WHERE f."projectId" = ${projectId}
            AND f."isDeleted" = false
        )
        SELECT id FROM descendants
      `;
      const folderIds = descendantRows.map((r) => r.id);

      if (folderIds.length === 0) {
        return NextResponse.json({ deletedFolders: 0, deletedCases: 0 });
      }

      // One atomic, actor-attributed transaction replaces the client's fan-out
      // of one PUT per folder. Cases go through the ORM (a single bulk
      // updateMany); folders use a single parameterized UPDATE that both
      // soft-deletes and renames. Appending a shared timestamp frees each
      // original name for reuse and keeps the
      // (projectId, repositoryId, parentId, name, isDeleted) unique index happy
      // across repeat deletes of a same-named folder.
      const deletionTimestamp = Date.now();
      const result = await auditedTransaction(async (tx) => {
        const casesUpdate = await tx.repositoryCases.updateMany({
          where: {
            projectId,
            folderId: { in: folderIds },
            isDeleted: false,
          },
          data: { isDeleted: true },
        });

        const foldersDeleted = await tx.$executeRaw`
          UPDATE "RepositoryFolders"
          SET "isDeleted" = true,
              "name" = "name" || '_deleted_' || ${deletionTimestamp}::text
          WHERE id = ANY(${folderIds}::int[])
            AND "projectId" = ${projectId}
            AND "isDeleted" = false
        `;

        return {
          deletedCases: casesUpdate.count ?? 0,
          deletedFolders: Number(foldersDeleted),
        };
      });

      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid request data", details: error.issues },
          { status: 400 }
        );
      }

      console.error("Error deleting folder subtree:", error);
      return NextResponse.json(
        { error: "Failed to delete folder" },
        { status: 500 }
      );
    }
  }
);
