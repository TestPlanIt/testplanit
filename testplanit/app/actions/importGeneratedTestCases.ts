"use server";

import { RepositoryCaseSource } from "@prisma/client";
import { z } from "zod/v4";
import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { emptyEditorContent } from "~/app/constants/backend";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";

const StepSchema = z.object({
  step: z.any(),
  expectedResult: z.any(),
});

const FieldMappingSchema = z.object({
  fieldName: z.string(),
  caseFieldId: z.number(),
  fieldType: z.string(),
  fieldOptions: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
      })
    )
    .optional(),
});

const TestCaseInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(StepSchema).optional(),
  fieldValues: z.record(z.string(), z.any()),
  automated: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  sourceUrl: z.string().optional(),
});

const ImportInputSchema = z.object({
  projectId: z.number(),
  projectName: z.string(),
  repositoryId: z.number(),
  folderId: z.number(),
  folderName: z.string(),
  templateId: z.number(),
  templateName: z.string(),
  stateId: z.number(),
  stateName: z.string(),
  maxOrder: z.number(),
  autoGenerateTags: z.boolean(),
  testCases: z.array(TestCaseInputSchema),
  fieldMappings: z.array(FieldMappingSchema),
  // Issue linking (optional)
  issue: z
    .object({
      externalId: z.string(),
      integrationId: z.number(),
      issueKey: z.string(),
      title: z.string(),
      description: z.string().optional(),
      externalUrl: z.string().optional(),
    })
    .optional(),
});

type ImportInput = z.infer<typeof ImportInputSchema>;

interface ImportResult {
  status: "success" | "error";
  message?: string;
  importedCount: number;
  errors: string[];
}

function processFieldValue(
  fieldType: string,
  fieldValue: any,
  fieldOptions?: { id: number; name: string }[]
): any {
  switch (fieldType) {
    case "Text Long":
      if (typeof fieldValue === "string") {
        return JSON.stringify(ensureTipTapJSON(fieldValue));
      }
      return JSON.stringify(fieldValue);

    case "Dropdown":
    case "Multi-Select":
      if (Array.isArray(fieldValue)) {
        return fieldValue.map((optionName: any) => {
          const option = fieldOptions?.find((fo) => fo.name === optionName);
          return option ? option.id : optionName;
        });
      } else if (typeof fieldValue === "string") {
        const option = fieldOptions?.find((fo) => fo.name === fieldValue);
        return option ? option.id : fieldValue;
      }
      return fieldValue;

    case "Checkbox":
      return Boolean(fieldValue);

    case "Integer":
      return parseInt(fieldValue as string) || 0;

    case "Number":
      return parseFloat(fieldValue as string) || 0;

    default:
      return fieldValue;
  }
}

function convertStepToTipTap(value: any) {
  if (typeof value === "string") {
    return ensureTipTapJSON(value);
  }
  return value || emptyEditorContent;
}

function convertStepToTipTapForVersion(value: any) {
  if (typeof value === "string") {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: value }],
        },
      ],
    };
  }
  return value || emptyEditorContent;
}

export async function importGeneratedTestCases(
  input: ImportInput
): Promise<ImportResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return {
      status: "error",
      message: "User not authenticated",
      importedCount: 0,
      errors: [],
    };
  }

  const parseResult = ImportInputSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      status: "error",
      message: "Invalid input data",
      importedCount: 0,
      errors: parseResult.error.issues.map((i) => i.message),
    };
  }

  const data = parseResult.data;
  const userId = session.user.id;
  const userName = session.user.name || "Unknown User";
  const errors: string[] = [];
  let importedCount = 0;

  try {
    // Build a field mapping lookup for quick access
    const fieldMappingsByName = new Map(
      data.fieldMappings.map((fm) => [fm.fieldName, fm])
    );

    await prisma.$transaction(
      async (tx) => {
        // Upsert issue once if needed
        let sharedIssue: { id: number; name: string; externalId: string | null } | null =
          null;
        if (data.issue) {
          sharedIssue = await tx.issue.upsert({
            where: {
              externalId_integrationId: {
                externalId: data.issue.externalId,
                integrationId: data.issue.integrationId,
              },
            },
            create: {
              name: data.issue.issueKey,
              title: data.issue.title,
              description: data.issue.description || "",
              externalKey: data.issue.issueKey,
              externalId: data.issue.externalId,
              externalUrl: data.issue.externalUrl,
              projectId: data.projectId,
              integrationId: data.issue.integrationId,
              createdById: userId,
            },
            update: {
              title: data.issue.title,
              externalKey: data.issue.issueKey,
              externalUrl: data.issue.externalUrl,
            },
            select: { id: true, name: true, externalId: true },
          });
        }

        // Upsert all unique tags upfront if autoGenerateTags is enabled
        const tagMap = new Map<string, number>();
        if (data.autoGenerateTags) {
          const allTagNames = new Set<string>();
          for (const tc of data.testCases) {
            if (tc.tags) {
              for (const t of tc.tags) {
                allTagNames.add(t.trim());
              }
            }
          }
          for (const tagName of allTagNames) {
            const tag = await tx.tags.upsert({
              where: { name: tagName },
              create: { name: tagName, isDeleted: false },
              update: {},
              select: { id: true },
            });
            tagMap.set(tagName, tag.id);
          }
        }

        // For URL-generated cases with multiple source pages, create subfolders
        const sourceUrls = new Set(
          data.testCases
            .map((tc) => tc.sourceUrl)
            .filter((url): url is string => !!url)
        );
        const folderIdBySourceUrl = new Map<string, number>();

        if (sourceUrls.size > 1) {
          // Multiple pages — create a subfolder per page
          let folderOrder = 0;
          for (const url of sourceUrls) {
            // Derive folder name from URL: use path or hostname
            let folderName: string;
            try {
              const parsed = new URL(url);
              const pathPart = parsed.pathname === "/" ? "" : parsed.pathname;
              folderName = pathPart
                ? pathPart
                    .replace(/^\//, "")
                    .replace(/\/$/, "")
                    .replace(/\//g, " - ")
                : parsed.hostname;
            } catch {
              folderName = url.slice(0, 100);
            }
            // Sanitize: remove special chars, limit length
            folderName = folderName
              .replace(/[<>:"/\\|?*]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 100) || "Page";

            const folder = await tx.repositoryFolders.create({
              data: {
                name: folderName,
                projectId: data.projectId,
                repositoryId: data.repositoryId,
                parentId: data.folderId,
                creatorId: userId,
                order: folderOrder++,
              },
              select: { id: true },
            });
            folderIdBySourceUrl.set(url, folder.id);
          }
        }

        for (const testCase of data.testCases) {
          try {
            const calculatedOrder = data.maxOrder + importedCount + 1;
            // Use subfolder if one was created for this page, otherwise use the target folder
            const targetFolderId = testCase.sourceUrl
              ? folderIdBySourceUrl.get(testCase.sourceUrl) ?? data.folderId
              : data.folderId;

            // 1. Create the repository case
            const newCase = await tx.repositoryCases.create({
              data: {
                projectId: data.projectId,
                repositoryId: data.repositoryId,
                folderId: targetFolderId,
                templateId: data.templateId,
                name: testCase.name.slice(0, 255),
                source: RepositoryCaseSource.API,
                stateId: data.stateId,
                order: calculatedOrder,
                creatorId: userId,
                automated: false,
                currentVersion: 1,
                // Connect issue if available
                ...(sharedIssue
                  ? { issues: { connect: [{ id: sharedIssue.id }] } }
                  : {}),
                // Connect tags if available
                ...(data.autoGenerateTags && testCase.tags?.length
                  ? {
                      tags: {
                        connect: testCase.tags
                          .map((t) => tagMap.get(t.trim()))
                          .filter((id): id is number => id != null)
                          .map((id) => ({ id })),
                      },
                    }
                  : {}),
              },
              select: { id: true },
            });

            // 2. Prepare version data
            const resolvedStepsForVersion =
              testCase.steps?.map((step) => ({
                step: convertStepToTipTapForVersion(step.step),
                expectedResult: convertStepToTipTapForVersion(
                  step.expectedResult
                ),
              })) || [];

            const issuesDataForVersion = sharedIssue
              ? [
                  {
                    id: sharedIssue.id,
                    name: sharedIssue.name,
                    externalId: sharedIssue.externalId,
                  },
                ]
              : [];

            const tagNamesForVersion =
              data.autoGenerateTags && testCase.tags ? testCase.tags : [];

            // 3. Create version
            const newVersion = await tx.repositoryCaseVersions.create({
              data: {
                repositoryCaseId: newCase.id,
                staticProjectId: data.projectId,
                staticProjectName: data.projectName,
                projectId: data.projectId,
                repositoryId: data.repositoryId,
                folderId: data.folderId,
                folderName: data.folderName,
                templateId: data.templateId,
                templateName: data.templateName,
                name: testCase.name.slice(0, 255),
                stateId: data.stateId,
                stateName: data.stateName,
                estimate: 0,
                order: calculatedOrder,
                creatorId: userId,
                creatorName: userName,
                automated: false,
                isArchived: false,
                isDeleted: false,
                version: 1,
                steps: resolvedStepsForVersion,
                attachments: [],
                tags: tagNamesForVersion,
                issues: issuesDataForVersion,
              },
              select: { id: true },
            });

            // 4. Batch create field values and version values
            const fieldValueData: {
              testCaseId: number;
              fieldId: number;
              value: any;
            }[] = [];
            const fieldVersionValueData: {
              versionId: number;
              field: string;
              value: any;
            }[] = [];

            for (const [fieldName, fieldValue] of Object.entries(
              testCase.fieldValues
            )) {
              if (
                fieldName === "Steps" ||
                fieldName.toLowerCase().includes("steps")
              ) {
                continue;
              }

              const mapping = fieldMappingsByName.get(fieldName);
              if (mapping && fieldValue != null) {
                const processedValue = processFieldValue(
                  mapping.fieldType,
                  fieldValue,
                  mapping.fieldOptions
                );
                fieldValueData.push({
                  testCaseId: newCase.id,
                  fieldId: mapping.caseFieldId,
                  value: processedValue,
                });
                fieldVersionValueData.push({
                  versionId: newVersion.id,
                  field: fieldName,
                  value: processedValue,
                });
              }
            }

            if (fieldValueData.length > 0) {
              await tx.caseFieldValues.createMany({ data: fieldValueData });
            }
            if (fieldVersionValueData.length > 0) {
              await tx.caseFieldVersionValues.createMany({
                data: fieldVersionValueData,
              });
            }

            // 5. Batch create steps
            if (testCase.steps && testCase.steps.length > 0) {
              const stepData = testCase.steps.map((step, stepIndex) => ({
                testCaseId: newCase.id,
                step: convertStepToTipTap(step.step),
                expectedResult: convertStepToTipTap(step.expectedResult),
                order: stepIndex,
              }));
              await tx.steps.createMany({ data: stepData });
            }

            importedCount++;
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : String(error);
            errors.push(`Failed to import "${testCase.name}": ${msg}`);
          }
        }
      },
      { timeout: 60000 }
    );

    return {
      status: "success",
      importedCount,
      errors,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      message: `Import failed: ${msg}`,
      importedCount,
      errors,
    };
  }
}
