import React from "react";
import { Link } from "~/lib/navigation";
import { PlayCircle, LinkIcon, Combine } from "lucide-react";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { useFindManyTestRuns } from "~/lib/hooks";
import Loading from "@/components/LoadingSpinner";
import { useTranslations } from "next-intl";
import { TestRunCasesSummary } from "~/components/TestRunCasesSummary";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TestRunsSectionProps {
  projectId: number;
}

const TestRunsSection: React.FC<TestRunsSectionProps> = ({ projectId }) => {
  const t = useTranslations();

  const { data: testRuns, isLoading: isLoadingTestRuns } = useFindManyTestRuns({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isDeleted: false },
        { isCompleted: false },
      ],
    },
    include: {
      configuration: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const { data: testRunsCount, isLoading: isLoadingCount } =
    useFindManyTestRuns({
      where: {
        AND: [
          { projectId: Number(projectId) },
          { isDeleted: false },
          { isCompleted: false },
        ],
      },
      select: {
        id: true,
      },
    });

  if (isLoadingTestRuns || isLoadingCount) {
    return (
      <div className="flex justify-center items-center py-8">
        <Loading />
      </div>
    );
  }

  if (!testRuns?.length) return null;

  return (
    <div className="flex flex-col">
      <p className="text-sm text-muted-foreground mb-4">
        <Link className="group" href={`/projects/runs/${projectId}`}>
          {t("projects.overview.seeAllActiveTestRuns", {
            count: testRunsCount?.length ?? 0,
          })}
          <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>
      </p>
      <div className="flex flex-col">
        <h2 className="text-primary mb-2">
          {t("projects.overview.latestTestRuns")}
        </h2>
        <ul className="flex flex-col w-full space-y-4">
          {testRuns.map((testRun) => (
            <li key={testRun.id} className="ml-6">
              <div className="grid grid-cols-[1fr,2fr] gap-4 items-center">
                {/* Left column - Test run name and created date */}
                <div className="flex flex-col space-y-1 min-w-0">
                  {/* First row - Test run name */}
                  <Link
                    href={`/projects/runs/${projectId}/${testRun.id}`}
                    className="block"
                  >
                    <div className="flex items-center group">
                      <PlayCircle className="h-5 w-5 shrink-0 mr-2" />
                      <span className="font-medium truncate pr-1">
                        {testRun.name}
                      </span>
                      {(testRun as any).configurationGroupId && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="shrink-0 mr-1">
                                <Combine className="w-4 h-4 text-muted-foreground" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-background/50">
                                {t("common.labels.multiConfiguration")}
                              </p>
                              {testRun.configuration && (
                                <p className="flex text-xs text-background">
                                  <Combine className="w-4 h-4 shrink-0 mr-1" />
                                  {testRun.configuration.name}
                                </p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <LinkIcon className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>

                  {/* Second row - Created date */}
                  <div className="text-sm text-muted-foreground ml-7 flex items-center min-w-0">
                    <span className="shrink-0 whitespace-nowrap mr-1">
                      {t("projects.overview.created")}
                      {": "}
                    </span>
                    <span className="truncate">
                      <DateTextDisplay startDate={testRun.createdAt} />
                    </span>
                  </div>
                </div>

                {/* Right column - TestRunCasesSummary (spans both rows) */}
                <div className="flex justify-end min-w-0">
                  <TestRunCasesSummary
                    testRunId={testRun.id}
                    projectId={projectId}
                    testRunType={testRun.testRunType}
                    className="w-full"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default TestRunsSection;
