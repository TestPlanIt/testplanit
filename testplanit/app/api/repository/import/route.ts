import { RepositoryCaseSource, WorkflowScope } from "~/zenstack/models";
import type { CaseFields, CaseFieldTypes } from "~/zenstack/models";
import { DbNull, type JsonValue } from "@zenstackhq/orm";
import { enhanceWithAudit } from "~/lib/audit/enhanceWithAudit";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { auditBulkCreate } from "~/lib/services/auditLog";
import { DuplicateScanService } from "~/lib/services/duplicateScanService";
import { replaceImportedCaseIssueLinks } from "~/lib/services/importCaseIssueLinks";
import { resolveImportIssueKeys } from "~/lib/services/importIssueKeyResolution";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { resolveCreateStateRemap } from "~/lib/services/reviewGate";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { authOptions } from "~/server/auth";
import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";
import { parseStepsCell } from "~/lib/utils/parseExportedSteps";
import { aggregateMultiRowSteps } from "~/lib/utils/aggregateMultiRowSteps";

function parseTags(value: any): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    try {
      // Try to parse as JSON array
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((tag) => typeof tag === "string");
      }
    } catch {
      // Not JSON, treat as comma-separated
      return value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag);
    }
  }

  return [];
}

function parseAttachments(value: any): any[] {
  if (!value) return [];

  if (typeof value === "string") {
    try {
      // Try to parse as JSON array
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        // Filter and transform attachment data
        return parsed
          .map((att) => ({
            url: att.url,
            name: att.name || "Untitled",
            note: att.note || null,
            size: att.size ? BigInt(att.size) : BigInt(0),
            mimeType: att.mimeType || "application/octet-stream",
          }))
          .filter((att) => att.url); // Only keep attachments with URLs
      }
    } catch {
      // Not JSON, return empty array
      return [];
    }
  }

  return [];
}

function parseIssues(value: any): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    try {
      // Try to parse as JSON array
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        // If array of objects with name property, extract names. Trimmed like
        // the comma-separated branch below: both feed the same name lookup and
        // the same batch key resolution, which key on the trimmed form.
        return parsed
          .map((issue) => (typeof issue === "string" ? issue : issue.name))
          .filter((issue): issue is string => typeof issue === "string")
          .map((issue) => issue.trim())
          .filter(Boolean);
      }
    } catch {
      // Not JSON, treat as comma-separated issue names
      return value
        .split(",")
        .map((issue) => issue.trim())
        .filter((issue) => issue);
    }
  }

  return [];
}

function parseTestRuns(value: any): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    try {
      // Try to parse as JSON array
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        // Extract test run names from objects or use strings directly
        return parsed
          .map((run) => {
            if (typeof run === "string") return run;
            if (run.testRun?.name) return run.testRun.name;
            if (run.name) return run.name;
            return null;
          })
          .filter(Boolean);
      }
    } catch {
      // Not JSON, treat as comma-separated test run names
      return value
        .split(",")
        .map((run) => run.trim())
        .filter((run) => run);
    }
  }

  return [];
}

interface FieldMapping {
  csvColumn: string;
  templateField: string;
}

interface ImportRequest {
  projectId: number;
  file?: string;
  fileType?: "csv" | "markdown";
  delimiter: string;
  hasHeaders: boolean;
  encoding: string;
  templateId: number;
  importLocation: "single_folder" | "root_folder" | "top_level";
  folderId?: number;
  fieldMappings: FieldMapping[];
  folderSplitMode?: "plain" | "slash" | "dot" | "greater_than";
  rowMode: "single" | "multi";
  parsedData?: any[];
}

interface ImportError {
  row: number;
  field: string;
  error: string;
  // Case name for the offending row, when it resolved. The wizard shows it
  // alongside the row number so multi-row imports (where a row number means
  // "grouped case N", not "CSV line N") are still identifiable.
  caseName?: string;
}

export const POST = withAuditContext(async (request: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: ImportRequest = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (imported: number, total: number) => {
        const data = JSON.stringify({ imported, total });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const _sendComplete = (importedCount: number, errors: ImportError[]) => {
        const data = JSON.stringify({ complete: true, importedCount, errors });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        controller.close();
      };

      const sendError = (error: string, errors?: ImportError[]) => {
        const data = JSON.stringify({ error, errors });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        controller.close();
      };

      try {
        // Get full user object for enhance
        const user = await baseDb.user.findUnique({
          where: { id: session.user.id },
          include: {
            role: {
              include: {
                rolePermissions: true,
              },
            },
          },
        });

        const enhancedDb = await enhanceWithAudit(user ?? undefined);

        // Validate project access
        const project = await enhancedDb.projects.findFirst({
          where: { id: body.projectId },
          include: {
            assignedUsers: true,
          },
        });

        if (!project) {
          sendError("Project not found");
          return;
        }

        // Get repository
        const repository = await enhancedDb.repositories.findFirst({
          where: {
            projectId: body.projectId,
            isActive: true,
            isDeleted: false,
          },
        });

        if (!repository) {
          sendError("Repository not found");
          return;
        }

        // Get template with fields
        const template = await enhancedDb.templates.findUnique({
          where: { id: body.templateId },
          include: {
            caseFields: {
              include: {
                caseField: {
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
        });

        if (!template) {
          sendError("Template not found");
          return;
        }

        // Get default workflow
        const defaultWorkflow = await enhancedDb.workflows.findFirst({
          where: {
            isDeleted: false,
            isEnabled: true,
            scope: "CASES",
            isDefault: true,
            projects: {
              some: { projectId: body.projectId },
            },
          },
        });

        if (!defaultWorkflow) {
          sendError("No default workflow found");
          return;
        }

        // Parse input data
        let rows: any[];

        if (body.fileType === "markdown" && body.parsedData) {
          // For markdown, the frontend has already parsed the file
          rows = body.parsedData;
        } else {
          // CSV parsing
          if (!body.file) {
            sendError("No file content provided");
            return;
          }
          const parseResult = Papa.parse(body.file, {
            delimiter: body.delimiter,
            header: body.hasHeaders,
            skipEmptyLines: true,
          });

          if (parseResult.errors.length > 0) {
            sendError("CSV parsing failed");
            return;
          }

          rows = parseResult.data as any[];
        }

        if (body.rowMode === "multi") {
          rows = aggregateMultiRowSteps(rows, body.fieldMappings);
        }

        const errors: ImportError[] = [];
        // Advisory notes about rows that DID import. Kept apart from `errors`
        // so the wizard's "N rows could not be imported" count stays true —
        // an issue cell that found no ticket does not fail its case.
        const warnings: ImportError[] = [];
        const casesToImport: any[] = [];

        // A missing Name mapping fails every row identically, which drowns the
        // real problem in N copies of the same message. Say it once instead.
        const nameMapping = body.fieldMappings.find(
          (m) => m.templateField === "name"
        );
        if (!nameMapping) {
          sendError(
            "No column is mapped to Name. Go back to the column mapping step and map the column holding the test case name."
          );
          return;
        }

        // Process each row
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          // Errors raised while mapping this row's columns. Collected first so
          // the case name — which may be mapped after the failing column — can
          // be attached to all of them.
          const rowErrors: ImportError[] = [];
          const caseData: any = {
            name: "",
            projectId: body.projectId,
            repositoryId: repository.id,
            templateId: body.templateId,
            stateId: defaultWorkflow.id,
            source: RepositoryCaseSource.MANUAL,
            creatorId: session.user.id,
            automated: false,
            fieldValues: {},
          };

          // Map fields
          for (const mapping of body.fieldMappings) {
            const csvValue = body.hasHeaders
              ? row[mapping.csvColumn]
              : row[parseInt(mapping.csvColumn.replace(/\D/g, "")) - 1];

            if (mapping.templateField === "folder") {
              caseData.folderPath = csvValue;
            } else if (mapping.templateField === "estimate") {
              caseData.estimate = parseInt(csvValue) || null;
            } else if (mapping.templateField === "forecast") {
              caseData.forecastManual = parseInt(csvValue) || null;
            } else if (mapping.templateField === "automated") {
              caseData.automated =
                csvValue?.toLowerCase() === "true" ||
                csvValue === "1" ||
                csvValue?.toLowerCase() === "yes";
            } else if (mapping.templateField === "name") {
              caseData.name = csvValue || "";
            } else if (mapping.templateField === "tags") {
              caseData.tags = parseTags(csvValue);
            } else if (mapping.templateField === "attachments") {
              caseData.attachments = csvValue;
            } else if (mapping.templateField === "issues") {
              caseData.issues = csvValue;
            } else if (mapping.templateField === "linkedCases") {
              caseData.linkedCases = csvValue;
            } else if (mapping.templateField === "workflowState") {
              caseData.workflowStateName = csvValue;
            } else if (mapping.templateField === "createdAt") {
              caseData.createdAt = csvValue;
            } else if (mapping.templateField === "createdBy") {
              caseData.createdByName = csvValue;
            } else if (mapping.templateField === "version") {
              caseData.version = parseInt(csvValue) || 1;
            } else if (mapping.templateField === "testRuns") {
              caseData.testRuns = csvValue;
            } else if (mapping.templateField === "id") {
              caseData.id = parseInt(csvValue) || null;
            } else if (mapping.templateField === "steps") {
              const field = template.caseFields?.find(
                (cf: any) => cf.caseField.type.type === "Steps"
              ) as any;
              if (field) {
                try {
                  const validatedValue = validateFieldValue(
                    csvValue,
                    field.caseField,
                    rowIndex + 1
                  );
                  // Store steps separately for insertion into Steps table (not CaseFieldValues)
                  caseData.steps = validatedValue;
                } catch (error: any) {
                  rowErrors.push({
                    row: rowIndex + 1,
                    field: `Steps (column "${mapping.csvColumn}")`,
                    error: error.message,
                  });
                }
              }
            } else {
              // Match by systemName or displayName (case-insensitive)
              const field = template.caseFields?.find(
                (cf: any) =>
                  cf.caseField.systemName.toLowerCase() ===
                    mapping.templateField.toLowerCase() ||
                  cf.caseField.displayName.toLowerCase() ===
                    mapping.templateField.toLowerCase()
              ) as any;
              if (field) {
                try {
                  const validatedValue = validateFieldValue(
                    csvValue,
                    field.caseField,
                    rowIndex + 1
                  );
                  // Steps type fields go to the Steps table, not CaseFieldValues
                  if (field.caseField.type.type === "Steps") {
                    caseData.steps = validatedValue;
                  } else {
                    caseData.fieldValues[field.caseField.id] = validatedValue;
                  }
                } catch (error: any) {
                  rowErrors.push({
                    row: rowIndex + 1,
                    field: `${field.caseField.displayName} (column "${mapping.csvColumn}")`,
                    error: error.message,
                  });
                }
              }
            }
          }

          if (Array.isArray(row._aggregatedSteps)) {
            caseData.steps = row._aggregatedSteps.map((s: any) => ({
              step: ensureTipTapJSON(s.step),
              expectedResult: s.expectedResult
                ? ensureTipTapJSON(s.expectedResult)
                : null,
              order: s.order,
            }));
          }

          const caseName: string | undefined = caseData.name || undefined;
          for (const rowError of rowErrors) {
            rowError.caseName = caseName;
          }
          errors.push(...rowErrors);

          // Validate required fields
          if (!caseData.name) {
            errors.push({
              row: rowIndex + 1,
              field: "Name",
              error: `Name is required, but column "${nameMapping.csvColumn}" is empty for this row`,
            });
            continue;
          }

          // Validate required template fields
          for (const cf of template.caseFields || []) {
            if (
              cf.caseField.isRequired &&
              !caseData.fieldValues[cf.caseField.id]
            ) {
              const mappedColumn = body.fieldMappings.find(
                (m) =>
                  m.templateField?.toLowerCase() ===
                    cf.caseField.systemName.toLowerCase() ||
                  m.templateField?.toLowerCase() ===
                    cf.caseField.displayName.toLowerCase()
              );
              errors.push({
                row: rowIndex + 1,
                field: cf.caseField.displayName,
                caseName,
                error: mappedColumn
                  ? `Required field is missing — column "${mappedColumn.csvColumn}" is empty for this row`
                  : "Required field is missing — no CSV column is mapped to it",
              });
            }
          }

          // Determine folder
          if (body.importLocation === "single_folder") {
            caseData.folderId = body.folderId;
          } else {
            const folderPath = caseData.folderPath || "";
            delete caseData.folderPath;

            try {
              const folderId = await getOrCreateFolder(
                enhancedDb,
                body.projectId,
                repository.id,
                folderPath,
                body.importLocation === "root_folder"
                  ? body.folderId || null
                  : null,
                body.folderSplitMode || "plain",
                session.user.id
              );
              caseData.folderId = folderId;
            } catch (error: any) {
              errors.push({
                row: rowIndex + 1,
                field: "Folder",
                caseName,
                error: error.message,
              });
              continue;
            }
          }

          if (errors.length === 0) {
            casesToImport.push(caseData);
          }
        }

        // If there are validation errors, don't import anything
        if (errors.length > 0) {
          sendError("Validation failed", errors);
          return;
        }

        // Import cases with progress updates
        let importedCount = 0;
        const totalCases = casesToImport.length;

        // Get unique folder IDs and find max order for each folder
        const folderIds = [...new Set(casesToImport.map((c) => c.folderId))];
        const folderMaxOrders: Record<number, number> = {};

        for (const folderId of folderIds) {
          const maxOrderCase = await enhancedDb.repositoryCases.findFirst({
            where: { folderId },
            orderBy: { order: "desc" },
            select: { order: true },
          });
          folderMaxOrders[folderId] = maxOrderCase?.order ?? -1;
        }

        // Resolve the whole file's `issues` column in one pass, before any row
        // is written. Cells naming a tracker key no local row answers to are
        // resolved upstream here — deduplicated across the file, so the cost
        // is one call per distinct ticket rather than one per case. Advisory
        // throughout: an unresolvable cell reports itself and the case still
        // imports.
        const importIssueKeys = await resolveImportIssueKeys(enhancedDb, {
          projectId: body.projectId,
          names: casesToImport.flatMap((c) =>
            c.issues ? parseIssues(c.issues) : []
          ),
        });

        // Send initial progress
        sendProgress(0, totalCases);

        for (const caseData of casesToImport) {
          try {
            // Look up folder name for version record
            const folder = await enhancedDb.repositoryFolders.findUnique({
              where: { id: caseData.folderId },
              select: { name: true },
            });
            const _folderName = folder?.name || "Unknown";

            // Look up workflow state if specified
            let stateId = caseData.stateId;
            let resolvedWorkflowStateName = caseData.workflowStateName;
            if (caseData.workflowStateName) {
              const workflowState = await enhancedDb.workflows.findFirst({
                where: {
                  name: caseData.workflowStateName,
                  isDeleted: false,
                  isEnabled: true,
                  scope: "CASES",
                  projects: {
                    some: { projectId: body.projectId },
                  },
                },
              });

              if (workflowState) {
                stateId = workflowState.id;
              }
            }

            const remappedStateId =
              (await resolveCreateStateRemap(
                baseDb,
                body.projectId,
                WorkflowScope.CASES,
                stateId
              )) ?? stateId;
            if (remappedStateId !== stateId) {
              const remappedWorkflow = await baseDb.workflows.findUnique({
                where: { id: remappedStateId },
                select: { name: true },
              });
              resolvedWorkflowStateName =
                remappedWorkflow?.name ?? defaultWorkflow.name;
              stateId = remappedStateId;
            }

            // Look up creator if specified
            let creatorId = caseData.creatorId;
            if (caseData.createdByName) {
              const creator = await enhancedDb.user.findFirst({
                where: {
                  OR: [
                    { name: caseData.createdByName },
                    { email: caseData.createdByName },
                  ],
                },
              });

              if (creator) {
                creatorId = creator.id;
              }
            }

            // Parse created date if specified
            let createdAt = undefined;
            if (caseData.createdAt) {
              try {
                createdAt = new Date(caseData.createdAt);
                if (isNaN(createdAt.getTime())) {
                  createdAt = undefined;
                }
              } catch {
                createdAt = undefined;
              }
            }

            // Check if we should update an existing case or create a new one
            let newCase;
            let isUpdate = false;
            // Set whenever an EXISTING RepositoryCases row is reused rather
            // than inserted — the plain update below, and both create-or-
            // restore branches. Its field values are replaced, never appended
            // to: CaseFieldValues has no unique (testCaseId, fieldId), and a
            // resurrected case still carries the rows from its previous life
            // (unlike steps, which the case's soft-delete took down with it).
            // Appending left cases with several rows per field, which broke
            // every per-row count downstream.
            let reusedCaseId: number | null = null;

            // Calculate the order for this test case (increment per folder)
            folderMaxOrders[caseData.folderId]++;
            const caseOrder = folderMaxOrders[caseData.folderId];

            if (caseData.id) {
              const existingCase = await enhancedDb.repositoryCases.findFirst({
                where: {
                  id: caseData.id,
                  projectId: body.projectId,
                },
              });

              if (existingCase) {
                isUpdate = true;
                reusedCaseId = caseData.id;
                newCase = await enhancedDb.repositoryCases.update({
                  where: { id: caseData.id },
                  data: {
                    name: caseData.name,
                    folderId: caseData.folderId,
                    templateId: caseData.templateId,
                    stateId: stateId,
                    automated: caseData.automated,
                    estimate: caseData.estimate,
                    forecastManual: caseData.forecastManual,
                  },
                });
              } else {
                // Create-or-restore: if a prior soft-deleted case
                // exists at the same (projectId, name, className, source)
                // tuple, resurrect it with the imported payload instead
                // of 23505ing. The resurrected row keeps its existing
                // id; the caseData.id we tried to preserve is a no-op in
                // that branch — acceptable because importers treat ids
                // as a hint, not a hard requirement. We can't use
                // Prisma's compound-unique upsert because the generated
                // type rejects null for `className` (typed as `string`,
                // not `string | null`).
                const importFields = {
                  name: caseData.name,
                  repositoryId: caseData.repositoryId,
                  folderId: caseData.folderId,
                  templateId: caseData.templateId,
                  stateId: stateId,
                  automated: caseData.automated,
                  estimate: caseData.estimate,
                  forecastManual: caseData.forecastManual,
                  order: caseOrder,
                  ...(createdAt && { createdAt }),
                };
                const softDeletedExisting =
                  await enhancedDb.repositoryCases.findFirst({
                    where: {
                      projectId: caseData.projectId,
                      name: caseData.name,
                      className: null,
                      source: caseData.source,
                      isDeleted: true,
                    },
                    select: { id: true },
                  });
                reusedCaseId = softDeletedExisting?.id ?? null;
                newCase = softDeletedExisting
                  ? await enhancedDb.repositoryCases.update({
                      where: { id: softDeletedExisting.id },
                      data: { ...importFields, isDeleted: false },
                    })
                  : await enhancedDb.repositoryCases.create({
                      data: {
                        id: caseData.id,
                        projectId: caseData.projectId,
                        source: caseData.source,
                        creatorId: creatorId,
                        ...importFields,
                      },
                    });
              }
            } else {
              const importFields = {
                name: caseData.name,
                repositoryId: caseData.repositoryId,
                folderId: caseData.folderId,
                templateId: caseData.templateId,
                stateId: stateId,
                automated: caseData.automated,
                estimate: caseData.estimate,
                forecastManual: caseData.forecastManual,
                order: caseOrder,
                ...(createdAt && { createdAt }),
              };
              const softDeletedExisting =
                await enhancedDb.repositoryCases.findFirst({
                  where: {
                    projectId: caseData.projectId,
                    name: caseData.name,
                    className: null,
                    source: caseData.source,
                    isDeleted: true,
                  },
                  select: { id: true },
                });
              reusedCaseId = softDeletedExisting?.id ?? null;
              newCase = softDeletedExisting
                ? await enhancedDb.repositoryCases.update({
                    where: { id: softDeletedExisting.id },
                    data: { ...importFields, isDeleted: false },
                  })
                : await enhancedDb.repositoryCases.create({
                    data: {
                      projectId: caseData.projectId,
                      source: caseData.source,
                      creatorId: creatorId,
                      ...importFields,
                    },
                  });
            }

            // Replace, never append: see `reusedCaseId` above.
            if (reusedCaseId !== null) {
              await enhancedDb.caseFieldValues.deleteMany({
                where: { testCaseId: reusedCaseId },
              });
            }

            // Create field values
            for (const [fieldId, value] of Object.entries(
              caseData.fieldValues
            )) {
              if (value !== null && value !== undefined) {
                await enhancedDb.caseFieldValues.create({
                  data: {
                    testCaseId: newCase.id,
                    fieldId: parseInt(fieldId),
                    value: value as JsonValue,
                  },
                });
              }
            }

            // Create steps in the Steps table if present
            if (caseData.steps && Array.isArray(caseData.steps)) {
              // Clear the existing steps if updating. This CANNOT be a blanket
              // deleteMany: `TestRunStepResults.stepId` is `onDelete: Cascade`, so
              // hard-deleting a step that has been executed destroys every step
              // result ever recorded against it — re-importing a case would
              // silently erase its execution history.
              //
              // So the two kinds are separated: a step that has step results is
              // retired (soft-deleted) and keeps them attached — the run-result
              // read path does not filter `step.isDeleted`, so the history still
              // renders — while a step that was never executed is genuinely
              // deleted, which keeps re-imports from accumulating dead rows.
              if (isUpdate) {
                const existingSteps = await enhancedDb.steps.findMany({
                  where: { testCaseId: newCase.id, isDeleted: false },
                  select: {
                    id: true,
                    _count: { select: { stepResults: true } },
                  },
                });

                const executedStepIds = existingSteps
                  .filter((step) => step._count.stepResults > 0)
                  .map((step) => step.id);
                const unexecutedStepIds = existingSteps
                  .filter((step) => step._count.stepResults === 0)
                  .map((step) => step.id);

                if (executedStepIds.length > 0) {
                  await enhancedDb.steps.updateMany({
                    where: { id: { in: executedStepIds } },
                    data: { isDeleted: true },
                  });
                }
                if (unexecutedStepIds.length > 0) {
                  await enhancedDb.steps.deleteMany({
                    where: { id: { in: unexecutedStepIds } },
                  });
                }
              }

              for (const stepData of caseData.steps) {
                await enhancedDb.steps.create({
                  data: {
                    testCaseId: newCase.id,
                    step: stepData.step,
                    // v3 rejects raw `null` for nullable Json columns on create.
                    expectedResult: stepData.expectedResult ?? DbNull,
                    order: stepData.order,
                  },
                });
              }
            }

            // Create or update version using centralized helper
            // First, ensure currentVersion is set correctly on the case
            let versionNumber: number;
            if (isUpdate) {
              // For updates, calculate next version
              const latestVersion =
                await enhancedDb.repositoryCaseVersions.findFirst({
                  where: { repositoryCaseId: newCase.id },
                  orderBy: { version: "desc" },
                });
              // A version from the file may only ever move the case FORWARD.
              // Trusting it verbatim breaks the documented export-edit-reimport
              // round trip: a TestPlanIt export carries the case's own Version,
              // so re-importing it asks for a version snapshot that already
              // exists and violates @@unique([repositoryCaseId, version]).
              const highestVersion = latestVersion?.version || 0;
              versionNumber =
                caseData.version && caseData.version > highestVersion
                  ? caseData.version
                  : highestVersion + 1;

              // Update the case's currentVersion
              await enhancedDb.repositoryCases.update({
                where: { id: newCase.id },
                data: { currentVersion: versionNumber },
              });
            } else if (reusedCaseId !== null) {
              // A restored soft-deleted case keeps its earlier version
              // snapshots, so move past them instead of colliding on
              // @@unique([repositoryCaseId, version]).
              const latestVersion =
                await enhancedDb.repositoryCaseVersions.findFirst({
                  where: { repositoryCaseId: newCase.id },
                  orderBy: { version: "desc" },
                });
              const highestVersion = latestVersion?.version || 0;
              versionNumber =
                caseData.version && caseData.version > highestVersion
                  ? caseData.version
                  : highestVersion + 1;

              await enhancedDb.repositoryCases.update({
                where: { id: newCase.id },
                data: { currentVersion: versionNumber },
              });
            } else {
              // For new cases, use provided version or default to 1
              versionNumber = caseData.version || 1;

              // Update the case's currentVersion to match
              await enhancedDb.repositoryCases.update({
                where: { id: newCase.id },
                data: { currentVersion: versionNumber },
              });
            }

            // Create version snapshot using centralized helper
            await createTestCaseVersionInTransaction(enhancedDb, newCase.id, {
              version: versionNumber,
              creatorId: isUpdate ? session.user.id : creatorId,
              creatorName: isUpdate
                ? session.user.name || session.user.email || ""
                : caseData.createdByName ||
                  session.user.name ||
                  session.user.email ||
                  "",
              createdAt: isUpdate ? new Date() : createdAt || new Date(),
              overrides: {
                name: caseData.name,
                stateId: stateId,
                stateName: resolvedWorkflowStateName || defaultWorkflow.name,
                estimate: caseData.estimate,
                forecastManual: caseData.forecastManual,
                automated: caseData.automated,
              },
            });

            // Handle tags if present
            if (caseData.tags && Array.isArray(caseData.tags)) {
              if (isUpdate) {
                await enhancedDb.repositoryCaseTag.deleteMany({
                  where: { caseId: newCase.id },
                });
              }

              for (const tagName of caseData.tags) {
                // Case-insensitive tag matching - first check for active tag
                let tag = await enhancedDb.tags.findFirst({
                  where: {
                    name: { equals: tagName, mode: "insensitive" },
                    isDeleted: false,
                  },
                });

                if (!tag) {
                  // Check for soft-deleted tag with same name and restore it
                  const deletedTag = await enhancedDb.tags.findFirst({
                    where: {
                      name: { equals: tagName, mode: "insensitive" },
                      isDeleted: true,
                    },
                  });

                  if (deletedTag) {
                    // Restore the soft-deleted tag
                    tag = await enhancedDb.tags.update({
                      where: { id: deletedTag.id },
                      data: { isDeleted: false },
                    });
                  } else {
                    // Create new tag only if no existing tag found
                    tag = await enhancedDb.tags.create({
                      data: { name: tagName },
                    });
                  }
                }

                await enhancedDb.repositoryCaseTag.create({
                  data: { caseId: newCase.id, tagId: tag.id },
                });
              }
            }

            // Handle issues if present
            if (caseData.issues) {
              const { unmatched } = await replaceImportedCaseIssueLinks(
                enhancedDb,
                {
                  caseId: newCase.id,
                  projectId: body.projectId,
                  issueNames: parseIssues(caseData.issues),
                  replaceExisting: isUpdate,
                  resolvedKeyIds: importIssueKeys.idsByName,
                }
              );
              // Advisory, like the duplicate warnings: the case is imported,
              // and the cells that could not be placed say why instead of
              // disappearing.
              for (const name of unmatched) {
                warnings.push({
                  row: casesToImport.indexOf(caseData) + 1,
                  field: "Issues",
                  caseName: caseData.name || undefined,
                  error:
                    importIssueKeys.errorsByName.get(name) ??
                    `No issue named "${name}" in this project.`,
                });
              }
            }

            // Handle attachments if present
            if (caseData.attachments) {
              const attachments = parseAttachments(caseData.attachments);

              if (isUpdate) {
                await enhancedDb.attachments.deleteMany({
                  where: { testCaseId: newCase.id },
                });
              }

              for (const attachment of attachments) {
                try {
                  await enhancedDb.attachments.create({
                    data: {
                      url: attachment.url,
                      name: attachment.name,
                      note: attachment.note,
                      size: attachment.size,
                      mimeType: attachment.mimeType,
                      testCaseId: newCase.id,
                      createdById: session.user.id,
                    },
                  });
                } catch {
                  // Continue with other attachments even if one fails
                }
              }
            }

            // Handle test runs if present
            if (caseData.testRuns) {
              const testRunNames = parseTestRuns(caseData.testRuns);

              if (isUpdate) {
                await enhancedDb.testRunCases.deleteMany({
                  where: { repositoryCaseId: newCase.id },
                });
              }

              for (const testRunName of testRunNames) {
                const testRun = await enhancedDb.testRuns.findFirst({
                  where: {
                    name: testRunName,
                    projectId: body.projectId,
                    isDeleted: false,
                  },
                });

                if (testRun) {
                  try {
                    await enhancedDb.testRunCases.create({
                      data: {
                        testRunId: testRun.id,
                        repositoryCaseId: newCase.id,
                        order: 0,
                      },
                    });
                  } catch {
                    // Continue with other test runs even if one fails
                  }
                }
              }
            }

            // Sync to Elasticsearch
            await syncRepositoryCaseToElasticsearch(newCase.id).catch(
              (error: any) => {
                console.error(
                  `Failed to sync repository case ${newCase.id} to Elasticsearch:`,
                  error
                );
              }
            );

            importedCount++;
            // Send progress update after each case
            sendProgress(importedCount, totalCases);
          } catch (error: any) {
            errors.push({
              row: casesToImport.indexOf(caseData) + 1,
              field: "General",
              caseName: caseData.name || undefined,
              error: error.message,
            });
          }
        }

        // Audit the bulk import
        if (importedCount > 0) {
          await auditBulkCreate(
            "RepositoryCases",
            importedCount,
            body.projectId,
            {
              source:
                body.fileType === "markdown" ? "Markdown Import" : "CSV Import",
              templateId: body.templateId,
              importLocation: body.importLocation,
            }
          );
        }

        // Advisory duplicate warnings — never blocks import
        let duplicateWarnings: Array<{
          caseName: string;
          similarTo: Array<{ id: number; name: string; confidence: string }>;
        }> = [];
        try {
          const esClient = getElasticsearchClient();
          if (esClient) {
            const scanService = new DuplicateScanService(baseDb, esClient);
            const tenantId = getCurrentTenantId();

            // Check each imported case name (limit to first 50 for performance)
            const casesToCheck = casesToImport.slice(0, 50);
            for (const caseData of casesToCheck) {
              const similar = await scanService.findSimilarCases(
                { name: caseData.name },
                body.projectId,
                tenantId
              );
              if (similar.length > 0) {
                // Look up case names for top 3 matches
                const caseIds = similar
                  .slice(0, 3)
                  .map((s) => (s.caseAId === 0 ? s.caseBId : s.caseAId));
                const cases = await baseDb.repositoryCases.findMany({
                  where: { id: { in: caseIds } },
                  select: { id: true, name: true },
                });
                duplicateWarnings.push({
                  caseName: caseData.name,
                  similarTo: similar.slice(0, 3).map((s) => {
                    const caseId = s.caseAId === 0 ? s.caseBId : s.caseAId;
                    const found = cases.find((c) => c.id === caseId);
                    return {
                      id: caseId,
                      name: found?.name || `Case #${caseId}`,
                      confidence: s.confidence,
                    };
                  }),
                });
              }
            }
          }
        } catch (e) {
          // Silently ignore — duplicate check is advisory
          console.warn(
            "Duplicate check during import failed (non-blocking):",
            e
          );
        }

        // Send completion (with advisory duplicate warnings)
        const completeData = {
          complete: true as const,
          importedCount,
          errors,
          warnings,
          duplicateWarnings,
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(completeData)}\n\n`)
        );
        controller.close();
      } catch (error) {
        sendError(error instanceof Error ? error.message : "Import failed");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

function validateFieldValue(
  value: any,
  field: CaseFields & { type: CaseFieldTypes; fieldOptions?: any[] },
  _rowNumber: number
): any {
  if (!value && field.isRequired) {
    throw new Error(`Required field cannot be empty`);
  }

  if (!value) return null;

  switch (field.type.type) {
    case "Text String":
      return value.toString();

    case "Text Long":
      // For CSV import, auto-detect format (plain text, markdown, HTML, or TipTap JSON)
      return ensureTipTapJSON(value.toString());

    case "Integer":
      const intValue = parseInt(value);
      if (isNaN(intValue)) {
        throw new Error(`Invalid integer value: ${value}`);
      }
      if (field.minValue !== null && intValue < field.minValue) {
        throw new Error(
          `Value ${intValue} is less than minimum ${field.minValue}`
        );
      }
      if (field.maxValue !== null && intValue > field.maxValue) {
        throw new Error(
          `Value ${intValue} is greater than maximum ${field.maxValue}`
        );
      }
      return intValue;

    case "Number":
      const floatValue = parseFloat(value);
      if (isNaN(floatValue)) {
        throw new Error(`Invalid number value: ${value}`);
      }
      if (field.minValue !== null && floatValue < field.minValue) {
        throw new Error(
          `Value ${floatValue} is less than minimum ${field.minValue}`
        );
      }
      if (field.maxValue !== null && floatValue > field.maxValue) {
        throw new Error(
          `Value ${floatValue} is greater than maximum ${field.maxValue}`
        );
      }
      return floatValue;

    case "Checkbox":
      return value === "true" || value === "1" || value === true;

    case "Dropdown":
      // Look up the field option ID by name (case-insensitive)
      if (field.fieldOptions && field.fieldOptions.length > 0) {
        const stringValue = value.toString().trim();
        const matchingOption = field.fieldOptions.find(
          (fo: any) =>
            fo.fieldOption.name.toLowerCase() === stringValue.toLowerCase()
        );
        if (matchingOption) {
          return matchingOption.fieldOption.id;
        }
        // If no match found, throw an error with available options
        const availableOptions = field.fieldOptions
          .map((fo: any) => fo.fieldOption.name)
          .join(", ");
        throw new Error(
          `Invalid option "${stringValue}". Available options: ${availableOptions}`
        );
      }
      return value.toString();

    case "Multi-select":
      // Handle comma-separated values and look up IDs for each
      if (field.fieldOptions && field.fieldOptions.length > 0) {
        const stringValue = value.toString();
        // Split by comma and trim each value
        const values = stringValue
          .split(",")
          .map((v: string) => v.trim())
          .filter((v: string) => v);

        const ids: number[] = [];
        for (const val of values) {
          const matchingOption = field.fieldOptions.find(
            (fo: any) => fo.fieldOption.name.toLowerCase() === val.toLowerCase()
          );
          if (matchingOption) {
            ids.push(matchingOption.fieldOption.id);
          } else {
            const availableOptions = field.fieldOptions
              .map((fo: any) => fo.fieldOption.name)
              .join(", ");
            throw new Error(
              `Invalid option "${val}". Available options: ${availableOptions}`
            );
          }
        }
        return ids;
      }
      return value.toString();

    case "Link":
      // Basic URL validation
      try {
        new URL(value);
        return value.toString();
      } catch {
        throw new Error(`Invalid URL: ${value}`);
      }

    case "Steps":
      // Same parse the wizard preview runs, so the preview and the import
      // never disagree on the step count.
      return parseStepsCell(value.toString()).map((s) => ({
        step: ensureTipTapJSON(s.step),
        expectedResult: s.expectedResult
          ? ensureTipTapJSON(s.expectedResult)
          : null,
        order: s.order,
      }));

    default:
      return value;
  }
}

async function getOrCreateFolder(
  db: any,
  projectId: number,
  repositoryId: number,
  folderPath: string,
  parentId: number | null,
  splitMode: string,
  userId: string
): Promise<number> {
  if (!folderPath || folderPath.trim() === "") {
    throw new Error("Folder path cannot be empty");
  }

  let folderNames: string[];

  switch (splitMode) {
    case "slash":
      folderNames = folderPath
        .split("/")
        .map((n) => n.trim())
        .filter((n) => n);
      break;
    case "dot":
      folderNames = folderPath
        .split(".")
        .map((n) => n.trim())
        .filter((n) => n);
      break;
    case "greater_than":
      folderNames = folderPath
        .split(">")
        .map((n) => n.trim())
        .filter((n) => n);
      break;
    case "plain":
    default:
      folderNames = [folderPath.trim()];
      break;
  }

  let currentParentId = parentId;
  let lastFolderId: number = 0;

  for (const folderName of folderNames) {
    // Check if folder exists
    let folder = await db.repositoryFolders.findFirst({
      where: {
        projectId,
        repositoryId,
        parentId: currentParentId,
        name: folderName,
        isDeleted: false,
      },
    });

    if (!folder) {
      // Create folder
      folder = await db.repositoryFolders.create({
        data: {
          projectId,
          repositoryId,
          parentId: currentParentId,
          name: folderName,
          creatorId: userId,
        },
      });
    }

    lastFolderId = folder.id;
    currentParentId = folder.id;
  }

  return lastFolderId;
}
