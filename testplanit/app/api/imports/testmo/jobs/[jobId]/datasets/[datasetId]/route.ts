import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import type { TestmoDatasetDetailPayload } from "~/services/imports/testmo/types";

interface RouteContext {
  params: Promise<{
    jobId: string;
    datasetId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId, datasetId: datasetIdParam } = await context.params;
    const datasetId = Number(datasetIdParam);

    if (!Number.isFinite(datasetId)) {
      return NextResponse.json({ error: "Invalid dataset id" }, { status: 400 });
    }

    const dataset = await db.testmoImportDataset.findFirst({
      where: {
        id: datasetId,
        jobId,
        job: {
          createdById: session.user.id,
        },
      },
      select: {
        id: true,
        name: true,
        rowCount: true,
        sampleRowCount: true,
        truncated: true,
        schema: true,
        sampleRows: true,
        allRows: true,
      },
    });

    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    const toPlainObject = (
      value: unknown
    ): Record<string, unknown> | null => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value && typeof value === "object"
          ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>)
          : null;
      }

      return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    };

    const toPlainArray = (value: unknown): unknown[] => {
      if (Array.isArray(value)) {
        return value.map((entry) => JSON.parse(JSON.stringify(entry)));
      }

      if (value && typeof value === "object") {
        return Object.values(value as Record<string, unknown>).map((entry) =>
          JSON.parse(JSON.stringify(entry))
        );
      }

      return [];
    };

    const schemaValue = toPlainObject(dataset.schema);
    const sampleRowsValue = toPlainArray(dataset.sampleRows);
    const allRowsArray = toPlainArray(dataset.allRows);

    const payload: TestmoDatasetDetailPayload = {
      id: dataset.id,
      name: dataset.name,
      rowCount: dataset.rowCount,
      sampleRowCount: dataset.sampleRowCount,
      truncated: dataset.truncated,
      schema: schemaValue,
      sampleRows: sampleRowsValue,
      allRows: allRowsArray.length > 0 ? allRowsArray : undefined,
    };

    return NextResponse.json({ dataset: payload });
  } catch (error) {
    console.error("Failed to fetch dataset detail", error);
    return NextResponse.json(
      { error: "Failed to fetch dataset detail" },
      { status: 500 }
    );
  }
}
