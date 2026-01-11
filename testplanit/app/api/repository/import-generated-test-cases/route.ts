import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { emptyEditorContent } from "~/app/constants/backend";
import { ProjectAccessType } from "@prisma/client";
import { auditBulkCreate } from "~/lib/services/auditLog";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";

interface GeneratedTestCase {
  id: string;
  name: string;
  description?: string;
  steps?: Array<{
    step: string;
    expectedResult: string;
  }>;
  fieldValues: Record<string, any>;
  priority?: string;
  automated: boolean;
}

interface SourceInfo {
  type: "issue" | "document";
  issueId?: string;
  issueKey?: string;
  issueUrl?: string;
  issueTitle?: string;
  documentId?: string;
  documentTitle?: string;
}

interface ImportRequest {
  projectId: number;
  folderId: number;
  templateId: number;
  testCases: GeneratedTestCase[];
  sourceInfo?: SourceInfo;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, folderId, templateId, testCases, sourceInfo } = body as ImportRequest;

    if (!projectId || !folderId || !templateId || !testCases || !Array.isArray(testCases)) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Verify user has access to the project and folder
    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    // Build the project access condition
    // This needs to account for all access paths: userPermissions, groupPermissions,
    // assignedUsers, and project defaultAccessType (GLOBAL_ROLE)
    const projectAccessCondition = isAdmin
      ? {}
      : {
          OR: [
            // Direct user permissions
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Group permissions
            {
              groupPermissions: {
                some: {
                  group: {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Project default GLOBAL_ROLE (any authenticated user with a role)
            {
              defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
            },
            // Direct assignment to project with PROJECTADMIN access
            ...(isProjectAdmin
              ? [
                  {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                ]
              : []),
          ],
        };

    const folder = await prisma.repositoryFolders.findFirst({
      where: {
        id: folderId,
        project: {
          id: projectId,
          isDeleted: false,
          ...projectAccessCondition,
        },
        isDeleted: false,
      },
      include: {
        project: true,
        repository: true,
      },
    });

    if (!folder) {
      return NextResponse.json(
        { error: "Folder not found or access denied" },
        { status: 404 }
      );
    }

    // Verify template exists and is available for this project
    const template = await prisma.templates.findFirst({
      where: {
        id: templateId,
        isDeleted: false,
        projects: {
          some: {
            projectId,
          },
        },
      },
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
          orderBy: {
            order: "asc",
          },
        },
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Template not found or not available for this project" },
        { status: 404 }
      );
    }

    // Get the default workflow state for new test cases
    const defaultWorkflow = await prisma.workflows.findFirst({
      where: {
        isDeleted: false,
        isDefault: true,
        scope: "CASES",
        projects: {
          some: {
            projectId,
          },
        },
      },
    });

    if (!defaultWorkflow) {
      return NextResponse.json(
        { error: "No default workflow found for test cases" },
        { status: 400 }
      );
    }

    // Get current max order for ordering
    const maxOrderCase = await prisma.repositoryCases.findFirst({
      where: {
        folderId: folderId,
      },
      orderBy: {
        order: "desc",
      },
      select: {
        order: true,
      },
    });

    const startOrder = (maxOrderCase?.order || 0) + 1;

    const importedCases: any[] = [];
    const errors: string[] = [];

    // Import each test case
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      
      try {
        // Create the repository case
        const newCase = await prisma.repositoryCases.create({
          data: {
            project: {
              connect: { id: projectId },
            },
            repository: {
              connect: { id: folder.repositoryId },
            },
            folder: {
              connect: { id: folderId },
            },
            name: testCase.name.slice(0, 255), // Ensure it doesn't exceed field limits
            template: {
              connect: { id: templateId },
            },
            state: {
              connect: { id: defaultWorkflow.id },
            },
            creator: {
              connect: { id: session.user.id },
            },
            automated: testCase.automated,
            order: startOrder + i,
            createdAt: new Date(),
          },
        });

        // Create case field values
        for (const caseField of template.caseFields) {
          const fieldKey = caseField.caseField.displayName;
          const fieldValue = testCase.fieldValues[fieldKey] || testCase.fieldValues[caseField.caseField.id.toString()];

          // Removed console.log for production

          if (fieldValue !== undefined && fieldValue !== null) {
            // Handle different field types
            let processedValue = fieldValue;

            switch (caseField.caseField.type.type) {
              case "Text Long":
                // Convert string to TipTap JSON format if it's a string
                if (typeof fieldValue === "string") {
                  processedValue = JSON.stringify({
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: fieldValue }],
                      },
                    ],
                  });
                } else {
                  processedValue = JSON.stringify(fieldValue);
                }
                break;

              case "Dropdown":
              case "Multi-Select":
                // Try to map option names to IDs
                if (Array.isArray(fieldValue)) {
                  processedValue = fieldValue.map(optionName => {
                    const option = caseField.caseField.fieldOptions?.find(
                      fo => fo.fieldOption.name === optionName
                    );
                    return option ? option.fieldOption.id : optionName;
                  });
                } else if (typeof fieldValue === "string") {
                  const option = caseField.caseField.fieldOptions?.find(
                    fo => fo.fieldOption.name === fieldValue
                  );
                  processedValue = option ? option.fieldOption.id : fieldValue;
                }
                break;

              case "Checkbox":
                processedValue = Boolean(fieldValue);
                break;

              case "Integer":
                processedValue = parseInt(fieldValue) || 0;
                break;

              case "Number":
                processedValue = parseFloat(fieldValue) || 0;
                break;

              default:
                // For other types, use as-is
                break;
            }

            await prisma.caseFieldValues.create({
              data: {
                testCase: {
                  connect: { id: newCase.id },
                },
                field: {
                  connect: { id: caseField.caseField.id },
                },
                value: processedValue,
              },
            });
          }
        }

        // Link to external issue if provided
        if (sourceInfo?.type === "issue" && sourceInfo.issueKey) {
          // Test case generated from external issue
          
          // Try to find existing issue with the same external key
          let existingIssue = await prisma.issue.findFirst({
            where: {
              OR: [
                { externalKey: sourceInfo.issueKey },
                { externalId: sourceInfo.issueKey }
              ],
              projectId: projectId
            }
          });

          // If not found, create a new issue
          if (!existingIssue) {
            existingIssue = await prisma.issue.create({
              data: {
                name: sourceInfo.issueKey,
                title: sourceInfo.issueTitle || sourceInfo.issueKey,
                description: `External issue linked from test case generation`,
                externalKey: sourceInfo.issueKey,
                externalId: sourceInfo.issueKey,
                externalUrl: sourceInfo.issueUrl,
                projectId: projectId,
                createdById: session.user.id
              }
            });
          }

          // Link the issue to the test case
          await prisma.repositoryCases.update({
            where: { id: newCase.id },
            data: {
              issues: {
                connect: { id: existingIssue.id }
              }
            }
          });
        } else if (sourceInfo?.type === "document" && sourceInfo.documentTitle) {
          // Test case generated from requirements document
        }

        // Create steps if provided
        if (testCase.steps && Array.isArray(testCase.steps)) {
          for (let stepIndex = 0; stepIndex < testCase.steps.length; stepIndex++) {
            const step = testCase.steps[stepIndex];
            
            const stepContent = JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: step.step }],
                },
              ],
            });

            const expectedResultContent = JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: step.expectedResult }],
                },
              ],
            });

            await prisma.steps.create({
              data: {
                testCase: {
                  connect: { id: newCase.id },
                },
                step: stepContent,
                expectedResult: expectedResultContent,
                order: stepIndex,
              },
            });
          }
        }

        // Create the initial version record using centralized helper
        const resolvedSteps = testCase.steps?.map(step => ({
          step: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: step.step }],
              },
            ],
          },
          expectedResult: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: step.expectedResult }],
              },
            ],
          },
        })) || [];

        // Note: newCase was created with currentVersion: 1 (default)
        // Now create version 1 snapshot
        const newVersion = await createTestCaseVersionInTransaction(prisma, newCase.id, {
          version: 1, // Explicit version 1 for new generated case
          creatorId: session.user.id,
          creatorName: session.user.name || "",
          createdAt: new Date(),
          overrides: {
            name: testCase.name.slice(0, 255),
            stateId: defaultWorkflow.id,
            stateName: defaultWorkflow.name || "",
            automated: testCase.automated,
            steps: resolvedSteps,
            attachments: [], // No attachments for generated cases
            tags: [], // No tags for generated cases initially
            issues: [], // Will be linked separately if needed
          },
        });

        // Create case field version values (using the same processing as above)
        for (const caseField of template.caseFields) {
          const fieldKey = caseField.caseField.displayName;
          const fieldValue = testCase.fieldValues[fieldKey] || testCase.fieldValues[caseField.caseField.id.toString()];

          if (fieldValue !== undefined && fieldValue !== null) {
            // Apply the same processing as for the main case field values
            let processedValue = fieldValue;

            switch (caseField.caseField.type.type) {
              case "Text Long":
                // Convert string to TipTap JSON format if it's a string
                if (typeof fieldValue === "string") {
                  processedValue = JSON.stringify({
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: fieldValue }],
                      },
                    ],
                  });
                } else {
                  processedValue = JSON.stringify(fieldValue);
                }
                break;

              case "Dropdown":
              case "Multi-Select":
                // For version values, we can store the processed array of option IDs
                if (Array.isArray(fieldValue)) {
                  processedValue = fieldValue.map(optionName => {
                    const option = caseField.caseField.fieldOptions?.find(
                      fo => fo.fieldOption.name === optionName
                    );
                    return option ? option.fieldOption.id : optionName;
                  });
                } else if (typeof fieldValue === "string") {
                  const option = caseField.caseField.fieldOptions?.find(
                    fo => fo.fieldOption.name === fieldValue
                  );
                  processedValue = option ? option.fieldOption.id : fieldValue;
                }
                break;

              case "Checkbox":
                processedValue = Boolean(fieldValue);
                break;

              case "Integer":
                processedValue = parseInt(fieldValue) || 0;
                break;

              case "Number":
                processedValue = parseFloat(fieldValue) || 0;
                break;

              default:
                // For other types, use as-is
                break;
            }

            await prisma.caseFieldVersionValues.create({
              data: {
                version: {
                  connect: { id: newVersion.id },
                },
                field: caseField.caseField.displayName,
                value: processedValue,
              },
            });
          }
        }

        importedCases.push({
          id: newCase.id,
          name: newCase.name,
          generatedId: testCase.id,
        });

      } catch (error) {
        console.error(`Error importing test case ${testCase.name}:`, error);
        errors.push(`Failed to import "${testCase.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Audit the bulk import
    if (importedCases.length > 0) {
      auditBulkCreate("RepositoryCases", importedCases.length, projectId, {
        source: "AI Generated Test Cases",
        templateId,
        folderId,
        sourceType: sourceInfo?.type,
        sourceKey: sourceInfo?.issueKey || sourceInfo?.documentTitle,
      }).catch((error) =>
        console.error("[AuditLog] Failed to audit AI test case import:", error)
      );
    }

    return NextResponse.json({
      success: true,
      imported: importedCases.length,
      total: testCases.length,
      cases: importedCases,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error("Error in POST /api/repository/import-generated-test-cases:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to import test cases";
    
    return NextResponse.json(
      {
        error: "Failed to import test cases",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}