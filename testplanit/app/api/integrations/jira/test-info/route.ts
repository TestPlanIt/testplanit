import { NextRequest, NextResponse } from "next/server";
import { prisma as db } from "@/lib/prisma";
import { IntegrationProvider } from "@prisma/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const issueKey = searchParams.get("issueKey");
  const issueId = searchParams.get("issueId");

  if (!issueKey && !issueId) {
    return NextResponse.json(
      { error: "issueKey or issueId is required" },
      { status: 400 }
    );
  }

  // Add CORS headers for Atlassian Forge
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    // For now, we'll allow unauthenticated access from Forge
    // In production, implement proper JWT validation

    // Test-info request received

    // Get the first status (typically "Untested" or similar) for test cases with no results
    const firstStatus = await db.status.findFirst({
      where: {
        isDeleted: false,
      },
      orderBy: {
        order: "asc",
      },
      include: {
        color: true,
      },
    });

    // Find the issue in our database
    // Searching for issue with key/id

    // Issue creation should now set correct integrationId via DeferredIssueManager

    // Find ALL issues with matching key (there may be duplicates)
    // Starting database query
    let allMatchingIssues;
    
    try {
      allMatchingIssues = await db.issue.findMany({
        where: {
          OR: [
            { name: issueKey || "" },
            { externalId: issueId || "" },
            { externalKey: issueKey || "" }, // Also search by externalKey
          ],
          integration: {
            provider: IntegrationProvider.JIRA,
          },
        },
      include: {
        repositoryCases: {
          include: {
            state: {
              select: {
                name: true,
                icon: {
                  select: {
                    name: true,
                  },
                },
                color: {
                  select: {
                    value: true,
                  },
                },
              },
            },
            project: {
              select: {
                id: true,
              },
            },
            testRuns: {
              include: {
                testRun: {
                  select: {
                    id: true,
                    name: true,
                    isCompleted: true,
                  },
                },
                results: {
                  include: {
                    status: {
                      select: {
                        name: true,
                        color: {
                          select: {
                            value: true,
                          },
                        },
                      },
                    },
                    executedBy: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                    editedBy: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                  orderBy: {
                    executedAt: "desc",
                  },
                  take: 5,
                  where: {
                    isDeleted: false,
                  },
                },
              },
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        },
        sessions: {
          select: {
            id: true,
            name: true,
            estimate: true,
            isDeleted: true,
            state: {
              select: {
                name: true,
                icon: {
                  select: {
                    name: true,
                  },
                },
                color: {
                  select: {
                    value: true,
                  },
                },
              },
            },
            project: {
              select: {
                id: true,
              },
            },
            sessionResults: {
              include: {
                status: {
                  include: {
                    color: true,
                  },
                },
              },
              orderBy: {
                createdAt: "asc",
              },
              where: {
                isDeleted: false,
              },
            },
          },
        },
        testRuns: {
          include: {
            state: {
              select: {
                name: true,
                icon: {
                  select: {
                    name: true,
                  },
                },
                color: {
                  select: {
                    value: true,
                  },
                },
              },
            },
            project: {
              select: {
                id: true,
              },
            },
            testCases: {
              include: {
                repositoryCase: {
                  select: {
                    id: true,
                    name: true,
                    estimate: true,
                  },
                },
                status: {
                  include: {
                    color: true,
                  },
                },
                results: {
                  include: {
                    status: {
                      include: {
                        color: true,
                      },
                    },
                    executedBy: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                  orderBy: {
                    executedAt: "desc",
                  },
                  where: {
                    isDeleted: false,
                  },
                },
              },
              orderBy: {
                order: "asc",
              },
            },
          },
        },
        // Test runs connected through test run results
        testRunResults: {
          include: {
            testRun: {
              include: {
                state: {
                  select: {
                    name: true,
                    icon: {
                      select: {
                        name: true,
                      },
                    },
                    color: {
                      select: {
                        value: true,
                      },
                    },
                  },
                },
                project: {
                  select: {
                    id: true,
                  },
                },
                testCases: {
                  include: {
                    repositoryCase: {
                      select: {
                        id: true,
                        name: true,
                        estimate: true,
                      },
                    },
                    status: {
                      include: {
                        color: true,
                      },
                    },
                    results: {
                      include: {
                        status: {
                          include: {
                            color: true,
                          },
                        },
                        executedBy: {
                          select: {
                            id: true,
                            name: true,
                          },
                        },
                      },
                      orderBy: {
                        executedAt: "desc",
                      },
                      where: {
                        isDeleted: false,
                      },
                    },
                  },
                  orderBy: {
                    order: "asc",
                  },
                },
              },
            },
          },
        },
        // Test runs connected through test run step results
        testRunStepResults: {
          include: {
            testRunResult: {
              include: {
                testRun: {
                  include: {
                    state: {
                      select: {
                        name: true,
                        icon: {
                          select: {
                            name: true,
                          },
                        },
                        color: {
                          select: {
                            value: true,
                          },
                        },
                      },
                    },
                    project: {
                      select: {
                        id: true,
                      },
                    },
                    testCases: {
                      include: {
                        repositoryCase: {
                          select: {
                            id: true,
                            name: true,
                            estimate: true,
                          },
                        },
                        status: {
                          include: {
                            color: true,
                          },
                        },
                        results: {
                          include: {
                            status: {
                              include: {
                                color: true,
                              },
                            },
                            executedBy: {
                              select: {
                                id: true,
                                name: true,
                              },
                            },
                          },
                          orderBy: {
                            executedAt: "desc",
                          },
                          where: {
                            isDeleted: false,
                          },
                        },
                      },
                      orderBy: {
                        order: "asc",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // Sessions connected through session results
        sessionResults: {
          include: {
            session: {
              include: {
                state: {
                  select: {
                    name: true,
                    icon: {
                      select: {
                        name: true,
                      },
                    },
                    color: {
                      select: {
                        value: true,
                      },
                    },
                  },
                },
                project: {
                  select: {
                    id: true,
                  },
                },
                sessionResults: {
                  include: {
                    status: {
                      include: {
                        color: true,
                      },
                    },
                  },
                  orderBy: {
                    createdAt: "asc",
                  },
                  where: {
                    isDeleted: false,
                  },
                },
              },
            },
          },
        },
      },
      });
    } catch (dbError) {
      console.error('Database query failed:', dbError);
      return NextResponse.json(
        { error: "Database query failed", details: dbError instanceof Error ? dbError.message : String(dbError) },
        { status: 500, headers }
      );
    }

    // Found matching issues

    // console.log('Found matching issues:', allMatchingIssues.map(issue => ({
    //   id: issue.id,
    //   name: issue.name,
    //   externalKey: issue.externalKey,
    //   externalId: issue.externalId,
    //   testCasesCount: issue.repositoryCases.length,
    //   sessionsCount: issue.sessions.length,
    //   directTestRunsCount: issue.testRuns.length,
    //   testRunResultsCount: issue.testRunResults?.length || 0,
    //   testRunStepResultsCount: issue.testRunStepResults?.length || 0,
    //   sessionResultsCount: issue.sessionResults?.length || 0
    // })));

    // Aggregate data from all matching issues
    const issue =
      allMatchingIssues.length > 0
        ? {
            id: allMatchingIssues[0].id, // Use first issue for basic info
            name: allMatchingIssues[0].name,
            externalKey: allMatchingIssues[0].externalKey,
            externalId: allMatchingIssues[0].externalId,
            // Combine all relationships from all matching issues
            repositoryCases: allMatchingIssues.flatMap(
              (i) => i.repositoryCases
            ),
            sessions: allMatchingIssues.flatMap((i) => i.sessions),
            testRuns: allMatchingIssues.flatMap((i) => i.testRuns),
            testRunResults: allMatchingIssues.flatMap(
              (i) => i.testRunResults || []
            ),
            testRunStepResults: allMatchingIssues.flatMap(
              (i) => i.testRunStepResults || []
            ),
            sessionResults: allMatchingIssues.flatMap(
              (i) => i.sessionResults || []
            ),
          }
        : null;

    // Log details for debugging
    if (issue) {
      // console.log('Test Cases found:', issue.repositoryCases.map((tc: any) => ({
      //   id: tc.id,
      //   name: tc.name,
      //   projectId: tc.project?.id,
      //   source: tc.source,
      //   isDeleted: tc.isDeleted,
      //   isArchived: tc.isArchived
      // })));
      // console.log('Sessions found:', issue.sessions.map((s: any) => ({
      //   id: s.id,
      //   name: s.name,
      //   projectId: s.project?.id,
      //   isDeleted: s.isDeleted
      // })));
      // console.log('Direct Test Runs found:', issue.testRuns.map((tr: any) => ({
      //   id: tr.id,
      //   name: tr.name,
      //   projectId: tr.project?.id,
      //   isDeleted: tr.isDeleted
      // })));
      // console.log('Test Runs from Results found:', issue.testRunResults?.map((result: any) => result.testRun ? ({
      //   id: result.testRun.id,
      //   name: result.testRun.name,
      //   projectId: result.testRun.project?.id,
      //   isDeleted: result.testRun.isDeleted,
      //   source: 'testRunResult'
      // }) : null).filter(Boolean) || []);
      // console.log('Test Runs from Step Results found:', issue.testRunStepResults?.map((stepResult: any) => stepResult.testRunResult?.testRun ? ({
      //   id: stepResult.testRunResult.testRun.id,
      //   name: stepResult.testRunResult.testRun.name,
      //   projectId: stepResult.testRunResult.testRun.project?.id,
      //   isDeleted: stepResult.testRunResult.testRun.isDeleted,
      //   source: 'testRunStepResult'
      // }) : null).filter(Boolean) || []);
      // console.log('Sessions from Session Results found:', issue.sessionResults?.map((result: any) => result.session ? ({
      //   id: result.session.id,
      //   name: result.session.name,
      //   projectId: result.session.project?.id,
      //   isDeleted: result.session.isDeleted,
      //   source: 'sessionResult'
      // }) : null).filter(Boolean) || []);
    }

    if (!issue) {
      return NextResponse.json(
        {
          testCases: [],
          sessions: [],
          testRuns: [],
        },
        { headers }
      );
    }

    const formattedTestCases = issue.repositoryCases.map((testCase: any) => {
      // Collect all results from all test runs for this case
      const allResults =
        testCase.testRuns?.flatMap(
          (testRunCase: any) => testRunCase.results || []
        ) || [];

      // Sort by executedAt descending to get the latest result
      allResults.sort(
        (a: any, b: any) =>
          new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
      );

      const latestResult = allResults.length > 0 ? allResults[0] : null;

      return {
        id: testCase.id,
        name: testCase.name,
        status: testCase.state.name,
        statusIcon: testCase.state.icon?.name,
        statusColor: testCase.state.color?.value,
        projectId: testCase.project.id,
        isDeleted: testCase.isDeleted,
        isArchived: testCase.isArchived,
        source: testCase.source,
        estimate: testCase.estimate,
        forecastManual: testCase.forecastManual,
        forecastAutomated: testCase.forecastAutomated,
        // Use latest result if available, otherwise use the first status from database
        lastResult: latestResult
          ? latestResult.status.name
          : firstStatus?.name || null,
        lastResultColor: latestResult
          ? latestResult.status.color?.value
          : firstStatus?.color?.value || null,
        resultHistory: allResults.slice(0, 5).map((result: any) => {
          // Find the test run case that this result belongs to
          const testRunCase = testCase.testRuns?.find((trc: any) =>
            trc.results?.some((r: any) => r.id === result.id)
          );

          return {
            resultId: result.id,
            testRunId: testRunCase?.testRun?.id,
            testRunName: testRunCase?.testRun?.name || "Unknown Test Run",
            testRunIsCompleted: testRunCase?.testRun?.isCompleted || false,
            testRunCaseId: testRunCase?.id,
            status: result.status.name,
            statusColor: result.status.color?.value,
            executedAt: result.executedAt,
            executedBy: {
              id: result.executedBy?.id,
              name: result.executedBy?.name || "Unknown",
            },
            editedAt: result.editedAt,
            editedBy: result.editedBy
              ? {
                  id: result.editedBy.id,
                  name: result.editedBy.name,
                }
              : null,
            elapsed: result.elapsed,
            testRunCaseVersion: result.testRunCaseVersion || 1,
            attempt: result.attempt || 1,
          };
        }),
      };
    });

    // Collect all unique test runs from different sources
    const allTestRuns = new Map();

    // Add direct test runs
    issue.testRuns.forEach((testRun: any) => {
      allTestRuns.set(testRun.id, testRun);
    });

    // Add test runs from test run results
    issue.testRunResults?.forEach((result: any) => {
      if (result.testRun) {
        allTestRuns.set(result.testRun.id, result.testRun);
      }
    });

    // Add test runs from test run step results
    issue.testRunStepResults?.forEach((stepResult: any) => {
      if (stepResult.testRunResult?.testRun) {
        allTestRuns.set(
          stepResult.testRunResult.testRun.id,
          stepResult.testRunResult.testRun
        );
      }
    });

    // console.log('All unique test runs found:', Array.from(allTestRuns.keys()));

    // Collect all unique sessions from different sources
    const allSessions = new Map();

    // Add direct sessions
    issue.sessions.forEach((session: any) => {
      allSessions.set(session.id, session);
    });

    // Add sessions from session results
    issue.sessionResults?.forEach((result: any) => {
      if (result.session) {
        allSessions.set(result.session.id, result.session);
      }
    });

    // console.log('All unique sessions found:', Array.from(allSessions.keys()));

    const formattedSessions = Array.from(allSessions.values()).map(
      (session: any) => {
        // Process session results similar to SessionResultsSummary
        const sessionResults = session.sessionResults || [];

        // Calculate total elapsed time
        const totalElapsed = sessionResults.reduce(
          (acc: number, result: any) => acc + (result.elapsed || 0),
          0
        );
        const hasElapsed = totalElapsed > 0;

        // Count statuses for summary text
        const statusCounts: Record<string, { name: string; count: number }> =
          {};
        sessionResults.forEach((result: any) => {
          const statusName = result.status?.name || "Recorded";
          if (!statusCounts[statusName]) {
            statusCounts[statusName] = { name: statusName, count: 0 };
          }
          statusCounts[statusName].count += 1;
        });

        // Generate summary text from status counts
        const summaryText = Object.values(statusCounts)
          .map((status) => `${status.count} ${status.name}`)
          .join(", ");

        return {
          id: session.id,
          name: session.name,
          status: session.state.name,
          statusIcon: session.state.icon?.name,
          statusColor: session.state.color?.value,
          total: sessionResults.length,
          totalElapsed: totalElapsed,
          hasElapsed: hasElapsed,
          estimate: session.estimate,
          displayItems: sessionResults.map((result: any) => ({
            id: result.id,
            status: result.status,
            elapsed: result.elapsed,
            createdAt: result.createdAt,
          })),
          summaryText: summaryText,
          projectId: session.project.id,
          isDeleted: session.isDeleted,
        };
      }
    );

    const formattedTestRuns = Array.from(allTestRuns.values()).map(
      (testRun: any) => {
        // Process test cases similar to TestRunCasesSummary - create individual case items
        const displayItems: any[] = [];

        testRun.testCases?.forEach((testCase: any) => {
          const results = testCase.results || [];
          if (results.length > 0) {
            // Get the most recent result
            const latestResult = results[0]; // Already ordered by executedAt desc
            displayItems.push({
              id: testCase.id,
              testCaseId: testCase.repositoryCase?.id,
              testCaseName: testCase.repositoryCase?.name,
              status: latestResult.status,
              isPending: false,
            });
          } else {
            // Case has no results, it's pending
            displayItems.push({
              id: testCase.id,
              testCaseId: testCase.repositoryCase?.id,
              testCaseName: testCase.repositoryCase?.name,
              status: {
                name: "Pending",
                color: { value: "#9ca3af" },
              },
              isPending: true,
            });
          }
        });

        // Count statuses for summary text (like TestRunCasesSummary does)
        const statusCounts: Record<string, { name: string; count: number }> =
          {};
        displayItems.forEach((item) => {
          const statusName = item.status?.name || "Untested";
          if (!statusCounts[statusName]) {
            statusCounts[statusName] = { name: statusName, count: 0 };
          }
          statusCounts[statusName].count += 1;
        });

        // Generate summary text from status counts
        const summaryText = Object.values(statusCounts)
          .map((status) => `${status.count} ${status.name}`)
          .join(", ");

        return {
          id: testRun.id,
          name: testRun.name,
          status: testRun.state.name,
          statusIcon: testRun.state.icon?.name,
          statusColor: testRun.state.color?.value,
          total: displayItems.length,
          displayItems: displayItems,
          summaryText: summaryText,
          projectId: testRun.project.id,
          isDeleted: testRun.isDeleted,
        };
      }
    );

    return NextResponse.json(
      {
        testCases: formattedTestCases,
        sessions: formattedSessions,
        testRuns: formattedTestRuns,
      },
      { headers }
    );
  } catch (error) {
    console.error("Error fetching test info:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
