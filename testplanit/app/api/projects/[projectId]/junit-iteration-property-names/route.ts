/**
 * PUT /api/projects/[projectId]/junit-iteration-property-names
 *
 * Sets the per-project list of JUnit property names that the
 * `/api/test-results/import` route looks up to find the iteration value on
 * each `<testcase>` (INT-02). The default lookup is `["iteration"]` —
 * teams with custom CI emitters (`iterationIndex`, `dataRow`, etc.) use
 * this endpoint to add their own names.
 *
 * Access control: project-admin or system admin only. The check is the
 * same shape as the other project-settings routes — ZenStack's `@@allow`
 * policy on `Projects` is the authoritative gate; this route additionally
 * verifies session access for fast-path 401/403 rejection.
 *
 * Validation rules (T-06-01-05 defense + UX hygiene):
 *   - Array length capped at 16 (a sane upper bound — projects with more
 *     than that are almost certainly mis-typing, not actually emitting
 *     16+ distinct property names).
 *   - Each name is trimmed; empty strings rejected.
 *   - Names must not contain whitespace (XML attribute parsing requires
 *     single tokens; mid-name whitespace would never match the parsed key).
 *   - Names longer than 64 characters rejected (defensive bound).
 *   - The literal strings `__proto__`, `constructor`, and `prototype` are
 *     refused even though `extractIterationIndex` already uses
 *     `Object.entries` (prototype-pollution defense-in-depth).
 */

import { ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

const RESERVED_PROTOTYPE_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const putBodySchema = z.object({
  propertyNames: z
    .array(
      z
        .string()
        .trim()
        .min(1, "junitIterationPropertyNameEmpty")
        .max(64, "junitIterationPropertyNameTooLong")
        .refine(
          (s) => !/\s/.test(s),
          "junitIterationPropertyNameContainsWhitespace"
        )
        .refine(
          (s) => !RESERVED_PROTOTYPE_KEYS.has(s),
          "junitIterationPropertyNameReserved"
        )
    )
    .max(16, "junitIterationPropertyNamesTooMany"),
});

export const PUT = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      updateAuditContext({ userId: session.user.id });

      const { projectId: projectIdParam } = await params;
      const projectId = parseInt(projectIdParam);
      if (Number.isNaN(projectId)) {
        return NextResponse.json(
          { error: "Invalid projectId" },
          { status: 400 }
        );
      }

      // Admin / project-admin gate. Matches the shape used by sibling
      // routes (e.g. integrations/route.ts) — session.user.access is the
      // canonical role marker.
      const isAdmin = session.user.access === "ADMIN";
      const isProjectAdmin = session.user.access === "PROJECTADMIN";
      if (!isAdmin && !isProjectAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Confirm the project exists and the caller has access to it. We
      // reuse the same access-where shape used by the integrations route
      // so the authorization model is uniform.
      const project = await prisma.projects.findFirst({
        where: {
          id: projectId,
          isDeleted: false,
          ...(isAdmin
            ? {}
            : {
                OR: [
                  {
                    userPermissions: {
                      some: {
                        userId: session.user.id,
                        accessType: { not: ProjectAccessType.NO_ACCESS },
                      },
                    },
                  },
                  {
                    assignedUsers: {
                      some: { userId: session.user.id },
                    },
                  },
                ],
              }),
        },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const body = await request.json();
      const parsed = putBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Invalid request body",
            issues: parsed.error.issues,
          },
          { status: 400 }
        );
      }

      const updated = await prisma.projects.update({
        where: { id: projectId },
        data: { junitIterationPropertyNames: parsed.data.propertyNames },
        select: { id: true, junitIterationPropertyNames: true },
      });

      return NextResponse.json({
        propertyNames: updated.junitIterationPropertyNames,
      });
    } catch (err) {
      console.error("PUT junit-iteration-property-names failed:", err);
      return NextResponse.json(
        { error: "Failed to update property names" },
        { status: 500 }
      );
    }
  }
);
