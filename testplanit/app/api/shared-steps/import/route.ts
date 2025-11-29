import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { enhance } from "@zenstackhq/runtime";
import { db } from "~/server/db";
import { prisma } from "~/lib/prisma";
import Papa from "papaparse";
import { emptyEditorContent } from "~/app/constants/backend";
import {
  convertTextToTipTapJSON,
  ensureTipTapJSON,
} from "~/utils/tiptapConversion";
import { syncSharedStepToElasticsearch } from "~/services/sharedStepSearch";

// Helper function to safely parse JSON
const safeJsonParse = (jsonString: any, defaultValue: any = null): any => {
  if (typeof jsonString !== "string") return jsonString;
  try {
    if (jsonString.trim() === "") return defaultValue;
    return JSON.parse(jsonString);
  } catch (e) {
    return jsonString; // Return original string if parsing fails
  }
};

// Helper function to extract text from TipTap JSON
const extractTextFromTipTap = (jsonContent: any): string => {
  if (!jsonContent) return "";

  if (typeof jsonContent === "string") {
    // Try to parse as JSON first
    const parsed = safeJsonParse(jsonContent);
    if (typeof parsed === "string") return parsed;
    jsonContent = parsed;
  }

  if (jsonContent.text && typeof jsonContent.text === "string") {
    return jsonContent.text;
  }

  if (jsonContent.content && Array.isArray(jsonContent.content)) {
    return jsonContent.content.map(extractTextFromTipTap).join("");
  }

  return "";
};

// Parse combined step data (single row mode with all steps in one field)
const parseCombinedStepData = (
  combinedData: string,
  rowMode: string
): Array<{ step: string; expectedResult?: string; order: number }> => {
  if (!combinedData || combinedData.trim() === "") return [];

  try {
    // Try to parse as JSON first (export format)
    const parsed = safeJsonParse(combinedData);
    if (Array.isArray(parsed)) {
      return parsed.map((item, index) => ({
        step:
          typeof item.step === "string"
            ? item.step
            : extractTextFromTipTap(item.step),
        expectedResult: item.expectedResult
          ? typeof item.expectedResult === "string"
            ? item.expectedResult
            : extractTextFromTipTap(item.expectedResult)
          : undefined,
        order: item.stepNumber || index,
      }));
    }
  } catch (e) {
    // Fall back to plain text parsing
  }

  // Parse plain text format
  const steps: Array<{ step: string; expectedResult?: string; order: number }> =
    [];
  const sections = combinedData
    .split("---")
    .map((s) => s.trim())
    .filter((s) => s);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const stepMatch = section.match(
      /Step \d+:\s*(.*?)(?=Expected Result \d+:|$)/s
    );
    const expectedMatch = section.match(/Expected Result \d+:\s*(.*?)$/s);

    if (stepMatch) {
      steps.push({
        step: stepMatch[1].trim(),
        expectedResult: expectedMatch ? expectedMatch[1].trim() : undefined,
        order: i,
      });
    }
  }

  return steps;
};

interface FieldMapping {
  csvColumn: string;
  templateField: string;
}

interface ImportRequest {
  projectId: number;
  file: string;
  delimiter: string;
  hasHeaders: boolean;
  encoding: string;
  fieldMappings: FieldMapping[];
  rowMode: "single" | "multi";
}

interface ImportError {
  row: number;
  field: string;
  error: string;
}

interface ParsedSharedStep {
  groupName: string;
  step?: string;
  expectedResult?: string;
  order?: number;
  stepNumber?: number;
  stepContent?: string;
  expectedResultContent?: string;
  combinedStepData?: string;
  stepsData?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ImportRequest = await request.json();

    // Get full user object for enhance
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        role: {
          include: {
            rolePermissions: true,
          },
        },
      },
    });

    const enhancedDb = enhance(db, { user: user ?? undefined });

    // Validate project access
    const project = await enhancedDb.projects.findFirst({
      where: { id: body.projectId },
      include: {
        assignedUsers: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Parse CSV
    const parseResult = Papa.parse(body.file, {
      delimiter: body.delimiter,
      header: body.hasHeaders,
      skipEmptyLines: true,
    });

    if (parseResult.errors.length > 0) {
      return NextResponse.json(
        { error: "CSV parsing failed", details: parseResult.errors },
        { status: 400 }
      );
    }

    const rows = parseResult.data as any[];
    const errors: ImportError[] = [];
    const sharedStepsToImport: ParsedSharedStep[] = [];

    // Process each row
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const stepData: Partial<ParsedSharedStep> = {};

      // Map fields
      for (const mapping of body.fieldMappings) {
        const csvValue = body.hasHeaders
          ? row[mapping.csvColumn]
          : row[parseInt(mapping.csvColumn.replace(/\D/g, "")) - 1];

        if (mapping.templateField === "groupName") {
          stepData.groupName = csvValue || "";
        } else if (mapping.templateField === "step") {
          stepData.step = csvValue || "";
        } else if (mapping.templateField === "expectedResult") {
          stepData.expectedResult = csvValue || "";
        } else if (mapping.templateField === "order") {
          stepData.order = parseInt(csvValue) || 0;
        } else if (mapping.templateField === "stepNumber") {
          stepData.stepNumber = parseInt(csvValue) || 0;
        } else if (mapping.templateField === "stepContent") {
          stepData.stepContent = csvValue || "";
        } else if (mapping.templateField === "expectedResultContent") {
          stepData.expectedResultContent = csvValue || "";
        } else if (mapping.templateField === "combinedStepData") {
          stepData.combinedStepData = csvValue || "";
        } else if (mapping.templateField === "stepsData") {
          stepData.stepsData = csvValue || "";
        }
      }

      // Validate required fields
      if (!stepData.groupName || stepData.groupName.trim() === "") {
        errors.push({
          row: rowIndex + 1,
          field: "Group Name",
          error: "Group name is required",
        });
        continue;
      }

      // Validate based on row mode and available data
      const hasCombinedData = stepData.combinedStepData || stepData.stepsData;
      const hasMultiRowData = stepData.stepContent;
      const hasSingleFieldData = stepData.step;

      if (!hasCombinedData && !hasMultiRowData && !hasSingleFieldData) {
        errors.push({
          row: rowIndex + 1,
          field: "Step",
          error:
            "At least one step field is required (step, stepContent, combinedStepData, or stepsData)",
        });
        continue;
      }

      if (errors.length === 0) {
        sharedStepsToImport.push(stepData as ParsedSharedStep);
      }
    }

    // If there are errors, don't import anything
    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Validation failed", errors },
        { status: 400 }
      );
    }

    // Process shared steps based on their format and group them
    const stepGroups = new Map<
      string,
      Array<{ step: string; expectedResult?: string; order: number }>
    >();

    for (const stepData of sharedStepsToImport) {
      if (!stepGroups.has(stepData.groupName)) {
        stepGroups.set(stepData.groupName, []);
      }

      const currentSteps = stepGroups.get(stepData.groupName)!;

      // Handle different import formats
      if (stepData.combinedStepData || stepData.stepsData) {
        // Single row mode with combined data
        const combinedData =
          stepData.combinedStepData || stepData.stepsData || "";
        const parsedSteps = parseCombinedStepData(combinedData, body.rowMode);
        currentSteps.push(...parsedSteps);
      } else if (stepData.stepContent) {
        // Multi-row mode
        currentSteps.push({
          step: stepData.stepContent,
          expectedResult: stepData.expectedResultContent,
          order: stepData.stepNumber || currentSteps.length,
        });
      } else if (stepData.step) {
        // Simple single field mode
        currentSteps.push({
          step: stepData.step,
          expectedResult: stepData.expectedResult,
          order: stepData.order || currentSteps.length,
        });
      }
    }

    // Import shared step groups and items
    let importedCount = 0;

    for (const [groupName, steps] of stepGroups) {
      try {
        // Check if group already exists
        let sharedStepGroup = await enhancedDb.sharedStepGroup.findFirst({
          where: {
            name: groupName,
            projectId: body.projectId,
            isDeleted: false,
          },
        });

        // Create group if it doesn't exist
        if (!sharedStepGroup) {
          sharedStepGroup = await enhancedDb.sharedStepGroup.create({
            data: {
              name: groupName,
              projectId: body.projectId,
              createdById: session.user.id,
            },
          });
        }

        // Sort steps by their order if provided, otherwise maintain CSV order
        const sortedSteps = steps.sort((a, b) => {
          if (a.order !== undefined && b.order !== undefined) {
            return a.order - b.order;
          }
          return 0; // Maintain original order
        });

        // Create shared step items
        for (let index = 0; index < sortedSteps.length; index++) {
          const step = sortedSteps[index];

          // Convert step text to JSON format - handle both JSON and plain text
          let stepJson;
          try {
            const parsedStep = safeJsonParse(step.step);
            stepJson = ensureTipTapJSON(parsedStep);
          } catch (e) {
            stepJson = convertTextToTipTapJSON(step.step ?? "");
          }

          // Convert expected result to JSON format if provided
          let expectedResultJson: any = emptyEditorContent;
          if (step.expectedResult && step.expectedResult.trim() !== "") {
            try {
              // Try to parse as existing JSON first
              const parsedExpected = safeJsonParse(step.expectedResult);
              expectedResultJson = ensureTipTapJSON(parsedExpected);
            } catch (e) {
              // Fallback to plain text conversion
              expectedResultJson = convertTextToTipTapJSON(
                step.expectedResult || ""
              );
            }
          }

          await enhancedDb.sharedStepItem.create({
            data: {
              sharedStepGroupId: sharedStepGroup.id,
              order: step.order !== undefined ? step.order : index,
              step: stepJson,
              expectedResult: expectedResultJson,
            },
          });

          importedCount++;
        }

        // Manually sync to Elasticsearch since enhanced Prisma client bypasses extensions
        await syncSharedStepToElasticsearch(sharedStepGroup.id).catch(
          (error: any) => {
            console.error(
              `Failed to sync shared step group ${sharedStepGroup.id} to Elasticsearch:`,
              error
            );
          }
        );
      } catch (error: any) {
        // Log error but continue with other groups
        console.error(
          `Failed to import shared step group ${groupName}:`,
          error
        );
        errors.push({
          row: 0, // Group level error
          field: "Group",
          error: `Failed to import group "${groupName}": ${error.message}`,
        });
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Some shared steps failed to import", errors, importedCount },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, importedCount });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
