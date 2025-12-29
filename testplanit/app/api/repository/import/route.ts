import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { enhance } from "@zenstackhq/runtime";
import { db } from "~/server/db";
import { prisma } from "~/lib/prisma";
import Papa from "papaparse";
import {
  CaseFields,
  CaseFieldTypes,
  Prisma,
  RepositoryCaseSource,
} from "@prisma/client";
import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";
import { auditBulkCreate } from "~/lib/services/auditLog";

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
        // If array of objects with name property, extract names
        return parsed
          .map((issue) => (typeof issue === "string" ? issue : issue.name))
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
  file: string;
  delimiter: string;
  hasHeaders: boolean;
  encoding: string;
  templateId: number;
  importLocation: "single_folder" | "root_folder" | "top_level";
  folderId?: number;
  fieldMappings: FieldMapping[];
  folderSplitMode?: "plain" | "slash" | "dot" | "greater_than";
  rowMode: "single" | "multi";
}

interface ImportError {
  row: number;
  field: string;
  error: string;
}

export async function POST(request: NextRequest) {
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

      const sendComplete = (importedCount: number, errors: ImportError[]) => {
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

        // Parse CSV
        const parseResult = Papa.parse(body.file, {
          delimiter: body.delimiter,
          header: body.hasHeaders,
          skipEmptyLines: true,
        });

        if (parseResult.errors.length > 0) {
          sendError("CSV parsing failed");
          return;
        }

        const rows = parseResult.data as any[];
        const errors: ImportError[] = [];
        const casesToImport: any[] = [];

        // Process each row
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
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
                  errors.push({
                    row: rowIndex + 1,
                    field: "Steps",
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
                  errors.push({
                    row: rowIndex + 1,
                    field: field.caseField.displayName,
                    error: error.message,
                  });
                }
              }
            }
          }

          // Validate required fields
          const nameMapping = body.fieldMappings.find(
            (m) => m.templateField === "name"
          );
          if (!nameMapping || !caseData.name) {
            errors.push({
              row: rowIndex + 1,
              field: "Name",
              error: "Name is required",
            });
            continue;
          }

          // Validate required template fields
          for (const cf of template.caseFields || []) {
            if (
              cf.caseField.isRequired &&
              !caseData.fieldValues[cf.caseField.id]
            ) {
              errors.push({
                row: rowIndex + 1,
                field: cf.caseField.displayName,
                error: "Required field is missing",
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

        // Send initial progress
        sendProgress(0, totalCases);

        for (const caseData of casesToImport) {
          try {
            // Look up folder name for version record
            const folder = await enhancedDb.repositoryFolders.findUnique({
              where: { id: caseData.folderId },
              select: { name: true },
            });
            const folderName = folder?.name || "Unknown";

            // Look up workflow state if specified
            let stateId = caseData.stateId;
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

                await enhancedDb.caseFieldValues.deleteMany({
                  where: { testCaseId: caseData.id },
                });
              } else {
                newCase = await enhancedDb.repositoryCases.create({
                  data: {
                    id: caseData.id,
                    name: caseData.name,
                    projectId: caseData.projectId,
                    repositoryId: caseData.repositoryId,
                    folderId: caseData.folderId,
                    templateId: caseData.templateId,
                    stateId: stateId,
                    source: caseData.source,
                    creatorId: creatorId,
                    automated: caseData.automated,
                    estimate: caseData.estimate,
                    forecastManual: caseData.forecastManual,
                    order: caseOrder,
                    ...(createdAt && { createdAt }),
                  },
                });
              }
            } else {
              newCase = await enhancedDb.repositoryCases.create({
                data: {
                  name: caseData.name,
                  projectId: caseData.projectId,
                  repositoryId: caseData.repositoryId,
                  folderId: caseData.folderId,
                  templateId: caseData.templateId,
                  stateId: stateId,
                  source: caseData.source,
                  creatorId: creatorId,
                  automated: caseData.automated,
                  estimate: caseData.estimate,
                  forecastManual: caseData.forecastManual,
                  order: caseOrder,
                  ...(createdAt && { createdAt }),
                },
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
                    value: value as Prisma.InputJsonValue,
                  },
                });
              }
            }

            // Create steps in the Steps table if present
            if (caseData.steps && Array.isArray(caseData.steps)) {
              // Delete existing steps if updating
              if (isUpdate) {
                await enhancedDb.steps.deleteMany({
                  where: { testCaseId: newCase.id },
                });
              }

              for (const stepData of caseData.steps) {
                await enhancedDb.steps.create({
                  data: {
                    testCaseId: newCase.id,
                    step: stepData.step,
                    expectedResult: stepData.expectedResult,
                    order: stepData.order,
                  },
                });
              }
            }

            // Create or update version
            if (isUpdate) {
              const latestVersion =
                await enhancedDb.repositoryCaseVersions.findFirst({
                  where: { repositoryCaseId: newCase.id },
                  orderBy: { version: "desc" },
                });

              const nextVersion = (latestVersion?.version || 0) + 1;

              await enhancedDb.repositoryCaseVersions.create({
                data: {
                  repositoryCaseId: newCase.id,
                  staticProjectId: project.id,
                  staticProjectName: project.name,
                  projectId: project.id,
                  repositoryId: repository.id,
                  folderId: caseData.folderId,
                  folderName,
                  templateId: template.id,
                  templateName: template.templateName,
                  name: caseData.name,
                  stateId: stateId,
                  stateName: caseData.workflowStateName || defaultWorkflow.name,
                  estimate: caseData.estimate,
                  forecastManual: caseData.forecastManual,
                  automated: caseData.automated,
                  creatorId: session.user.id,
                  creatorName: session.user.name || session.user.email || "",
                  version: caseData.version || nextVersion,
                  createdAt: new Date(),
                },
              });
            } else {
              await enhancedDb.repositoryCaseVersions.create({
                data: {
                  repositoryCaseId: newCase.id,
                  staticProjectId: project.id,
                  staticProjectName: project.name,
                  projectId: project.id,
                  repositoryId: repository.id,
                  folderId: caseData.folderId,
                  folderName,
                  templateId: template.id,
                  templateName: template.templateName,
                  name: caseData.name,
                  stateId: stateId,
                  stateName: caseData.workflowStateName || defaultWorkflow.name,
                  estimate: caseData.estimate,
                  forecastManual: caseData.forecastManual,
                  automated: caseData.automated,
                  creatorId: creatorId,
                  creatorName:
                    caseData.createdByName ||
                    session.user.name ||
                    session.user.email ||
                    "",
                  version: caseData.version || 1,
                  ...(createdAt && { createdAt }),
                },
              });
            }

            // Handle tags if present
            if (caseData.tags && Array.isArray(caseData.tags)) {
              if (isUpdate) {
                await enhancedDb.repositoryCases.update({
                  where: { id: newCase.id },
                  data: { tags: { set: [] } },
                });
              }

              for (const tagName of caseData.tags) {
                let tag = await enhancedDb.tags.findFirst({
                  where: { name: tagName, isDeleted: false },
                });

                if (!tag) {
                  tag = await enhancedDb.tags.create({
                    data: { name: tagName },
                  });
                }

                await enhancedDb.repositoryCases.update({
                  where: { id: newCase.id },
                  data: { tags: { connect: { id: tag.id } } },
                });
              }
            }

            // Handle issues if present
            if (caseData.issues) {
              const issueNames = parseIssues(caseData.issues);

              if (isUpdate) {
                await enhancedDb.repositoryCases.update({
                  where: { id: newCase.id },
                  data: { issues: { set: [] } },
                });
              }

              for (const issueName of issueNames) {
                const issue = await enhancedDb.issue.findFirst({
                  where: { name: issueName, isDeleted: false },
                });

                if (issue) {
                  await enhancedDb.repositoryCases.update({
                    where: { id: newCase.id },
                    data: { issues: { connect: { id: issue.id } } },
                  });
                }
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
              error: error.message,
            });
          }
        }

        // Audit the bulk import
        if (importedCount > 0) {
          auditBulkCreate("RepositoryCases", importedCount, body.projectId, {
            source: "CSV Import",
            templateId: body.templateId,
            importLocation: body.importLocation,
          }).catch((error) =>
            console.error("[AuditLog] Failed to audit repository import:", error)
          );
        }

        // Send completion
        sendComplete(importedCount, errors);
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
}

function validateFieldValue(
  value: any,
  field: CaseFields & { type: CaseFieldTypes; fieldOptions?: any[] },
  rowNumber: number
): any {
  if (!value && field.isRequired) {
    throw new Error(`Required field cannot be empty`);
  }

  if (!value) return null;

  switch (field.type.type) {
    case "Text String":
      return value.toString();

    case "Text Long":
      // For CSV import, convert plain text to TipTap JSON format
      return {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: value.toString() }],
          },
        ],
      };

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
            (fo: any) =>
              fo.fieldOption.name.toLowerCase() === val.toLowerCase()
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
      // Parse pipe-separated format: "1. Step text | Expected result"
      const stepsText = value.toString();
      const lines = stepsText.split(/\n/).filter((line: string) => line.trim());

      return lines.map((line: string, index: number) => {
        // Remove step number prefix if present (e.g., "1. ", "2. ")
        const withoutNumber = line.replace(/^\d+\.\s*/, "").trim();

        // Split by pipe to get step and expected result
        const parts = withoutNumber.split("|").map((p: string) => p.trim());
        const stepText = parts[0] || "";
        const expectedResultText = parts[1] || null;

        return {
          step: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: stepText ? [{ type: "text", text: stepText }] : [],
              },
            ],
          },
          expectedResult: expectedResultText
            ? {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: expectedResultText }],
                  },
                ],
              }
            : null,
          order: index,
        };
      });

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
