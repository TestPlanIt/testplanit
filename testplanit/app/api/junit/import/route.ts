import { NextRequest, NextResponse } from "next/server";
import { parseStringPromise } from "xml2js";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { JUnitResultType } from "@prisma/client";
import { progressMessages } from "./progress-messages";
import { auditBulkCreate } from "~/lib/services/auditLog";

// Helper function to find matching status
async function findMatchingStatus(junitStatus: string, projectId: number) {
  // Convert JUnit status to lowercase for case-insensitive comparison
  const statusToFind = junitStatus.toLowerCase();

  // Find status that matches either systemName or aliases
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

export async function POST(request: NextRequest) {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Create a readable stream for progress updates
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

        sendProgress(5, progressMessages.validating);

        // Always get the first enabled, not deleted, workflow of type DONE, scope CASES for the project for cases
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

        // For the test run, use the stateId from the form (stateIdFromForm)
        if (!files.length || !name || !projectId || !defaultCaseStateId) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Missing required fields" })}\n\n`));
          controller.close();
          return;
        }

        sendProgress(10, progressMessages.creatingRun);

        // Only create a new test run if testRunId is not provided
        if (!testRunId) {
          const testRun = await prisma.testRuns.create({
            data: {
              name,
              projectId,
              stateId: stateIdFromForm || defaultCaseStateId,
              configId: configId || null,
              milestoneId: milestoneId || null,
              testRunType: "JUNIT",
              createdById: session.user.id,
              tags:
                tagIds.length > 0
                  ? { connect: tagIds.map((id) => ({ id })) }
                  : undefined,
            },
          });
          testRunId = testRun.id;
        } else {
          // Verify the test run exists and is of type JUNIT
          const existingTestRun = await prisma.testRuns.findUnique({
            where: { id: testRunId },
            select: { testRunType: true },
          });

          if (!existingTestRun) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Test run not found" })}\n\n`));
            controller.close();
            return;
          }

          if (existingTestRun.testRunType !== "JUNIT") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Test run is not of type JUNIT" })}\n\n`));
            controller.close();
            return;
          }
        }

        sendProgress(15, progressMessages.fetchingTemplate);

        // Query the default template processing files/suites/cases
        const template = await prisma.templates.findFirst({
          where: {
            isDefault: true,
          },
        });

        // Process all files
        let caseOrder = 1;
        let totalTestCases = 0;
        let processedTestCases = 0;

        // First pass: count total test cases
        for (const file of files) {
          const xmlContent = await file.text();
          try {
            const result = await parseStringPromise(xmlContent);
            let testSuites: any[] = [];
            
            if (result.testsuites) {
              if (Array.isArray(result.testsuites.testsuite)) {
                testSuites = result.testsuites.testsuite;
              } else if (result.testsuites.testsuite) {
                testSuites = [result.testsuites.testsuite];
              }
            } else if (result.testsuite) {
              if (Array.isArray(result.testsuite)) {
                testSuites = result.testsuite;
              } else {
                testSuites = [result.testsuite];
              }
            }
            
            for (const testSuite of testSuites) {
              if (testSuite && testSuite.$ && parseInt(testSuite.$.tests) > 0) {
                totalTestCases += parseInt(testSuite.$.tests) || 0;
              }
            }
          } catch (e) {
            // Ignore counting errors
          }
        }

        sendProgress(20, progressMessages.countingTests(totalTestCases, files.length));

        // Second pass: process files
        for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
          const file = files[fileIndex];
          const fileProgress = 20 + (fileIndex / files.length) * 70;
          
          sendProgress(fileProgress, progressMessages.parsingFile(fileIndex + 1, files.length));
          
          // Read and parse the XML file
          const xmlContent = await file.text();
          
          let result;
          try {
            result = await parseStringPromise(xmlContent);
          } catch (parseError: any) {
            console.error("XML Parse Error:", parseError);
            sendProgress(fileProgress, progressMessages.errorParsing(fileIndex + 1, parseError.message));
            continue; // Skip this file but continue with others
          }

          if (!result) {
            sendProgress(fileProgress, progressMessages.skippingFile(fileIndex + 1));
            continue;
          }

          // Extract test suites based on XML structure
          let testSuites: any[] = [];

          if (result.testsuites) {
            // console.log("Found testsuites root element");
            // Handle <testsuites> root
            if (Array.isArray(result.testsuites.testsuite)) {
              testSuites = result.testsuites.testsuite;
              // console.log(`Found ${testSuites.length} test suites in array`);
            } else if (result.testsuites.testsuite) {
              testSuites = [result.testsuites.testsuite];
              // console.log("Found single test suite in testsuites");
            }
          } else if (result.testsuite) {
            // console.log("Found testsuite root element");
            // Handle <testsuite> root
            if (Array.isArray(result.testsuite)) {
              testSuites = result.testsuite;
              // console.log(`Found ${testSuites.length} test suites in array`);
            } else {
              testSuites = [result.testsuite];
              // console.log("Found single test suite");
            }
          }

          if (!testSuites.length) {
            continue; // Skip this file but continue processing others
          }

          // Validate test suite structure
          for (const testSuite of testSuites) {
            if (!testSuite || !testSuite.$) {
              console.warn("Invalid test suite structure:", testSuite);
              continue;
            }
          }

          // Process each test suite
          for (let suiteIndex = 0; suiteIndex < testSuites.length; suiteIndex++) {
            const testSuite = testSuites[suiteIndex];
            const suiteProgress = fileProgress + ((suiteIndex + 1) / testSuites.length) * (70 / files.length);
            
            if (!testSuite || !testSuite.$) {
              console.warn("Skipping invalid test suite");
              continue;
            }

            // Skip test suites with 0 tests
            if (parseInt(testSuite.$.tests) === 0) {
              continue;
            }

            const suiteName = testSuite.$.name || "Test Suite";
            sendProgress(suiteProgress, progressMessages.processingSuite(suiteName));

            // Parse suite timestamp once
            const suiteTimestamp = testSuite.$.timestamp
              ? new Date(testSuite.$.timestamp)
              : undefined;

            try {
              // Create the test suite record
              const suite = await prisma.jUnitTestSuite.create({
                data: {
                  name: testSuite.$.name || "Test Suite",
                  time: parseFloat(testSuite.$.time) || 0,
                  tests: parseInt(testSuite.$.tests) || 0,
                  failures: parseInt(testSuite.$.failures) || 0,
                  errors: parseInt(testSuite.$.errors) || 0,
                  skipped: parseInt(testSuite.$.skipped) || 0,
                  timestamp: suiteTimestamp,
                  testRunId: testRunId,
                  createdById: session.user.id,
                },
              });

              // Process test cases
              const testCases = Array.isArray(testSuite.testcase)
                ? testSuite.testcase
                : testSuite.testcase
                  ? [testSuite.testcase]
                  : [];

              // Calculate executedAt for each test case
              let lastExecutedAt: Date | undefined = suiteTimestamp;
              let lastTestCaseTime: number = 0;
              for (let i = 0; i < testCases.length; i++) {
                const testCase = testCases[i];
                processedTestCases++;
                
                // Update progress for each test case
                if (processedTestCases % 10 === 0 || processedTestCases === totalTestCases) {
                  const overallProgress = 20 + (processedTestCases / totalTestCases) * 70;
                  sendProgress(overallProgress, progressMessages.processingCase(processedTestCases, totalTestCases));
                }
                
                if (!testCase || !testCase.$) {
                  console.warn("Skipping invalid test case");
                  continue;
                }

                // Parse test case time (seconds)
                const testCaseTime = parseFloat(testCase.$.time) || 0;

                // Calculate executedAt
                let executedAt: Date | undefined = undefined;
                if (i === 0) {
                  executedAt = suiteTimestamp;
                } else if (lastExecutedAt) {
                  executedAt = new Date(
                    lastExecutedAt.getTime() + lastTestCaseTime * 1000
                  );
                }

                // First, find default repository, folder, and template for the project
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
                // Find or create the suite folder structure under the selected parent folder
                let suiteFolder: any = undefined;
                if (parentFolderId) {
                  // Split the testsuite name by path separators to create nested folders
                  const suiteName = testSuite.$.name || "Test Suite";
                  const pathParts = suiteName.split('/').filter((part: string) => part.length > 0);
                  
                  let currentParentId = parentFolderId;
                  
                  // Create nested folder structure
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
                    
                    // Update parent ID for next iteration
                    currentParentId = folder.id;
                    
                    // Set the final folder as suiteFolder
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
                      name: "JUnit Imports",
                      creatorId: session.user.id,
                    },
                  });
                }
                // Use suiteFolder if parentFolderId is provided, otherwise fallback to folder
                const finalFolder = suiteFolder || folder;
                // Upsert RepositoryCase
                const repositoryCase = await prisma.repositoryCases.upsert({
                  where: {
                    projectId_name_className_source: {
                      projectId: projectId,
                      name: testCase.$.name,
                      className: testCase.$.classname || null,
                      source: "JUNIT",
                    },
                  },
                  update: {
                    automated: true,
                    isDeleted: false,
                    isArchived: false,
                    stateId: defaultCaseStateId,
                    templateId: template?.id || -1,
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
                    templateId: template?.id || -1,
                    name: testCase.$.name,
                    className: testCase.$.classname || null,
                    source: "JUNIT",
                    stateId: defaultCaseStateId,
                    automated: true,
                    creatorId: session.user.id,
                    order: caseOrder,
                    estimate: Math.max(1, Math.round(testCaseTime)),
                    forecastManual: Math.max(1, Math.round(testCaseTime)),
                  },
                });

                // Upsert TestRunCases to link this case to the test run (for testRuns column in UI)
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
                    order: i + 1,
                  },
                });

                try {
                  // --- Status mapping logic ---
                  let resultType: JUnitResultType | undefined;
                  let message: string | undefined;
                  let content: string | undefined;
                  let junitStatus: string | undefined;
                  let matchingStatus = null;

                  if (testCase.failure) {
                    resultType = JUnitResultType.FAILURE;
                    const failure = testCase.failure[0];
                    message = failure.$?.message;
                    content = failure._ || failure.$?.message || "";
                    junitStatus = "failure";
                    matchingStatus = await findMatchingStatus(
                      junitStatus,
                      projectId!
                    );
                  } else if (testCase.error) {
                    resultType = JUnitResultType.ERROR;
                    const error = testCase.error[0];
                    message = error.$?.message;
                    content = error._ || error.$?.message || "";
                    junitStatus = "error";
                    matchingStatus = await findMatchingStatus(
                      junitStatus,
                      projectId!
                    );
                  } else if (testCase.skipped) {
                    resultType = JUnitResultType.SKIPPED;
                    const skipped = testCase.skipped[0];
                    message = skipped.$?.message;
                    content = skipped._ || skipped.$?.message || "";
                    junitStatus = "skipped";
                    matchingStatus = await findMatchingStatus(
                      junitStatus,
                      projectId!
                    );
                  } else {
                    // No explicit status: treat as PASSED
                    resultType = JUnitResultType.PASSED;
                    message = undefined;
                    content = undefined;
                    junitStatus = "passed";
                    matchingStatus = await getPassedStatus(projectId!);
                  }

                  // If no matching status found, use UNTESTED
                  if (!matchingStatus) {
                    matchingStatus = await getUntestedStatus(projectId!);
                  }

                  // Create the JUnit test result
                  await prisma.jUnitTestResult.create({
                    data: {
                      type: resultType,
                      message: message || undefined,
                      content: content || undefined,
                      repositoryCase: { connect: { id: repositoryCase.id } },
                      createdBy: { connect: { id: session.user.id } },
                      status: matchingStatus
                        ? { connect: { id: matchingStatus.id } }
                        : undefined,
                      executedAt: executedAt,
                      testSuite: { connect: { id: suite.id } },
                      time: testCaseTime,
                      assertions: testCase.$.assertions
                        ? parseInt(testCase.$.assertions)
                        : undefined,
                      file: testCase.$.file,
                      line: testCase.$.line ? parseInt(testCase.$.line) : undefined,
                      systemOut: testCase.systemOut
                        ? Array.isArray(testCase.systemOut)
                          ? testCase.systemOut.join("\n")
                          : testCase.systemOut
                        : testCase["system-out"]
                          ? Array.isArray(testCase["system-out"])
                            ? testCase["system-out"].join("\n")
                            : testCase["system-out"]
                          : undefined,
                      systemErr: testCase.systemErr
                        ? Array.isArray(testCase.systemErr)
                          ? testCase.systemErr.join("\n")
                          : testCase.systemErr
                        : testCase["system-err"]
                          ? Array.isArray(testCase["system-err"])
                            ? testCase["system-err"].join("\n")
                            : testCase["system-err"]
                          : undefined,
                    },
                  });

                  // Update the test run case status if we found a matching status
                  if (matchingStatus) {
                    // Find the test run case for this test case
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

                  // Process properties if present
                  if (testCase.properties?.[0]?.property) {
                    const properties = Array.isArray(
                      testCase.properties[0].property
                    )
                      ? testCase.properties[0].property
                      : [testCase.properties[0].property];

                    for (const prop of properties) {
                      if (!prop || !prop.$) {
                        console.warn("Skipping invalid property");
                        continue;
                      }

                      // Check for step properties (step, step[status], etc.)
                      if (prop.$.name && prop.$.name.startsWith("step")) {
                        // Extract status from property name if present (e.g., step[passed])
                        let stepStatus: string | undefined = undefined;
                        const match = prop.$.name.match(/step\[(.*?)\]/);
                        if (match && match[1]) {
                          stepStatus = match[1].toLowerCase();
                        }
                        // Find matching status if status is present
                        let statusId: number | undefined = undefined;
                        if (stepStatus) {
                          const matchingStepStatus = await findMatchingStatus(
                            stepStatus,
                            projectId!
                          );
                          statusId = matchingStepStatus?.id;
                        }
                        const stepData: any = {
                          name: prop.$.name,
                          content: prop.$.value || prop._ || null,
                          repositoryCase: { connect: { id: repositoryCase.id } },
                          createdBy: { connect: { id: session.user.id } },
                        };
                        if (typeof statusId === "number") {
                          stepData.statusId = statusId;
                        }
                        await prisma.jUnitTestStep.create({
                          data: stepData,
                        });
                      } else {
                        await prisma.jUnitProperty.create({
                          data: {
                            name: prop.$.name,
                            value: prop.$.value,
                            repositoryCase: { connect: { id: repositoryCase.id } },
                            createdBy: { connect: { id: session.user.id } },
                          },
                        });
                      }
                    }
                  }
                } catch (error) {
                  console.error("Error processing test case:", error, testCase.$);
                  // Continue with next test case
                }

                // Update lastExecutedAt and lastTestCaseTime for the next test case
                if (executedAt) {
                  lastExecutedAt = executedAt;
                  lastTestCaseTime = testCaseTime;
                }

                caseOrder++;
              }

              // Process suite-level properties if present
              if (testSuite.properties?.[0]?.property) {
                const suiteProperties = Array.isArray(
                  testSuite.properties[0].property
                )
                  ? testSuite.properties[0].property
                  : [testSuite.properties[0].property];

                for (const prop of suiteProperties) {
                  if (!prop || !prop.$) {
                    console.warn("Skipping invalid suite property");
                    continue;
                  }
                  await prisma.jUnitProperty.create({
                    data: {
                      name: prop.$.name,
                      value: prop.$.value,
                      testSuiteId: suite.id,
                      createdById: session.user.id,
                    },
                  });
                }
              }
            } catch (error) {
              console.error("Error processing test suite:", error);
              // Continue with next test suite
            }
          }
        }

        sendProgress(95, progressMessages.finalizing);

        // Audit the JUnit import
        const importedCount = caseOrder - 1;
        if (importedCount > 0) {
          auditBulkCreate("JUnitTestResult", importedCount, projectId, {
            source: "JUnit XML Import",
            testRunId,
            fileCount: files.length,
          }).catch((error) =>
            console.error("[AuditLog] Failed to audit JUnit import:", error)
          );
        }

        // Send completion
        sendProgress(100, progressMessages.completed);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ complete: true, testRunId })}\n\n`));
        controller.close();
      } catch (error: any) {
        console.error("Error importing JUnit XML:", error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message || "Failed to import JUnit XML" })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}