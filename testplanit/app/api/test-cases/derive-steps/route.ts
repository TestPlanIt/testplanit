/**
 * Test Case Step Derivation API Route
 *
 * Lets an automation client (e.g. the WDIO reporter) request opt-in, background
 * LLM step derivation for low-structure cases it created/matched. The job only
 * runs when an LLM provider is configured for the project (provider config IS
 * the opt-in); otherwise this is inert. Derivation never runs inline here — it
 * is always enqueued to the derive-case-steps worker.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authenticateApiToken, extractBearerToken } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
import { enqueueDeriveCaseSteps } from "~/lib/services/llmStepDerivation";
import { getServerAuthSession } from "~/server/auth";

const bodySchema = z.object({
  projectId: z.number().int().positive(),
  testRunId: z.number().int().positive(),
  // Destructive opt-in: re-derive cases that already have steps.
  overwrite: z.boolean().optional().default(false),
  cases: z
    .array(
      z.object({
        testCaseId: z.number().int().positive(),
        name: z.string(),
        className: z.string().nullable().optional(),
        failure: z.string().nullable().optional(),
        systemOut: z.string().nullable().optional(),
        commands: z.array(z.string()).optional(),
      })
    )
    .min(1),
});

export async function POST(request: NextRequest) {
  // Authenticate (session OR API token — the reporter uses an API token).
  const session = await getServerAuthSession();
  let userId = session?.user?.id;

  if (!userId) {
    const token = extractBearerToken(request);
    if (token) {
      const apiAuth = await authenticateApiToken(request);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      userId = apiAuth.userId;
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  // Guard against cross-project writes: only derive for cases that actually
  // belong to the given project.
  const ownedCaseIds = new Set(
    (
      await prisma.repositoryCases.findMany({
        where: {
          id: { in: body.cases.map((c) => c.testCaseId) },
          projectId: body.projectId,
          isDeleted: false,
        },
        select: { id: true },
      })
    ).map((r) => r.id)
  );

  const cases = body.cases
    .filter((c) => ownedCaseIds.has(c.testCaseId))
    .map((c) => ({
      testCaseId: c.testCaseId,
      name: c.name,
      className: c.className ?? null,
      failure: c.failure ?? null,
      systemOut: c.systemOut ?? null,
      ...(c.commands && c.commands.length > 0 ? { commands: c.commands } : {}),
    }));

  if (cases.length === 0) {
    return NextResponse.json({ enqueued: false });
  }

  const enqueued = await enqueueDeriveCaseSteps({
    prisma,
    projectId: body.projectId,
    testRunId: body.testRunId,
    userId,
    cases,
    overwrite: body.overwrite,
  });

  return NextResponse.json({ enqueued });
}
