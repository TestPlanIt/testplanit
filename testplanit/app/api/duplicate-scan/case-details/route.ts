import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

const querySchema = z.object({
  caseAId: z.coerce.number().int().positive(),
  caseBId: z.coerce.number().int().positive(),
});

async function fetchCaseDetails(caseId: number) {
  return prisma.repositoryCases.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      source: true,
      automated: true,
      creator: { select: { id: true, name: true, image: true } },
      folder: { select: { id: true, name: true } },
      steps: {
        where: { isDeleted: false },
        orderBy: { order: "asc" },
        select: { id: true, step: true, expectedResult: true, order: true },
      },
      tags: { select: { id: true, name: true } },
      template: {
        select: {
          caseFields: {
            orderBy: { order: "asc" },
            select: {
              caseFieldId: true,
              order: true,
              caseField: {
                select: {
                  type: { select: { type: true } },
                },
              },
            },
          },
        },
      },
      caseFieldValues: {
        select: {
          id: true,
          value: true,
          field: {
            select: {
              id: true,
              displayName: true,
              type: { select: { type: true } },
              fieldOptions: {
                select: {
                  fieldOption: {
                    select: {
                      id: true,
                      name: true,
                      icon: { select: { name: true } },
                      iconColor: { select: { value: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      _count: { select: { attachments: true } },
      testRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: { select: { id: true, name: true } },
          createdAt: true,
          testRun: { select: { name: true } },
        },
      },
    },
  });
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      caseAId: url.searchParams.get("caseAId"),
      caseBId: url.searchParams.get("caseBId"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { caseAId, caseBId } = parsed.data;

    const [caseA, caseB] = await Promise.all([
      fetchCaseDetails(caseAId),
      fetchCaseDetails(caseBId),
    ]);

    if (!caseA || !caseB) {
      return NextResponse.json(
        { error: "One or both cases not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ caseA, caseB });
  } catch (error) {
    console.error("Duplicate scan case-details error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
