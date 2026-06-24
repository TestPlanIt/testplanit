import {
  ParameterType,
  RepositoryCaseSource,
  WorkflowScope,
} from "~/zenstack/models";
import { z } from "zod/v4";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { resolveCreateStateRemap } from "~/lib/services/reviewGate";
import { emptyEditorContent } from "~/app/constants/backend";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";

const StepSchema = z.object({
  step: z.any(),
  expectedResult: z.any(),
  sharedStepGroupId: z.number().optional(),
});

const AttachmentInputSchema = z.object({
  url: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  note: z.string().optional(),
});

const VersionFieldValueSchema = z.object({
  field: z.string(),
  value: z.any(),
});

const VersionIssueSchema = z.object({
  id: z.number(),
  name: z.string(),
  externalId: z.string().nullable(),
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

// AddCase inline parameters/dataset (PARAM-AddCase). Both optional; datasetRows
// requires parameters (the dataset columns are the parameter names). Validated
// at the boundary so the modal can author a fully parameterized case in a
// single round-trip instead of "create case → open Configure Parameters sheet
// → save params → save dataset".
const InlineParameterSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(ParameterType),
  required: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  description: z.string().optional(),
  allowedValuesJson: z.any().optional(),
});

const InlineDatasetRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  label: z.string().optional(),
  values: z.record(z.string(), z.any()),
});

const TestCaseInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(StepSchema).optional(),
  fieldValues: z.record(z.string(), z.any()),
  automated: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  sourceUrl: z.string().optional(),
  // Modal-add inputs (pre-resolved IDs / metadata; optional)
  estimate: z.number().optional(),
  tagIds: z.array(z.number()).optional(),
  issueIds: z.array(z.number()).optional(),
  attachments: z.array(AttachmentInputSchema).optional(),
  fieldValuesById: z.record(z.string(), z.any()).optional(),
  versionFieldValues: z.array(VersionFieldValueSchema).optional(),
  versionTags: z.array(z.string()).optional(),
  versionIssues: z.array(VersionIssueSchema).optional(),
  parameters: z.array(InlineParameterSchema).optional(),
  datasetRows: z.array(InlineDatasetRowSchema).optional(),
});

export const ImportInputSchema = z.object({
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
  source: z.enum(RepositoryCaseSource).optional(),
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

export type ImportInput = z.infer<typeof ImportInputSchema>;

/**
 * Per-input-case outcome, keyed by the caller-assigned `id` on each
 * `TestCaseInputSchema` entry. Additive output: existing callers (the import
 * wizard, the Jira panel) ignore it; the bulk-create route consumes it to
 * report partial-failure status per case without re-deriving it from the
 * name-keyed `errors` array.
 */
export interface ImportCaseResult {
  id: string;
  name: string;
  status: "success" | "error";
  /** Present on success — the created (or restored) RepositoryCases id. */
  caseId?: number;
  /** Present on error — the failure message for this single case. */
  error?: string;
}

export interface ImportResult {
  status: "success" | "error";
  message?: string;
  importedCount: number;
  importedIds: number[];
  errors: string[];
  results: ImportCaseResult[];
}

/** Author identity for the imported cases (caller-resolved, not session-bound). */
export interface ImportAuthor {
  userId: string;
  userName: string;
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

/**
 * Persist a batch of generated test cases (and, optionally, link them to an
 * external issue) on behalf of `author`. This is the shared core behind both
 * the session-bound `importGeneratedTestCases` server action and the
 * Forge-API-key-authenticated Jira panel endpoint — the only difference
 * between the two callers is how the author identity is resolved.
 */
export async function persistGeneratedTestCases(
  input: ImportInput,
  author: ImportAuthor
): Promise<ImportResult> {
  const parseResult = ImportInputSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      status: "error",
      message: "Invalid input data",
      importedCount: 0,
      importedIds: [],
      errors: parseResult.error.issues.map((i) => i.message),
      results: [],
    };
  }

  const data = parseResult.data;
  const userId = author.userId;
  const userName = author.userName;
  const errors: string[] = [];
  const importedIds: number[] = [];
  const results: ImportCaseResult[] = [];
  let importedCount = 0;

  try {
    // Build a field mapping lookup for quick access
    const fieldMappingsByName = new Map(
      data.fieldMappings.map((fm) => [fm.fieldName, fm])
    );

    await auditedTransaction(async (tx) => {
      // Upsert issue once if needed
      let sharedIssue: {
        id: number;
        name: string;
        externalId: string | null;
      } | null = null;
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
          folderName =
            folderName
              .replace(/[<>:"/\\|?*]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 100) || "Page";

          // Find existing folder (active or soft-deleted) and reuse/restore it,
          // or create a new one if none exists.
          const existingActive = await tx.repositoryFolders.findUnique({
            where: {
              projectId_repositoryId_parentId_name_isDeleted: {
                projectId: data.projectId,
                repositoryId: data.repositoryId,
                parentId: data.folderId,
                name: folderName,
                isDeleted: false,
              },
            },
            select: { id: true },
          });

          let folder: { id: number };
          if (existingActive) {
            folder = existingActive;
          } else {
            // Check for a soft-deleted folder with the same name and restore it
            const existingDeleted = await tx.repositoryFolders.findUnique({
              where: {
                projectId_repositoryId_parentId_name_isDeleted: {
                  projectId: data.projectId,
                  repositoryId: data.repositoryId,
                  parentId: data.folderId,
                  name: folderName,
                  isDeleted: true,
                },
              },
              select: { id: true },
            });

            if (existingDeleted) {
              // Restore the soft-deleted folder
              folder = await tx.repositoryFolders.update({
                where: { id: existingDeleted.id },
                data: { isDeleted: false, order: folderOrder++ },
                select: { id: true },
              });
            } else {
              // Create a new folder
              folder = await tx.repositoryFolders.create({
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
            }
          }
          folderIdBySourceUrl.set(url, folder.id);
        }
      }

      // Strict-transitive gate: if the caller picked a state at or past
      // the first gated state in this project's CASES scope, remap to the
      // default state. The schema gate only fires on `update`, so without
      // this remap a server-action create could birth a case beyond a
      // gate without any approval.
      const effectiveStateId =
        (await resolveCreateStateRemap(
          tx,
          data.projectId,
          WorkflowScope.CASES,
          data.stateId
        )) ?? data.stateId;
      let effectiveStateName = data.stateName;
      if (effectiveStateId !== data.stateId) {
        const remapped = await tx.workflows.findUnique({
          where: { id: effectiveStateId },
          select: { name: true },
        });
        effectiveStateName = remapped?.name ?? data.stateName;
      }

      for (const testCase of data.testCases) {
        try {
          const calculatedOrder = data.maxOrder + importedCount + 1;
          // Use subfolder if one was created for this page, otherwise use the target folder
          const targetFolderId = testCase.sourceUrl
            ? (folderIdBySourceUrl.get(testCase.sourceUrl) ?? data.folderId)
            : data.folderId;

          // Resolve tag connects: prefer explicit IDs, fall back to autoGenerateTags map
          const tagConnects = testCase.tagIds?.length
            ? testCase.tagIds.map((id) => ({ id }))
            : data.autoGenerateTags && testCase.tags?.length
              ? testCase.tags
                  .map((t) => tagMap.get(t.trim()))
                  .filter((id): id is number => id != null)
                  .map((id) => ({ id }))
              : [];

          // Resolve issue connects: prefer explicit IDs, fall back to sharedIssue
          const issueConnects = testCase.issueIds?.length
            ? testCase.issueIds.map((id) => ({ id }))
            : sharedIssue
              ? [{ id: sharedIssue.id }]
              : [];

          // 1. Create-or-restore the repository case. A prior soft-
          // deleted case at the same (projectId, name, className,
          // source) tuple — including `className: null`, which Postgres
          // treats as distinct so the @@unique constraint doesn't fire
          // — gets resurrected with the fresh payload instead of
          // 23505ing. We can't use Prisma's compound-unique upsert here
          // because the generated type rejects null for nullable
          // members (`className: string`, not `string | null`), so the
          // find-then-branch pattern is the typesafe path.
          const caseName = testCase.name.slice(0, 255);
          const caseSource = data.source ?? RepositoryCaseSource.API;
          const caseFields = {
            repositoryId: data.repositoryId,
            folderId: targetFolderId,
            templateId: data.templateId,
            stateId: effectiveStateId,
            order: calculatedOrder,
            creatorId: userId,
            automated: testCase.automated ?? false,
            estimate: testCase.estimate,
            currentVersion: 1,
          };
          const softDeletedExisting = await tx.repositoryCases.findFirst({
            where: {
              projectId: data.projectId,
              name: caseName,
              className: null,
              source: caseSource,
              isDeleted: true,
            },
            select: { id: true },
          });
          const newCase = softDeletedExisting
            ? await tx.repositoryCases.update({
                where: { id: softDeletedExisting.id },
                data: { ...caseFields, isDeleted: false },
                select: { id: true },
              })
            : await tx.repositoryCases.create({
                data: {
                  projectId: data.projectId,
                  name: caseName,
                  source: caseSource,
                  ...caseFields,
                },
                select: { id: true },
              });

          // Link tags/issues through the explicit join models. The implicit
          // m2m `connect` syntax was replaced by RepositoryCaseTag /
          // RepositoryCaseIssue rows; `skipDuplicates` keeps the additive
          // semantics of `connect` when restoring a soft-deleted case that
          // already carried some of these links.
          if (issueConnects.length) {
            await tx.repositoryCaseIssue.createMany({
              data: issueConnects.map(({ id }) => ({
                caseId: newCase.id,
                issueId: id,
              })),
              skipDuplicates: true,
            });
          }
          if (tagConnects.length) {
            await tx.repositoryCaseTag.createMany({
              data: tagConnects.map(({ id }) => ({
                caseId: newCase.id,
                tagId: id,
              })),
              skipDuplicates: true,
            });
          }

          // 2. Create attachments (must exist before version snapshot embeds them)
          let attachmentsForVersion: Array<{
            id: number;
            testCaseId: number;
            url: string;
            name: string;
            note: string;
            isDeleted: boolean;
            mimeType: string;
            size: string;
            createdAt: string;
            createdById: string;
          }> = [];
          if (testCase.attachments?.length) {
            const createdAttachments = await Promise.all(
              testCase.attachments.map((a) =>
                tx.attachments.create({
                  data: {
                    testCaseId: newCase.id,
                    url: a.url,
                    name: a.name,
                    note: a.note ?? "",
                    mimeType: a.mimeType,
                    size: BigInt(a.size),
                    createdById: userId,
                  },
                  select: {
                    id: true,
                    url: true,
                    name: true,
                    note: true,
                    mimeType: true,
                    size: true,
                    createdAt: true,
                    createdById: true,
                  },
                })
              )
            );
            attachmentsForVersion = createdAttachments.map((a) => ({
              id: a.id,
              testCaseId: newCase.id,
              url: a.url,
              name: a.name,
              note: a.note ?? "",
              isDeleted: false,
              mimeType: a.mimeType,
              size: a.size.toString(),
              createdAt: a.createdAt.toISOString(),
              createdById: a.createdById,
            }));
          }

          // 3. Prepare version data
          const resolvedStepsForVersion =
            testCase.steps?.map((step) => ({
              step: convertStepToTipTapForVersion(step.step),
              expectedResult: convertStepToTipTapForVersion(
                step.expectedResult
              ),
            })) || [];

          const issuesDataForVersion = testCase.versionIssues?.length
            ? testCase.versionIssues
            : sharedIssue
              ? [
                  {
                    id: sharedIssue.id,
                    name: sharedIssue.name,
                    externalId: sharedIssue.externalId,
                  },
                ]
              : [];

          const tagNamesForVersion = testCase.versionTags?.length
            ? testCase.versionTags
            : data.autoGenerateTags && testCase.tags
              ? testCase.tags
              : [];

          // 4. Create version
          const newVersion = await tx.repositoryCaseVersions.create({
            data: {
              repositoryCaseId: newCase.id,
              staticProjectId: data.projectId,
              staticProjectName: data.projectName,
              projectId: data.projectId,
              repositoryId: data.repositoryId,
              folderId: targetFolderId,
              folderName: data.folderName,
              templateId: data.templateId,
              templateName: data.templateName,
              name: testCase.name.slice(0, 255),
              stateId: effectiveStateId,
              stateName: effectiveStateName,
              estimate: testCase.estimate ?? 0,
              order: calculatedOrder,
              creatorId: userId,
              creatorName: userName,
              automated: testCase.automated ?? false,
              isArchived: false,
              isDeleted: false,
              version: 1,
              steps: resolvedStepsForVersion,
              attachments: attachmentsForVersion,
              tags: tagNamesForVersion,
              issues: issuesDataForVersion,
            },
            select: { id: true },
          });

          // 5. Batch create field values and version values
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

          if (testCase.fieldValuesById) {
            // ID-keyed path (modal-add) — values pre-processed by caller
            for (const [fieldIdStr, fieldValue] of Object.entries(
              testCase.fieldValuesById
            )) {
              const fieldId = parseInt(fieldIdStr, 10);
              if (Number.isNaN(fieldId) || fieldValue == null) continue;
              fieldValueData.push({
                testCaseId: newCase.id,
                fieldId,
                value: fieldValue,
              });
            }
          } else {
            // Name-keyed path (wizard import) — resolve via fieldMappings
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
          }

          // Version field values: prefer explicit list (modal-add) over wizard auto-derived
          if (testCase.versionFieldValues?.length) {
            for (const vfv of testCase.versionFieldValues) {
              if (vfv.value == null) continue;
              fieldVersionValueData.push({
                versionId: newVersion.id,
                field: vfv.field,
                value: vfv.value,
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

          // 6. Batch create steps
          if (testCase.steps && testCase.steps.length > 0) {
            const stepData = testCase.steps.map((step, stepIndex) => ({
              testCaseId: newCase.id,
              step: convertStepToTipTap(step.step),
              expectedResult: convertStepToTipTap(step.expectedResult),
              order: stepIndex,
              sharedStepGroupId: step.sharedStepGroupId ?? null,
            }));
            await tx.steps.createMany({ data: stepData });
          }

          // 7. Inline parameters + dataset (AddCase modal path; PARAM-AddCase)
          if (testCase.parameters?.length) {
            const seen = new Set<string>();
            for (const p of testCase.parameters) {
              if (seen.has(p.name)) {
                throw new Error(
                  `Duplicate parameter name "${p.name}" on "${testCase.name}"`
                );
              }
              seen.add(p.name);
            }
            await tx.testCaseParameter.createMany({
              data: testCase.parameters.map((p, order) => {
                const base = {
                  testCaseId: newCase.id,
                  name: p.name,
                  type: p.type,
                  required: p.required ?? false,
                  sensitive: p.sensitive ?? false,
                  description: p.description ?? null,
                  order,
                };
                // v3 rejects raw `null` for the nullable Json column, and the
                // model @@validate checks `allowedValuesJson == null` (a DbNull
                // sentinel isn't `== null`), so omit it when absent.
                return p.allowedValuesJson != null
                  ? { ...base, allowedValuesJson: p.allowedValuesJson }
                  : base;
              }),
            });
            await tx.repositoryCases.update({
              where: { id: newCase.id },
              data: { hasParameters: true },
            });

            if (testCase.datasetRows?.length) {
              const sortedRows = [...testCase.datasetRows].sort(
                (a, b) => a.rowIndex - b.rowIndex
              );
              const dataset = await tx.dataSet.create({
                data: {
                  projectId: data.projectId,
                  ownerCaseId: newCase.id,
                  name: `${testCase.name} dataset`.slice(0, 255),
                  isShared: false,
                  createdById: userId,
                },
                select: { id: true },
              });
              await tx.dataSetVersion.create({
                data: {
                  dataSetId: dataset.id,
                  version: 1,
                  parametersJson: testCase.parameters.map((p) => ({
                    name: p.name,
                    type: p.type,
                    required: p.required ?? false,
                    sensitive: p.sensitive ?? false,
                  })),
                  rowsJson: sortedRows.map((r) => ({
                    rowIndex: r.rowIndex,
                    label: r.label ?? null,
                    values: r.values,
                  })),
                  rowCount: sortedRows.length,
                  createdById: userId,
                },
              });
              await tx.dataSetRow.createMany({
                data: sortedRows.map((r) => ({
                  dataSetId: dataset.id,
                  rowIndex: r.rowIndex,
                  label: r.label ?? null,
                  valuesJson: r.values,
                })),
              });
            }
          } else if (testCase.datasetRows?.length) {
            throw new Error(
              `"${testCase.name}" sent datasetRows without parameters — dataset columns require a parameter schema`
            );
          }

          importedIds.push(newCase.id);
          importedCount++;
          results.push({
            id: testCase.id,
            name: testCase.name,
            status: "success",
            caseId: newCase.id,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to import "${testCase.name}": ${msg}`);
          results.push({
            id: testCase.id,
            name: testCase.name,
            status: "error",
            error: msg,
          });
        }
      }
    });

    return {
      status: "success",
      importedCount,
      importedIds,
      errors,
      results,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      message: `Import failed: ${msg}`,
      importedCount,
      importedIds,
      errors,
      results,
    };
  }
}
