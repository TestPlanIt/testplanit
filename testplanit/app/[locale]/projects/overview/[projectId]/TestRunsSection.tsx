import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useTranslations } from "next-intl";
import React from "react";
import TestRunItem from "~/app/[locale]/projects/runs/[projectId]/TestRunItem";
import { usePendingReviewsByEntity } from "~/hooks/usePendingReviewsByEntity";

interface TestRunsSectionProps {
  projectId: number;
}

const TestRunsSection: React.FC<TestRunsSectionProps> = ({ projectId }) => {
  const t = useTranslations();

  const { data: testRuns, isLoading: isLoadingTestRuns } = useClientQueries(
    schema
  ).testRuns.useFindMany({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isDeleted: false },
        { isCompleted: false },
      ],
    },
    // Mirrors the runs page selection so TestRunItem renders identically here.
    select: {
      id: true,
      name: true,
      isCompleted: true,
      testRunType: true,
      completedAt: true,
      compositionLockedAt: true,
      createdAt: true,
      note: true,
      projectId: true,
      configurationGroupId: true,
      configuration: true,
      state: { include: { icon: true, color: true } },
      createdBy: true,
      milestone: {
        include: {
          milestoneType: { include: { icon: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const testRunIds = React.useMemo(
    () => testRuns?.map((run) => run.id) ?? [],
    [testRuns]
  );
  const pendingReviewsByRunId = usePendingReviewsByEntity("RUN", testRunIds);

  if (isLoadingTestRuns) {
    return (
      <div className="flex justify-center items-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (!testRuns?.length) return null;

  return (
    <div className="flex flex-col">
      <h2 className="text-primary mb-2">
        {t("projects.overview.latestTestRuns")}
      </h2>
      {testRuns.map((testRun) => (
        <TestRunItem
          key={testRun.id}
          testRun={testRun}
          projectId={projectId}
          showActions={false}
          pendingRequest={pendingReviewsByRunId.get(testRun.id)}
        />
      ))}
    </div>
  );
};

export default TestRunsSection;
