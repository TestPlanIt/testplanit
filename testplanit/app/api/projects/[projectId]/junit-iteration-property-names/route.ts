/**
 * PUT /api/projects/[projectId]/junit-iteration-property-names
 *
 * Sets the per-project list of JUnit property names that the
 * `/api/test-results/import` route looks up to find the iteration value on
 * each `<testcase>` (INT-02). The default lookup is `["iteration"]` —
 * teams with custom CI emitters (`iterationIndex`, `dataRow`, etc.) use
 * this endpoint to add their own names.
 *
 * Access control: project admins only, resolved by
 * `authorizeProjectAdminForProject` — the same gate every other
 * project-settings surface uses (system ADMIN, the project creator, an
 * assigned system PROJECTADMIN, or an effective role with Settings
 * canAddEdit).
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

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
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

      // Project-admin gate; also confirms the project exists and is not
      // deleted.
      const auth = await authorizeProjectAdminForProject(session, projectId);
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error ?? "Forbidden" },
          { status: auth.status }
        );
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

      const updated = await baseDb.projects.update({
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
