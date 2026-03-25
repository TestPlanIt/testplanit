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

import { prisma } from "@/lib/prisma";
import {
  JUnitResultType,
  RepositoryCaseSource,
  TestRunType
} from "@prisma/client";
import { NextRequest } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { auditBulkCreate } from "~/lib/services/auditLog";
import { DuplicateScanService } from "~/lib/services/duplicateScanService";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import {
  countTotalTestCases, detectFormat, extractClassName, FORMAT_TO_RUN_TYPE,
  FORMAT_TO_SOURCE, getExtendedDataKey, isValidFormat, normalizeStatus, parseExtendedTestCaseData, parseTestResults, TestResultFormat, TEST_RESULT_FORMATS, type ExtendedTestCaseDataMap
} from "~/lib/services/testResultsParser";
import { getServerAuthSession } from "~/server/auth";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { progressMessages } from "./progress-messages";

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
  // Try session-based auth first, then fall back to API token auth
  const session = await getServerAuthSession();
  let userId: string | undefined = session?.user?.id;

  if (!userId) {
    const apiAuth = await authenticateApiToken(request);
    if (!apiAuth.authenticated) {
      return new Response(
        JSON.stringify({ error: apiAuth.error, code: apiAuth.errorCode }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    userId = apiAuth.userId;
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
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
        let parentFolderId = formData.get("parentFolderId")
          ? parseInt(formData.get("parentFolderId") as string)
          : undefined;
        const newFolderName = formData.get("newFolderName") as string | null;
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

        console.log(`[TestResultsImport] Received ${files.length} file(s): ${files.map(f => `${f.name} (${f.size} bytes)`).join(', ')}`);
        console.log(`[TestResultsImport] Format: ${format}`);

        // Per-file format detection map (file index -> format)
        const fileFormatMap = new Map<number, TestResultFormat>();

        // Auto-detect format if not specified or set to "auto"
        if (format === "auto" || !format) {
          sendProgress(6, progressMessages.detectingFormat);

          // Detect each file's format individually
          const undetected: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const content = await file.text();
            const detected = detectFormat(content, file.name);
            if (detected) {
              fileFormatMap.set(i, detected);
            } else {
              undetected.push(file.name);
            }
          }

          if (undetected.length > 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: `Unable to auto-detect format for: ${undetected.join(", ")}. Please select the format manually.` })}\n\n`
              )
            );
            controller.close();
            return;
          }

          // All files detected — check if single or mixed formats
          const uniqueFormats = new Set(fileFormatMap.values());
          if (uniqueFormats.size === 1) {
            format = [...uniqueFormats][0];
            sendProgress(
              8,
              progressMessages.formatDetected(
                TEST_RESULT_FORMATS[format as TestResultFormat].label
              )
            );
          } else {
            const labels = [...uniqueFormats].map(f => TEST_RESULT_FORMATS[f].label).join(", ");
            sendProgress(8, `Detected mixed formats: ${labels}`);
          }
        }

        // For explicit (non-auto) format, validate it
        if (format !== "auto" && fileFormatMap.size === 0) {
          if (!isValidFormat(format)) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: `Unsupported format: ${format}` })}\n\n`
              )
            );
            controller.close();
            return;
          }
          // Assign the explicit format to all files
          for (let i = 0; i < files.length; i++) {
            fileFormatMap.set(i, format as TestResultFormat);
          }
        }

        // Determine the primary format (most common, used for test run type)
        const formatCounts = new Map<TestResultFormat, number>();
        for (const fmt of fileFormatMap.values()) {
          formatCounts.set(fmt, (formatCounts.get(fmt) || 0) + 1);
        }
        const primaryFormat = [...formatCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

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

        // Get the default test run workflow state (first RUNS workflow) for the test run
        const runWorkflow = await prisma.workflows.findFirst({
          where: {
            isEnabled: true,
            isDeleted: false,
            workflowType: "DONE",
            scope: "RUNS",
            projects: {
              some: { projectId: projectId },
            },
          },
          orderBy: { order: "asc" },
        });
        const defaultRunStateId = runWorkflow?.id;

        // Name is required when creating a new test run, but optional when appending to existing
        const nameRequired = !testRunId;
        if (
          !files.length ||
          (nameRequired && !name) ||
          !projectId ||
          !defaultCaseStateId ||
          !defaultRunStateId
        ) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Missing required fields" })}\n\n`
            )
          );
          controller.close();
          return;
        }

        sendProgress(10, progressMessages.parsing(primaryFormat));

        // Group files by detected format for parsing
        const filesByFormat = new Map<TestResultFormat, File[]>();
        for (let i = 0; i < files.length; i++) {
          const fmt = fileFormatMap.get(i)!;
          const group = filesByFormat.get(fmt) || [];
          group.push(files[i]);
          filesByFormat.set(fmt, group);
        }

        // Parse each format group and merge results
        // Track which format each suite belongs to for per-suite caseSource
        let result: any = null;
        const errors: string[] = [];
        const allFileContentsForExtended: string[] = [];
        const suiteFormatMap: TestResultFormat[] = [];

        for (const [fmt, fmtFiles] of filesByFormat) {
          try {
            const parsed = await parseTestResults(fmtFiles, fmt);
            if (!result) {
              result = parsed.result;
              // Tag initial suites with their format
              for (let s = 0; s < (parsed.result.suites?.length || 0); s++) {
                suiteFormatMap.push(fmt);
              }
            } else {
              // Merge suites into the first result
              result.total += parsed.result.total;
              result.passed += parsed.result.passed;
              result.failed += parsed.result.failed;
              result.errors += parsed.result.errors;
              result.skipped += parsed.result.skipped;
              result.duration += parsed.result.duration;
              for (let s = 0; s < (parsed.result.suites?.length || 0); s++) {
                suiteFormatMap.push(fmt);
              }
              result.suites = result.suites.concat(parsed.result.suites);
            }
            errors.push(...parsed.errors);
          } catch (parseError: unknown) {
            const message =
              parseError instanceof Error
                ? parseError.message
                : "Unknown parse error";
            errors.push(message);
          }
        }

        if (!result || !result.suites || result.suites.length === 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: progressMessages.errorParsing(errors.join("; ") || "No test results found") })}\n\n`
            )
          );
          controller.close();
          return;
        }

        // Read file contents for extended data parsing (system-out/err, assertions)
        for (const file of files) {
          allFileContentsForExtended.push(await file.text());
        }

        console.log(`[TestResultsImport] Parsed ${files.length} file(s): ${files.map(f => f.name).join(', ')}`);
        console.log(`[TestResultsImport] Result: ${result.suites?.length ?? 0} suites, ${result.total} total test cases`);
        if (errors.length > 0) {
          console.log(`[TestResultsImport] Parse errors: ${errors.join('; ')}`);
        }

        // Parse extended data (system-out, system-err, assertions) that the main parser doesn't expose
        let extendedDataMap: ExtendedTestCaseDataMap = new Map();
        try {
          extendedDataMap = parseExtendedTestCaseData(
            allFileContentsForExtended,
            primaryFormat
          );
        } catch {
          // Non-fatal - extended data is supplementary
          console.warn("Failed to parse extended test case data");
        }

        if (errors.length > 0) {
          sendProgress(12, progressMessages.parseWarnings(errors.length));
        }

        sendProgress(15, progressMessages.creatingRun);

        // Map primary format to run type; caseSource is determined per-suite
        const testRunType = FORMAT_TO_RUN_TYPE[primaryFormat] as TestRunType;

        // Create or verify test run
        if (!testRunId) {
          const testRun = await prisma.testRuns.create({
            data: {
              name,
              projectId,
              stateId: stateIdFromForm || defaultRunStateId,
              configId: configId || null,
              milestoneId: milestoneId || null,
              testRunType: testRunType,
              createdById: userId,
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

        // Track attachment mappings for CLI upload
        const attachmentMappings: Array<{
          suiteName: string;
          testName: string;
          className: string;
          junitTestResultId: number;
          attachments: Array<{ name: string; path: string }>;
        }> = [];

        sendProgress(
          25,
          progressMessages.countingTests(totalTestCases, files.length)
        );

        // Create or reuse a root-level folder if requested
        if (newFolderName && !parentFolderId) {
          const sanitizedFolderName = newFolderName.trim();
          if (sanitizedFolderName.length === 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: "Folder name cannot be empty" })}\n\n`
              )
            );
            controller.close();
            return;
          }

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
          // Reuse existing root folder with the same name, or create new
          let folder = await prisma.repositoryFolders.findFirst({
            where: {
              projectId: projectId,
              repositoryId: repository.id,
              parentId: null,
              name: sanitizedFolderName,
              isDeleted: false,
            },
          });
          if (!folder) {
            folder = await prisma.repositoryFolders.create({
              data: {
                projectId: projectId,
                repositoryId: repository.id,
                name: sanitizedFolderName,
                parentId: null,
                creatorId: userId,
              },
            });
          }
          parentFolderId = folder.id;
        }

        // Process each suite
        for (
          let suiteIndex = 0;
          suiteIndex < (result.suites?.length || 0);
          suiteIndex++
        ) {
          const suite = result.suites[suiteIndex];
          const suiteFormat = suiteFormatMap[suiteIndex] || primaryFormat;
          const caseSource = FORMAT_TO_SOURCE[suiteFormat] as RepositoryCaseSource;
          const suiteProgress =
            25 + (suiteIndex / (result.suites?.length || 1)) * 60;

          sendProgress(
            suiteProgress,
            progressMessages.processingSuite(suite.name || "Test Suite")
          );

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
                createdById: userId,
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

            // Lazily resolve the folder for new test cases in this suite.
            // Folders are only created when a test case doesn't match an existing record,
            // avoiding empty folder trees on re-imports.
            let _suiteFolder: { id: number } | undefined = undefined;
            const getFolderForNewCase = async () => {
              if (_suiteFolder) return _suiteFolder;

              // Build sub-folder hierarchy from suite name
              if (parentFolderId) {
                const suiteName = suite.name || "Test Suite";
                const pathParts = suiteName
                  .split(/[./]/)
                  .filter((part: string) => part.length > 0);

                let currentParentId = parentFolderId;

                for (let i = 0; i < pathParts.length; i++) {
                  const folderName = pathParts[i];

                  const f = await prisma.repositoryFolders.upsert({
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
                      creatorId: userId,
                    },
                  });

                  currentParentId = f.id;

                  if (i === pathParts.length - 1) {
                    _suiteFolder = f;
                  }
                }
              }

              // Fallback: use first existing folder or create a generic one
              if (!_suiteFolder) {
                const existing = await prisma.repositoryFolders.findFirst({
                  where: {
                    projectId: projectId,
                    repositoryId: repository.id,
                    isDeleted: false,
                  },
                  orderBy: { id: "asc" },
                });
                _suiteFolder = existing ?? await prisma.repositoryFolders.create({
                  data: {
                    projectId: projectId,
                    repositoryId: repository.id,
                    name: `${primaryFormat.toUpperCase()} Imports`,
                    creatorId: userId,
                  },
                });
              }

              return _suiteFolder;
            };

            // Process each test case
            for (
              let caseIndex = 0;
              caseIndex < suite.cases.length;
              caseIndex++
            ) {
              const testCase = suite.cases[caseIndex];
              processedTestCases++;

              if (
                processedTestCases % 10 === 0 ||
                processedTestCases === totalTestCases
              ) {
                const overallProgress =
                  25 + (processedTestCases / totalTestCases) * 60;
                sendProgress(
                  overallProgress,
                  progressMessages.processingCase(
                    processedTestCases,
                    totalTestCases
                  )
                );
              }

              const testCaseTime = parseDuration(testCase.duration);
              const className = extractClassName(testCase, suite);
              const normalizedStatus = normalizeStatus(testCase.status);

              // Look up extended data (system-out, system-err, assertions) for this test case
              const extendedDataKey = getExtendedDataKey(
                suite.name || "Test Suite",
                testCase.name,
                className
              );
              const extendedData = extendedDataMap.get(extendedDataKey);

              // Find or create RepositoryCase
              // Match by (projectId, name, className) ignoring source so that
              // re-imports with a different detected format reuse the existing case
              // instead of creating duplicates.
              // When updating existing cases, we intentionally do NOT update folderId
              // to preserve the user's folder organization.
              let repositoryCase = await prisma.repositoryCases.findFirst({
                where: {
                  projectId: projectId,
                  name: testCase.name,
                  className: className,
                  isDeleted: false,
                },
              });

              if (repositoryCase) {
                repositoryCase = await prisma.repositoryCases.update({
                  where: { id: repositoryCase.id },
                  data: {
                    automated: true,
                    isDeleted: false,
                    isArchived: false,
                    stateId: defaultCaseStateId,
                    templateId: template.id,
                    repositoryId: repository.id,
                    creatorId: userId,
                    order: caseOrder,
                    estimate: Math.max(1, Math.round(testCaseTime)),
                    forecastManual: Math.max(1, Math.round(testCaseTime)),
                  },
                });
              } else {
                const folder = await getFolderForNewCase();
                repositoryCase = await prisma.repositoryCases.create({
                  data: {
                    projectId: projectId,
                    repositoryId: repository.id,
                    folderId: folder.id,
                    templateId: template.id,
                    name: testCase.name,
                    className: className,
                    source: caseSource,
                    stateId: defaultCaseStateId,
                    automated: true,
                    creatorId: userId,
                    order: caseOrder,
                    estimate: Math.max(1, Math.round(testCaseTime)),
                    forecastManual: Math.max(1, Math.round(testCaseTime)),
                  },
                });
              }

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
                    matchingStatus = await findMatchingStatus(
                      "failure",
                      projectId
                    );
                    break;
                  case "error":
                    resultType = JUnitResultType.ERROR;
                    matchingStatus = await findMatchingStatus(
                      "error",
                      projectId
                    );
                    break;
                  case "skipped":
                    resultType = JUnitResultType.SKIPPED;
                    matchingStatus = await findMatchingStatus(
                      "skipped",
                      projectId
                    );
                    break;
                  default:
                    resultType = JUnitResultType.PASSED;
                    matchingStatus = await getPassedStatus(projectId);
                }

                if (!matchingStatus) {
                  matchingStatus = await getUntestedStatus(projectId);
                }

                // Create the test result (using JUnitTestResult for all formats)
                const junitTestResult = await prisma.jUnitTestResult.create({
                  data: {
                    type: resultType,
                    message: testCase.failure || undefined,
                    content: testCase.stack_trace || undefined,
                    // Store raw system-out and system-err from extended data
                    systemOut: extendedData?.systemOut || undefined,
                    systemErr: extendedData?.systemErr || undefined,
                    // Store assertions count from extended data
                    assertions: extendedData?.assertions,
                    repositoryCase: { connect: { id: repositoryCase.id } },
                    createdBy: { connect: { id: userId } },
                    status: matchingStatus
                      ? { connect: { id: matchingStatus.id } }
                      : undefined,
                    executedAt: new Date(),
                    testSuite: { connect: { id: dbSuite.id } },
                    time: testCaseTime,
                  },
                });

                // Track attachments for CLI upload (if any)
                if (testCase.attachments && testCase.attachments.length > 0) {
                  attachmentMappings.push({
                    suiteName: suite.name || "Test Suite",
                    testName: testCase.name,
                    className: className,
                    junitTestResultId: junitTestResult.id,
                    attachments: testCase.attachments.map((att: { name: string; path: string }) => ({
                      name: att.name,
                      path: att.path,
                    })),
                  });
                }

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
                      createdBy: { connect: { id: userId } },
                    };
                    if (typeof stepStatusId === "number") {
                      stepData.statusId = stepStatusId;
                    }
                    await prisma.jUnitTestStep.create({
                      data: stepData,
                    });
                  }
                }

                // Note: Attachments from JUnit XML are tracked in attachmentMappings
                // and uploaded via CLI to the Attachments table (linked to junitTestResultId).
                // We no longer create JUnitAttachment records here to avoid showing
                // text paths on the test case page - actual files appear on the test result.
              } catch (error) {
                console.error(
                  "Error processing test case:",
                  error,
                  testCase.name
                );
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
            source: `${primaryFormat.toUpperCase()} Import`,
            testRunId,
            fileCount: files.length,
          }).catch((error) =>
            console.error(
              "[AuditLog] Failed to audit test results import:",
              error
            )
          );
        }

        // Advisory duplicate warnings — never blocks import
        let duplicateWarnings: Array<{ caseName: string; className: string | null; similarTo: Array<{ id: number; name: string; confidence: string }> }> = [];
        try {
          const esClient = getElasticsearchClient();
          if (esClient) {
            const scanService = new DuplicateScanService(prisma, esClient);
            const tenantId = getCurrentTenantId();

            // Collect unique case names from the import (limit 50)
            const caseNames = new Set<string>();
            const caseNameToClassName = new Map<string, string | null>();
            for (const suite of result.suites || []) {
              for (const tc of suite.cases || []) {
                if (caseNames.size >= 50) break;
                caseNames.add(tc.name);
                caseNameToClassName.set(tc.name, extractClassName(tc, suite));
              }
            }

            for (const name of caseNames) {
              const similar = await scanService.findSimilarCases({ name }, projectId, tenantId);
              if (similar.length > 0) {
                const caseIds = similar.slice(0, 3).map(s => s.caseAId === 0 ? s.caseBId : s.caseAId);
                const cases = await prisma.repositoryCases.findMany({ where: { id: { in: caseIds } }, select: { id: true, name: true } });
                duplicateWarnings.push({
                  caseName: name,
                  className: caseNameToClassName.get(name) || null,
                  similarTo: similar.slice(0, 3).map(s => {
                    const caseId = s.caseAId === 0 ? s.caseBId : s.caseAId;
                    const found = cases.find(c => c.id === caseId);
                    return { id: caseId, name: found?.name || `Case #${caseId}`, confidence: s.confidence };
                  }),
                });
              }
            }
          }
        } catch (e) {
          console.warn("Duplicate check during test-results import failed (non-blocking):", e);
        }

        sendProgress(100, progressMessages.completed);

        // Include attachment mappings and duplicate warnings in response for CLI
        const responseData: {
          complete: true;
          testRunId: number;
          attachmentMappings?: typeof attachmentMappings;
          duplicateWarnings?: typeof duplicateWarnings;
        } = { complete: true, testRunId };

        // Only include mappings if there are attachments to upload
        if (attachmentMappings.length > 0) {
          responseData.attachmentMappings = attachmentMappings;
        }
        if (duplicateWarnings.length > 0) {
          responseData.duplicateWarnings = duplicateWarnings;
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(responseData)}\n\n`)
        );
        controller.close();
      } catch (error: unknown) {
        console.error("Error importing test results:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to import test results";
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
