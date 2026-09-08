import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import ProjectOverviewSunburstChart from "@/components/dataVisualizations/ProjectOverviewSunburstChart";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { LinkIcon, Maximize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import LoadingSpinner from "~/components/LoadingSpinner";
import { Link } from "~/lib/navigation";

interface RepositoryCasesSectionProps {
  projectId: number;
}

const RepositoryCasesSection: React.FC<RepositoryCasesSectionProps> = ({
  projectId,
}) => {
  const t = useTranslations("projects.overview");
  const tCommon = useTranslations("common.actions");
  const [isChartZoomed, setIsChartZoomed] = React.useState(false);

  const { data: repositoryCasesBreakdown } = useClientQueries(
    schema
  ).repositoryCases.useGroupBy(
    {
      by: ["automated", "stateId"],
      where: {
        AND: [
          {
            isDeleted: false,
            isArchived: false,
            projectId: Number(projectId),
          },
        ],
      },
      _count: { _all: true },
    },
    {
      enabled: true,
      refetchOnWindowFocus: true,
    }
  );

  const breakdownStateIds = React.useMemo(() => {
    if (!repositoryCasesBreakdown) return [];

    const ids = new Set<number>();
    repositoryCasesBreakdown.forEach((group) => {
      if (group.stateId !== null && group.stateId !== undefined) {
        ids.add(group.stateId);
      }
    });

    return Array.from(ids);
  }, [repositoryCasesBreakdown]);

  const { data: workflowStates } = useClientQueries(
    schema
  ).workflows.useFindMany(
    breakdownStateIds.length
      ? {
          where: { id: { in: breakdownStateIds } },
          select: {
            id: true,
            name: true,
            color: {
              select: {
                value: true,
              },
            },
          },
        }
      : undefined,
    {
      enabled: breakdownStateIds.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  const workflowStatesById = React.useMemo(() => {
    if (!workflowStates) {
      return new Map<
        number,
        { name: string; color?: { value: string } | null }
      >();
    }

    return new Map(
      workflowStates.map((state) => [
        state.id,
        {
          name: state.name,
          color: state.color ?? null,
        },
      ])
    );
  }, [workflowStates]);

  type RepositoryCasesBreakdownEntry = {
    automated: boolean;
    count: number;
    state?: {
      name: string;
      color?: { value: string } | null;
    } | null;
  };

  const repositoryCasesBreakdownData = React.useMemo<
    RepositoryCasesBreakdownEntry[]
  >(() => {
    if (!repositoryCasesBreakdown) return [];

    return repositoryCasesBreakdown.reduce<RepositoryCasesBreakdownEntry[]>(
      (acc, group) => {
        if (!group) {
          return acc;
        }

        const count = group._count?._all ?? 0;
        if (!count) {
          return acc;
        }

        const stateInfo =
          group.stateId !== null && group.stateId !== undefined
            ? workflowStatesById.get(group.stateId)
            : undefined;

        const state = stateInfo
          ? {
              name: stateInfo.name,
              color: stateInfo.color ?? null,
            }
          : null;

        acc.push({
          automated: Boolean(group.automated),
          count,
          state,
        });

        return acc;
      },
      []
    );
  }, [repositoryCasesBreakdown, workflowStatesById]);

  const {
    data: repositoryCasesLatestFive,
    isLoading,
    isFetching,
  } = useClientQueries(schema).repositoryCases.useFindMany(
    {
      where: {
        AND: [
          {
            isDeleted: false,
            isArchived: false,
            projectId: Number(projectId),
          },
        ],
      },
      select: {
        id: true,
        name: true,
        source: true,
        automated: true,
        hasParameters: true,
        stateId: true,
        state: {
          select: {
            id: true,
            name: true,
            color: {
              select: {
                value: true,
              },
            },
          },
        },
        caseIssues: {
          where: {
            issue: {
              isDeleted: false,
            },
          },
          select: {
            issue: {
              select: {
                id: true,
                name: true,
                externalId: true,
                externalUrl: true,
                externalKey: true,
                title: true,
                externalStatus: true,
                data: true,
                integrationId: true,
                lastSyncedAt: true,
                issueTypeName: true,
                issueTypeIconUrl: true,
                integration: {
                  select: {
                    id: true,
                    provider: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    },
    {
      enabled: true,
      refetchOnWindowFocus: true,
    }
  );

  if (isLoading || isFetching || repositoryCasesLatestFive === undefined) {
    return (
      <div className="flex justify-center items-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (!repositoryCasesLatestFive?.length) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-muted-foreground">
          {t("noTestCasesPrefix")}{" "}
          <Link
            href={`/projects/repository/${projectId}`}
            className="text-primary hover:underline"
          >
            {t("noTestCasesLink")}
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    // Side by side while the section is wide enough for both halves; stacked
    // below that, so a narrow panel still leaves the case names room to read.
    <div className="@container flex flex-col">
      <div className="flex flex-col @2xl:flex-row">
        <div className="w-full @2xl:w-1/2 @2xl:pe-6 @2xl:me-2 overflow-hidden">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-primary">{t("testCaseBreakdown")}</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsChartZoomed(true)}
            >
              <Maximize2 className="h-4 w-4" />
              <span className="sr-only">{tCommon("expand")}</span>
            </Button>
          </div>
          <ProjectOverviewSunburstChart data={repositoryCasesBreakdownData} />
        </div>
        <Separator className="my-4 @2xl:hidden" orientation="horizontal" />
        <Separator
          className="h-auto hidden @2xl:block"
          orientation="vertical"
        />
        <div className="flex flex-col w-full @2xl:w-1/2 @2xl:ps-6 overflow-hidden">
          <h2 className="text-primary mb-2">{t("latestTestCases")}</h2>
          <ul className="flex flex-col space-y-1">
            {repositoryCasesLatestFive.map((caseItem) => {
              const caseIssues = caseItem.caseIssues.map((ci) => ci.issue);

              return (
                // Name and issues are separate columns with a gutter between
                // them; the name reclaims the issues column when a case has
                // none.
                <li
                  key={caseItem.id}
                  className="ms-6 flex items-start gap-3 group"
                >
                  <Link
                    className="flex items-start flex-1 min-w-0"
                    href={`/projects/repository/${projectId}/${caseItem.id}`}
                  >
                    <div className="flex items-center flex-1 min-w-0">
                      <CaseDisplay
                        id={caseItem.id}
                        name={caseItem.name}
                        size="large"
                        source={caseItem.source}
                        automated={caseItem.automated}
                        hasParameters={caseItem.hasParameters}
                        className="line-clamp-2"
                      />
                      <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  </Link>
                  {caseIssues.length > 0 && (
                    <div className="shrink-0">
                      <IssuesListDisplay
                        issues={caseIssues.map((issue) => ({
                          ...issue,
                          projectIds: [projectId],
                        }))}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <Dialog open={isChartZoomed} onOpenChange={setIsChartZoomed}>
        <DialogContent className="max-w-[80vw] h-[80vh] flex flex-col p-0 sm:p-6">
          <DialogHeader className="px-4 pt-4 sm:px-0 sm:pt-0">
            <DialogTitle>{t("testCaseBreakdown")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("testCaseBreakdown")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden p-4 sm:p-0">
            <ProjectOverviewSunburstChart
              data={repositoryCasesBreakdownData}
              className="h-full"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RepositoryCasesSection;
