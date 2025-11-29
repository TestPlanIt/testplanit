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

    // Get repository
    const repository = await enhancedDb.repositories.findFirst({
      where: {
        projectId: body.projectId,
        isActive: true,
        isDeleted: false,
      },
    });

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
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
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
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
      return NextResponse.json(
        { error: "No default workflow found" },
        { status: 400 }
      );
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
          // Handle folder mapping
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
          // Handle tags field
          caseData.tags = parseTags(csvValue);
        } else if (mapping.templateField === "attachments") {
          // Handle attachments field (store for later processing)
          caseData.attachments = csvValue;
        } else if (mapping.templateField === "issues") {
          // Handle issues field (store for later processing)
          caseData.issues = csvValue;
        } else if (mapping.templateField === "linkedCases") {
          // Handle linked cases field (store for later processing)
          caseData.linkedCases = csvValue;
        } else if (mapping.templateField === "workflowState") {
          // Handle workflow state field (store for later processing)
          caseData.workflowStateName = csvValue;
        } else if (mapping.templateField === "createdAt") {
          // Handle created at field
          caseData.createdAt = csvValue;
        } else if (mapping.templateField === "createdBy") {
          // Handle created by field (store for later processing)
          caseData.createdByName = csvValue;
        } else if (mapping.templateField === "version") {
          // Handle version field
          caseData.version = parseInt(csvValue) || 1;
        } else if (mapping.templateField === "testRuns") {
          // Handle test runs field (store for later processing)
          caseData.testRuns = csvValue;
        } else if (mapping.templateField === "id") {
          // Handle ID field for update/create functionality
          caseData.id = parseInt(csvValue) || null;
        } else if (mapping.templateField === "steps") {
          // Handle steps as a special case
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
              caseData.fieldValues[field.caseField.id] = validatedValue;
            } catch (error: any) {
              errors.push({
                row: rowIndex + 1,
                field: "Steps",
                error: error.message,
              });
            }
          }
        } else {
          // Custom field
          const field = template.caseFields?.find(
            (cf: any) => cf.caseField.systemName === mapping.templateField
          ) as any;
          if (field) {
            try {
              const validatedValue = validateFieldValue(
                csvValue,
                field.caseField,
                rowIndex + 1
              );
              caseData.fieldValues[field.caseField.id] = validatedValue;
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
        if (cf.caseField.isRequired && !caseData.fieldValues[cf.caseField.id]) {
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
        // Handle folder creation/lookup
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

    // If there are errors, don't import anything
    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Validation failed", errors },
        { status: 400 }
      );
    }

    // Import cases
    let importedCount = 0;

    for (const caseData of casesToImport) {
      try {
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
            // Validate the date
            if (isNaN(createdAt.getTime())) {
              createdAt = undefined;
            }
          } catch {
            // Invalid date format, use default
            createdAt = undefined;
          }
        }

        // Check if we should update an existing case or create a new one
        let newCase;
        let isUpdate = false;

        if (caseData.id) {
          // Check if a case with this ID exists
          const existingCase = await enhancedDb.repositoryCases.findFirst({
            where: {
              id: caseData.id,
              projectId: body.projectId,
            },
          });

          if (existingCase) {
            // Update existing case
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
                // Note: We don't update createdAt, creatorId, source, etc. for existing cases
              },
            });

            // Delete existing field values to replace them
            await enhancedDb.caseFieldValues.deleteMany({
              where: { testCaseId: caseData.id },
            });
          } else {
            // Create new case with specific ID
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
                ...(createdAt && { createdAt }),
              },
            });
          }
        } else {
          // No ID specified, create new case with auto-generated ID
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
              ...(createdAt && { createdAt }),
            },
          });
        }

        // Create field values
        for (const [fieldId, value] of Object.entries(caseData.fieldValues)) {
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

        // Create or update version
        if (isUpdate) {
          // For updates, create a new version
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
              folderName: "", // Would need to fetch this
              templateId: template.id,
              templateName: template.templateName,
              name: caseData.name,
              stateId: stateId,
              stateName: caseData.workflowStateName || defaultWorkflow.name,
              estimate: caseData.estimate,
              forecastManual: caseData.forecastManual,
              automated: caseData.automated,
              creatorId: session.user.id, // Use current user for update
              creatorName: session.user.name || session.user.email || "",
              version: caseData.version || nextVersion,
              createdAt: new Date(), // Use current date for update
            },
          });
        } else {
          // For new cases, create initial version
          await enhancedDb.repositoryCaseVersions.create({
            data: {
              repositoryCaseId: newCase.id,
              staticProjectId: project.id,
              staticProjectName: project.name,
              projectId: project.id,
              repositoryId: repository.id,
              folderId: caseData.folderId,
              folderName: "", // Would need to fetch this
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
          // For updates, disconnect all existing tags first
          if (isUpdate) {
            await enhancedDb.repositoryCases.update({
              where: { id: newCase.id },
              data: {
                tags: {
                  set: [], // Clear all existing tags
                },
              },
            });
          }

          for (const tagName of caseData.tags) {
            // Find or create tag
            let tag = await enhancedDb.tags.findFirst({
              where: { name: tagName, isDeleted: false },
            });

            if (!tag) {
              tag = await enhancedDb.tags.create({
                data: { name: tagName },
              });
            }

            // Connect tag to case
            await enhancedDb.repositoryCases.update({
              where: { id: newCase.id },
              data: {
                tags: {
                  connect: { id: tag.id },
                },
              },
            });
          }
        }

        // Handle issues if present
        if (caseData.issues) {
          const issueNames = parseIssues(caseData.issues);

          // For updates, disconnect all existing issues first
          if (isUpdate) {
            await enhancedDb.repositoryCases.update({
              where: { id: newCase.id },
              data: {
                issues: {
                  set: [], // Clear all existing issues
                },
              },
            });
          }

          for (const issueName of issueNames) {
            // Find issue by name
            const issue = await enhancedDb.issue.findFirst({
              where: {
                name: issueName,
                isDeleted: false,
              },
            });

            if (issue) {
              // Connect issue to case
              await enhancedDb.repositoryCases.update({
                where: { id: newCase.id },
                data: {
                  issues: {
                    connect: { id: issue.id },
                  },
                },
              });
            }
          }
        }

        // Handle linked cases if present
        if (caseData.linkedCases) {
          // For now, we'll skip linked cases as they require complex validation
          // This could be implemented in the future by parsing case IDs/names
        }

        // Handle attachments if present
        if (caseData.attachments) {
          const attachments = parseAttachments(caseData.attachments);

          // For updates, delete existing attachments first
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
            } catch (error) {
              // Failed to create attachment for case ${newCase.id}
              // Continue with other attachments even if one fails
            }
          }
        }

        // Handle test runs if present
        if (caseData.testRuns) {
          const testRunNames = parseTestRuns(caseData.testRuns);

          // For updates, remove existing test run associations first
          if (isUpdate) {
            await enhancedDb.testRunCases.deleteMany({
              where: { repositoryCaseId: newCase.id },
            });
          }

          for (const testRunName of testRunNames) {
            // Find test run by name in the project
            const testRun = await enhancedDb.testRuns.findFirst({
              where: {
                name: testRunName,
                projectId: body.projectId,
                isDeleted: false,
              },
            });

            if (testRun) {
              // Create test run case association
              try {
                await enhancedDb.testRunCases.create({
                  data: {
                    testRunId: testRun.id,
                    repositoryCaseId: newCase.id,
                    order: 0,
                  },
                });
              } catch (error) {
                // Failed to associate case ${newCase.id} with test run ${testRunName}
                // Continue with other test runs even if one fails
              }
            }
          }
        }

        // Manually sync to Elasticsearch since enhanced Prisma client bypasses extensions
        await syncRepositoryCaseToElasticsearch(newCase.id).catch(
          (error: any) => {
            console.error(
              `Failed to sync repository case ${newCase.id} to Elasticsearch:`,
              error
            );
          }
        );

        importedCount++;
      } catch (error: any) {
        // Failed to import case
        errors.push({
          row: casesToImport.indexOf(caseData) + 1,
          field: "General",
          error: error.message,
        });
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Some cases failed to import", errors, importedCount },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, importedCount });
  } catch (error) {
    // Import error
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

function validateFieldValue(
  value: any,
  field: CaseFields & { type: CaseFieldTypes },
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
      // For CSV import, treat as plain text
      return {
        type: "doc",
        content: [{ type: "paragraph", text: value.toString() }],
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
    case "Multi-select":
      // Would need to validate against field options
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
      // Handle both JSON and plain text formats
      if (typeof value === "string") {
        try {
          // Try to parse as JSON array first
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            return parsed.map((step: any, index: number) => ({
              step:
                typeof step.step === "string"
                  ? {
                      type: "doc",
                      content: [{ type: "paragraph", text: step.step }],
                    }
                  : step.step,
              expectedResult: step.expectedResult
                ? typeof step.expectedResult === "string"
                  ? {
                      type: "doc",
                      content: [
                        { type: "paragraph", text: step.expectedResult },
                      ],
                    }
                  : step.expectedResult
                : null,
              order: index,
            }));
          }
        } catch {
          // Not JSON, treat as plain text
        }
      }
      // Plain text format
      return [
        {
          step: {
            type: "doc",
            content: [{ type: "paragraph", text: value.toString() }],
          },
          expectedResult: null,
          order: 0,
        },
      ];

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
