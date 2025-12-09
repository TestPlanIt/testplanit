/**
 * Test Results Import API Route
 *
 * Supports importing test results from multiple formats:
 * - JUnit XML
 * - TestNG XML
 * - xUnit XML
 * - NUnit XML
 * - MSTest TRX
 * - Mocha JSON
 * - Cucumber JSON
 */

import { NextRequest } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { JUnitResultType, RepositoryCaseSource, TestRunType } from "@prisma/client";
import { progressMessages } from "./progress-messages";
import { auditBulkCreate } from "~/lib/services/auditLog";
import {
  parseTestResults,
  isValidFormat,
  TestResultFormat,
  FORMAT_TO_RUN_TYPE,
  FORMAT_TO_SOURCE,
  normalizeStatus,
  countTotalTestCases,
  extractClassName,
  detectFormatFromFiles,
  TEST_RESULT_FORMATS,
} from "~/lib/services/testResultsParser";

// Helper function to find matching status
async function findMatchingStatus(junitStatus: string, projectId: number) {
  const statusToFind = junitStatus.toLowerCase();

  const status = await prisma.status.findFirst({
    where: {
      isEnabled: true,
      isDeleted: false,
      projects: {
        some: {
          projectId: projectId,
        },
      },
      scope: {
        some: {
          scope: {
            name: "Automation",
          },
        },
      },
      OR: [
        { systemName: { equals: statusToFind, mode: "insensitive" } },
        { aliases: { contains: statusToFind } },
      ],
    },
    include: { color: true },
  });

  return status;
}

// Helper to get the PASSED status for the project
async function getPassedStatus(projectId: number) {
  return prisma.status.findFirst({
    where: {
      isEnabled: true,
      isDeleted: false,
      isSuccess: true,
      projects: { some: { projectId } },
      scope: { some: { scope: { name: "Automation" } } },
    },
    include: { color: true },
  });
}

// Helper to get the UNTESTED status for the project
async function getUntestedStatus(projectId: number) {
  return prisma.status.findFirst({
    where: {
      isEnabled: true,
      isDeleted: false,
      systemName: { equals: "untested", mode: "insensitive" },
      projects: { some: { projectId } },
      scope: { some: { scope: { name: "Automation" } } },
    },
    include: { color: true },
  });
}

// Helper to safely parse duration values to numbers
// The test-results-parser library sometimes returns duration as a string
// (especially for MSTest where it can be a concatenated string like "0456.0000234.0000...")
function parseDuration(duration: unknown): number {
  if (typeof duration === "number") {
    return isNaN(duration) ? 0 : duration;
  }
  if (typeof duration === "string") {
    // Try to parse as a simple number first
    const parsed = parseFloat(duration);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export async function POST(request: NextRequest) {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (progress: number, status: string) => {
        const data = JSON.stringify({ progress, status });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        const formData = await request.formData();
        const files = formData.getAll("files") as File[];
        let format = (formData.get("format") as string) || "auto";
        let testRunId = parseInt(formData.get("testRunId") as string);
        const name = formData.get("name") as string;
        const configId = formData.get("configId")
          ? parseInt(formData.get("configId") as string)
          : undefined;
        const milestoneId = formData.get("milestoneId")
          ? parseInt(formData.get("milestoneId") as string)
          : undefined;
        const stateIdFromForm = formData.get("stateId")
          ? parseInt(formData.get("stateId") as string)
          : undefined;
        const parentFolderId = formData.get("parentFolderId")
          ? parseInt(formData.get("parentFolderId") as string)
          : undefined;
        const tagIds = formData
          .getAll("tagIds")
          .map((id) => parseInt(id as string))
          .filter(Boolean);
        const projectId = formData.get("projectId")
          ? parseInt(formData.get("projectId") as string)
          : undefined;
        const templateId = formData.get("templateId")
          ? parseInt(formData.get("templateId") as string)
          : undefined;

        sendProgress(5, progressMessages.validating);

        // Auto-detect format if not specified or set to "auto"
        if (format === "auto" || !format) {
          sendProgress(6, progressMessages.detectingFormat);

          // Read file contents for detection
          const fileContents = await Promise.all(
            files.map(async (file) => ({
              content: await file.text(),
              name: file.name,
            }))
          );

          const detectedFormat = detectFormatFromFiles(fileContents);

          if (!detectedFormat) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: "Unable to auto-detect file format. Please select the format manually." })}\n\n`
              )
            );
            controller.close();
            return;
          }

          format = detectedFormat;
          sendProgress(8, progressMessages.formatDetected(TEST_RESULT_FORMATS[detectedFormat].label));
        }

        // Validate format
        if (!isValidFormat(format)) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: `Unsupported format: ${format}` })}\n\n`
            )
          );
          controller.close();
          return;
        }

        const validFormat = format as TestResultFormat;

        // Get the case workflow state (DONE) for imported test cases
        const caseWorkflow = await prisma.workflows.findFirst({
          where: {
            isEnabled: true,
            isDeleted: false,
            workflowType: "DONE",
            scope: "CASES",
            projects: {
              some: { projectId: projectId },
            },
          },
          orderBy: { order: "asc" },
        });
        const defaultCaseStateId = caseWorkflow?.id;

        if (!files.length || !name || !projectId || !defaultCaseStateId) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Missing required fields" })}\n\n`
            )
          );
          controller.close();
          return;
        }

        sendProgress(10, progressMessages.parsing(validFormat));

        // Parse the files using the new parser
        let parsedResults;
        try {
          parsedResults = await parseTestResults(files, validFormat);
        } catch (parseError: unknown) {
          const message = parseError instanceof Error ? parseError.message : "Unknown parse error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: progressMessages.errorParsing(message) })}\n\n`
            )
          );
          controller.close();
          return;
        }

        const { result, errors } = parsedResults;

        if (errors.length > 0) {
          sendProgress(12, progressMessages.parseWarnings(errors.length));
        }

        sendProgress(15, progressMessages.creatingRun);

        // Map format to run type and source
        const testRunType = FORMAT_TO_RUN_TYPE[validFormat] as TestRunType;
        const caseSource = FORMAT_TO_SOURCE[validFormat] as RepositoryCaseSource;

        // Create or verify test run
        if (!testRunId) {
          const testRun = await prisma.testRuns.create({
            data: {
              name,
              projectId,
              stateId: stateIdFromForm || defaultCaseStateId,
              configId: configId || null,
              milestoneId: milestoneId || null,
              testRunType: testRunType,
              createdById: session.user.id,
              tags:
                tagIds.length > 0
                  ? { connect: tagIds.map((id) => ({ id })) }
                  : undefined,
            },
          });
          testRunId = testRun.id;
        } else {
          const existingTestRun = await prisma.testRuns.findUnique({
            where: { id: testRunId },
            select: { testRunType: true },
          });

          if (!existingTestRun) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: "Test run not found" })}\n\n`
              )
            );
            controller.close();
            return;
          }

          if (existingTestRun.testRunType !== testRunType) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: `Test run is not of type ${testRunType}` })}\n\n`
              )
            );
            controller.close();
            return;
          }
        }

        sendProgress(20, progressMessages.fetchingTemplate);

        // Use provided templateId or fall back to the default template
        let template;
        if (templateId) {
          template = await prisma.templates.findUnique({
            where: { id: templateId },
          });
        }
        if (!template) {
          template = await prisma.templates.findFirst({
            where: { isDefault: true },
          });
        }

        if (!template) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "No template found. Please select a template or configure a default template before importing test results." })}\n\n`
            )
          );
          controller.close();
          return;
        }

        // Count total test cases for progress
        const totalTestCases = countTotalTestCases(result);
        let processedTestCases = 0;
        let caseOrder = 1;

        sendProgress(25, progressMessages.countingTests(totalTestCases, files.length));

        // Process each suite
        for (let suiteIndex = 0; suiteIndex < (result.suites?.length || 0); suiteIndex++) {
          const suite = result.suites[suiteIndex];
          const suiteProgress = 25 + (suiteIndex / (result.suites?.length || 1)) * 60;

          sendProgress(suiteProgress, progressMessages.processingSuite(suite.name || "Test Suite"));

          // Skip empty suites
          if (!suite.cases || suite.cases.length === 0) {
            continue;
          }

          try {
            // Create the test suite record (using JUnitTestSuite for all formats)
            const dbSuite = await prisma.jUnitTestSuite.create({
              data: {
                name: suite.name || "Test Suite",
                time: parseDuration(suite.duration),
                tests: suite.total || suite.cases.length,
                failures: suite.failed || 0,
                errors: suite.errors || 0,
                skipped: suite.skipped || 0,
                timestamp: new Date(),
                testRunId: testRunId,
                createdById: session.user.id,
              },
            });

            // Get or create repository and folder
            let repository = await prisma.repositories.findFirst({
              where: {
                projectId: projectId,
                isActive: true,
                isDeleted: false,
                isArchived: false,
              },
              orderBy: { id: "asc" },
            });
            if (!repository) {
              repository = await prisma.repositories.create({
                data: {
                  projectId: projectId,
                  isActive: true,
                  isDeleted: false,
                  isArchived: false,
                },
              });
            }

            // Find or create folder structure
            // Split suite name by both "/" and "." to create nested folders
            // This handles:
            // - Forward slashes (Cucumber features, Mocha describe blocks)
            // - Dots (NUnit/xUnit/MSTest namespaces like "MyApp.Tests.CalculatorTests")
            let suiteFolder: { id: number } | undefined = undefined;
            if (parentFolderId) {
              const suiteName = suite.name || "Test Suite";
              const pathParts = suiteName.split(/[./]/).filter((part: string) => part.length > 0);

              let currentParentId = parentFolderId;

              for (let i = 0; i < pathParts.length; i++) {
                const folderName = pathParts[i];

                const folder = await prisma.repositoryFolders.upsert({
                  where: {
                    projectId_repositoryId_parentId_name_isDeleted: {
                      projectId: projectId,
                      repositoryId: repository.id,
                      parentId: currentParentId,
                      name: folderName,
                      isDeleted: false,
                    },
                  },
                  update: {},
                  create: {
                    projectId: projectId,
                    repositoryId: repository.id,
                    parentId: currentParentId,
                    name: folderName,
                    creatorId: session.user.id,
                  },
                });

                currentParentId = folder.id;

                if (i === pathParts.length - 1) {
                  suiteFolder = folder;
                }
              }
            }

            let folder = await prisma.repositoryFolders.findFirst({
              where: {
                projectId: projectId,
                repositoryId: repository.id,
                isDeleted: false,
              },
              orderBy: { id: "asc" },
            });
            if (!folder) {
              folder = await prisma.repositoryFolders.create({
                data: {
                  projectId: projectId,
                  repositoryId: repository.id,
                  name: `${validFormat.toUpperCase()} Imports`,
                  creatorId: session.user.id,
                },
              });
            }

            const finalFolder = suiteFolder || folder;

            // Process each test case
            for (let caseIndex = 0; caseIndex < suite.cases.length; caseIndex++) {
              const testCase = suite.cases[caseIndex];
              processedTestCases++;

              if (processedTestCases % 10 === 0 || processedTestCases === totalTestCases) {
                const overallProgress = 25 + (processedTestCases / totalTestCases) * 60;
                sendProgress(
                  overallProgress,
                  progressMessages.processingCase(processedTestCases, totalTestCases)
                );
              }

              const testCaseTime = parseDuration(testCase.duration);
              const className = extractClassName(testCase, suite);
              const normalizedStatus = normalizeStatus(testCase.status);

              // Upsert RepositoryCase
              // className is used as part of the composite unique key to identify test cases
              // For JUnit: fully qualified class name, for Cucumber: feature name, etc.
              const repositoryCase = await prisma.repositoryCases.upsert({
                where: {
                  projectId_name_className_source: {
                    projectId: projectId,
                    name: testCase.name,
                    className: className,
                    source: caseSource,
                  },
                },
                update: {
                  automated: true,
                  isDeleted: false,
                  isArchived: false,
                  stateId: defaultCaseStateId,
                  templateId: template.id,
                  folderId: finalFolder.id,
                  repositoryId: repository.id,
                  creatorId: session.user.id,
                  order: caseOrder,
                  estimate: Math.max(1, Math.round(testCaseTime)),
                  forecastManual: Math.max(1, Math.round(testCaseTime)),
                },
                create: {
                  projectId: projectId,
                  repositoryId: repository.id,
                  folderId: finalFolder.id,
                  templateId: template.id,
                  name: testCase.name,
                  className: className,
                  source: caseSource,
                  stateId: defaultCaseStateId,
                  automated: true,
                  creatorId: session.user.id,
                  order: caseOrder,
                  estimate: Math.max(1, Math.round(testCaseTime)),
                  forecastManual: Math.max(1, Math.round(testCaseTime)),
                },
              });

              // Upsert TestRunCases
              await prisma.testRunCases.upsert({
                where: {
                  testRunId_repositoryCaseId: {
                    testRunId: testRunId,
                    repositoryCaseId: repositoryCase.id,
                  },
                },
                update: {},
                create: {
                  testRunId: testRunId,
                  repositoryCaseId: repositoryCase.id,
                  order: caseOrder,
                },
              });

              try {
                // Map status to result type and find matching project status
                let resultType: JUnitResultType;
                let matchingStatus = null;

                switch (normalizedStatus) {
                  case "failed":
                    resultType = JUnitResultType.FAILURE;
                    matchingStatus = await findMatchingStatus("failure", projectId);
                    break;
                  case "error":
                    resultType = JUnitResultType.ERROR;
                    matchingStatus = await findMatchingStatus("error", projectId);
                    break;
                  case "skipped":
                    resultType = JUnitResultType.SKIPPED;
                    matchingStatus = await findMatchingStatus("skipped", projectId);
                    break;
                  default:
                    resultType = JUnitResultType.PASSED;
                    matchingStatus = await getPassedStatus(projectId);
                }

                if (!matchingStatus) {
                  matchingStatus = await getUntestedStatus(projectId);
                }

                // Create the test result (using JUnitTestResult for all formats)
                await prisma.jUnitTestResult.create({
                  data: {
                    type: resultType,
                    message: testCase.failure || undefined,
                    content: testCase.stack_trace || undefined,
                    repositoryCase: { connect: { id: repositoryCase.id } },
                    createdBy: { connect: { id: session.user.id } },
                    status: matchingStatus
                      ? { connect: { id: matchingStatus.id } }
                      : undefined,
                    executedAt: new Date(),
                    testSuite: { connect: { id: dbSuite.id } },
                    time: testCaseTime,
                  },
                });

                // Update test run case status
                if (matchingStatus) {
                  const testRunCase = await prisma.testRunCases.findFirst({
                    where: {
                      testRunId: testRunId,
                      repositoryCaseId: repositoryCase.id,
                    },
                  });

                  if (testRunCase) {
                    await prisma.testRunCases.update({
                      where: { id: testRunCase.id },
                      data: {
                        statusId: matchingStatus.id,
                        isCompleted: true,
                        completedAt: new Date(),
                      },
                    });
                  }
                }

                // Process test steps if available
                if (testCase.steps && testCase.steps.length > 0) {
                  for (const step of testCase.steps) {
                    const stepStatus = normalizeStatus(step.status);
                    let stepStatusId: number | undefined = undefined;

                    if (stepStatus !== "passed") {
                      const matchingStepStatus = await findMatchingStatus(
                        stepStatus,
                        projectId
                      );
                      stepStatusId = matchingStepStatus?.id;
                    }

                    const stepData: any = {
                      name: step.name,
                      content: step.failure || null,
                      repositoryCase: { connect: { id: repositoryCase.id } },
                      createdBy: { connect: { id: session.user.id } },
                    };
                    if (typeof stepStatusId === "number") {
                      stepData.statusId = stepStatusId;
                    }
                    await prisma.jUnitTestStep.create({
                      data: stepData,
                    });
                  }
                }

                // Process attachments if available
                if (testCase.attachments && testCase.attachments.length > 0) {
                  for (const attachment of testCase.attachments) {
                    await prisma.jUnitAttachment.create({
                      data: {
                        name: attachment.name,
                        value: attachment.path,
                        type: "FILE",
                        repositoryCase: { connect: { id: repositoryCase.id } },
                        createdBy: { connect: { id: session.user.id } },
                      },
                    });
                  }
                }
              } catch (error) {
                console.error("Error processing test case:", error, testCase.name);
                // Continue with next test case
              }

              caseOrder++;
            }
          } catch (error) {
            console.error("Error processing test suite:", error);
            // Continue with next test suite
          }
        }

        sendProgress(90, progressMessages.finalizing);

        // Audit the import
        const importedCount = caseOrder - 1;
        if (importedCount > 0) {
          auditBulkCreate("JUnitTestResult", importedCount, projectId, {
            source: `${validFormat.toUpperCase()} Import`,
            testRunId,
            fileCount: files.length,
          }).catch((error) =>
            console.error("[AuditLog] Failed to audit test results import:", error)
          );
        }

        sendProgress(100, progressMessages.completed);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ complete: true, testRunId })}\n\n`
          )
        );
        controller.close();
      } catch (error: unknown) {
        console.error("Error importing test results:", error);
        const message = error instanceof Error ? error.message : "Failed to import test results";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
        );
        controller.close();
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
