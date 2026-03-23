import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "~/server/auth";
import {
  dismissPair,
  linkCases,
  mergeCases,
} from "~/lib/services/mergeService";

const resolveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("merge"),
    survivorId: z.number().int().positive(),
    victimId: z.number().int().positive(),
    projectId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("link"),
    caseAId: z.number().int().positive(),
    caseBId: z.number().int().positive(),
    projectId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("dismiss"),
    caseAId: z.number().int().positive(),
    caseBId: z.number().int().positive(),
    projectId: z.number().int().positive(),
  }),
]);

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = resolveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const data = parsed.data;

    switch (data.action) {
      case "merge": {
        const result = await mergeCases(
          data.survivorId,
          data.victimId,
          session.user.id,
        );
        return NextResponse.json({ action: "merge", ...result });
      }
      case "link": {
        const result = await linkCases(
          data.caseAId,
          data.caseBId,
          session.user.id,
          data.projectId,
        );
        return NextResponse.json({ action: "link", ...result });
      }
      case "dismiss": {
        const result = await dismissPair(
          data.caseAId,
          data.caseBId,
          data.projectId,
        );
        return NextResponse.json({ action: "dismiss", ...result });
      }
    }
  } catch (error) {
    console.error("Duplicate scan resolve error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
