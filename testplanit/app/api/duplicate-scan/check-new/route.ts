import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "~/lib/prisma";
import { DuplicateScanService } from "~/lib/services/duplicateScanService";
import { authOptions } from "~/server/auth";
import { getElasticsearchClient } from "~/services/elasticsearchService";

const checkNewSchema = z.object({
  projectId: z.number(),
  name: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = checkNewSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId, name, tags } = parsed.data;

  const esClient = getElasticsearchClient();

  if (!esClient) {
    return NextResponse.json({ cases: [] });
  }

  try {
    const tenantId = getCurrentTenantId();

    const service = new DuplicateScanService(prisma, esClient);
    const pairs = await service.findSimilarCases(
      { name, tags: tags?.map((t) => ({ name: t })) },
      projectId,
      tenantId,
    );

    const top3 = pairs.slice(0, 3);

    if (top3.length === 0) {
      return NextResponse.json({ cases: [] });
    }

    // The new case has no id, so DuplicateScanService sets caseAId=0 and caseBId=candidate.id
    // Collect the candidate IDs (caseBId when caseAId is 0)
    const caseIds = top3.map((pair) =>
      pair.caseAId === 0 ? pair.caseBId : pair.caseAId,
    );

    const caseRecords = await prisma.repositoryCases.findMany({
      where: { id: { in: caseIds } },
      select: { id: true, name: true },
    });

    const caseNameMap = new Map(caseRecords.map((c) => [c.id, c.name]));

    const cases = top3.map((pair) => {
      // The candidate is the non-zero ID (source case has no id, so caseAId is 0 and caseBId is the candidate)
      const candidateId = pair.caseAId === 0 ? pair.caseBId : pair.caseAId;
      return {
        id: candidateId,
        name: caseNameMap.get(candidateId) ?? "",
        confidence: pair.confidence,
        matchedFields: pair.matchedFields,
      };
    });

    return NextResponse.json({ cases });
  } catch (error) {
    console.error("Duplicate check-new error:", error);
    return NextResponse.json({ cases: [] });
  }
}
