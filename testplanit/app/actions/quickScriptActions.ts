"use server";

import { format } from "date-fns";
import { prisma } from "~/lib/prisma";
import { resolveSharedSteps } from "~/lib/utils/resolveSharedSteps";
import { getServerAuthSession } from "~/server/auth";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

export interface QuickScriptCaseData {
  name: string;
  id: number;
  folder: string;
  state: string;
  estimate: number | null;
  automated: boolean;
  tags: string;
  createdBy: string;
  createdAt: string;
  steps: Array<{
    order: number;
    step: string;
    expectedResult: string;
  }>;
  fields: Record<string, string>;
}

export async function fetchCasesForQuickScript(args: {
  caseIds: number[];
  projectId: number;
}): Promise<
  | { success: true; data: QuickScriptCaseData[] }
  | { success: false; error: string; data: [] }
> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized", data: [] };
  }

  try {
    const cases = (await prisma.repositoryCases.findMany({
      where: {
        id: { in: args.caseIds },
        projectId: args.projectId,
        isDeleted: false,
      },
      include: {
        folder: true,
        state: true,
        creator: true,
        tags: { where: { isDeleted: false } },
        steps: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
          select: {
            id: true,
            step: true,
            expectedResult: true,
            order: true,
            isDeleted: true,
            sharedStepGroupId: true,
          },
        },
        caseFieldValues: {
          include: {
            field: {
              include: {
                type: true,
                fieldOptions: {
                  include: {
                    fieldOption: true,
                  },
                },
              },
            },
          },
        },
      },
    })) as any[];

    // Resolve shared step references (expand placeholders into actual step items)
    const resolvedCases = await resolveSharedSteps(cases);

    const data: QuickScriptCaseData[] = resolvedCases.map((c: any) => {
      const fields: Record<string, string> = {};

      for (const cfv of c.caseFieldValues || []) {
        const fieldType = cfv.field?.type?.type;
        const systemName = cfv.field?.systemName;
        if (!systemName) continue;

        let displayValue = "";

        if (cfv.value === null || cfv.value === undefined) {
          displayValue = "";
        } else if (fieldType === "Dropdown" || fieldType === "Multi Select") {
          const optionMap = new Map<number, string>(
            (cfv.field.fieldOptions || []).map((fo: any) => [
              fo.fieldOption.id,
              fo.fieldOption.name,
            ])
          );
          if (Array.isArray(cfv.value)) {
            displayValue = (cfv.value as number[])
              .map((id: number) => optionMap.get(id) || String(id))
              .join(", ");
          } else {
            displayValue =
              optionMap.get(cfv.value as number) || String(cfv.value);
          }
        } else if (
          fieldType === "Step Editor" ||
          fieldType === "Text Long" ||
          fieldType === "Text"
        ) {
          displayValue = extractTextFromNode(cfv.value);
        } else if (fieldType === "Checkbox") {
          displayValue = cfv.value ? "Yes" : "No";
        } else if (fieldType === "Date") {
          try {
            displayValue = format(
              new Date(cfv.value as string),
              "yyyy-MM-dd"
            );
          } catch {
            displayValue = String(cfv.value);
          }
        } else {
          displayValue = String(cfv.value);
        }

        fields[systemName] = displayValue;
      }

      return {
        name: c.name,
        id: c.id,
        folder: c.folder?.name || "",
        state: c.state?.name || "",
        estimate: c.estimate,
        automated: c.automated,
        tags: (c.tags || []).map((t: any) => t.name).join(", "),
        createdBy: c.creator?.name || c.creator?.email || "",
        createdAt: format(c.createdAt, "yyyy-MM-dd"),
        steps: (c.steps || []).map((s: any) => ({
          order: s.order + 1,
          step: extractTextFromNode(s.step),
          expectedResult: extractTextFromNode(s.expectedResult),
        })),
        fields,
      };
    });

    return { success: true, data };
  } catch (error) {
    console.error("Failed to fetch cases for QuickScript:", error);
    return { success: false, error: "Failed to fetch cases", data: [] };
  }
}
