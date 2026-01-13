import React from "react";
import { LinkIcon } from "lucide-react";
import { Link } from "~/lib/navigation";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import {
  useFindManyRepositoryCases,
  useFindManyWorkflows,
  useGroupByRepositoryCases,
} from "~/lib/hooks";
import { useTranslations } from "next-intl";
import ProjectOverviewSunburstChart from "@/components/dataVisualizations/ProjectOverviewSunburstChart";
import { Separator } from "@/components/ui/separator";
import LoadingSpinner from "~/components/LoadingSpinner";

interface RepositoryCasesSectionProps {
  projectId: number;
}

const RepositoryCasesSection: React.FC<RepositoryCasesSectionProps> = ({
  projectId,
}) => {
  const t = useTranslations("projects.overview");

  const { data: repositoryCasesBreakdown } = useGroupByRepositoryCases(
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

  const { data: workflowStates } = useFindManyWorkflows(
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

  const repositoryCasesTotalCount = React.useMemo(
    () =>
      repositoryCasesBreakdownData.reduce(
        (total, group) => total + group.count,
        0
      ),
    [repositoryCasesBreakdownData]
  );

  const {
    data: repositoryCasesLatestFive,
    isLoading,
    isFetching,
  } = useFindManyRepositoryCases(
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
        issues: {
          where: {
            isDeleted: false,
          },
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
    <div className="flex flex-col">
      <p className="text-sm text-muted-foreground mb-4">
        <Link className="group" href={`/projects/repository/${projectId}`}>
          {t("seeAllTestCases", {
            count:
              repositoryCasesTotalCount || repositoryCasesLatestFive.length,
          })}
          <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>
      </p>
      <div className="flex">
        <div className="flex flex-col pr-6 w-1/2 mr-2 overflow-hidden">
          <h2 className="text-primary mb-2">{t("latestTestCases")}</h2>
          <ul className="flex flex-col space-y-1">
            {repositoryCasesLatestFive.map((caseItem) => (
              <li
                key={caseItem.id}
                className="ml-6 w-full flex items-start space-y-1 group"
              >
                <Link
                  className="flex items-start flex-1 min-w-0"
                  href={`/projects/repository/${projectId}/${caseItem.id}`}
                >
                  <div className="flex items-center flex-1 min-w-0 mr-2">
                    <CaseDisplay
                      id={caseItem.id}
                      name={caseItem.name}
                      size="large"
                      source={caseItem.source}
                      className="line-clamp-2"
                    />
                    <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                </Link>
                {caseItem.issues && caseItem.issues.length > 0 && (
                  <div className="shrink-0 mr-6">
                    <IssuesListDisplay
                      issues={caseItem.issues.map((issue) => ({
                        ...issue,
                        projectIds: [projectId],
                      }))}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <Separator className="h-auto" orientation="vertical" />
        <div className="pl-6 w-1/2 overflow-hidden">
          <h2 className="text-primary mb-2">{t("testCaseBreakdown")}</h2>
          <ProjectOverviewSunburstChart data={repositoryCasesBreakdownData} />
        </div>
      </div>
    </div>
  );
};

export default RepositoryCasesSection;
