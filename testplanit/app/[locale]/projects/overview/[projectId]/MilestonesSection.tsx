import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import LoadingSpinner from "@/components/LoadingSpinner";
import MilestoneDisplay from "@/projects/milestones/[projectId]/MilestoneDisplay";
import { CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { LinkIcon, Milestone } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { Link } from "~/lib/navigation";
import { MilestonesWithTypes } from "~/utils/milestoneUtils";

interface MilestonesSectionProps {
  projectId: number;
}

const MilestonesSection: React.FC<MilestonesSectionProps> = ({ projectId }) => {
  const t = useTranslations();

  const { data: milestones, isLoading: isLoadingMilestones } = useClientQueries(
    schema
  ).milestones.useFindMany({
    where: {
      AND: [{ projectId }, { isCompleted: false }, { isDeleted: false }],
    },
    orderBy: [
      { startedAt: "asc" },
      { completedAt: "asc" },
      { isStarted: "asc" },
    ],
    include: {
      milestoneType: { include: { icon: true } },
    },
  });

  const { data: milestonesCountResult, isLoading: isLoadingCount } =
    useClientQueries(schema).milestones.useFindMany({
      where: {
        AND: [{ projectId }, { isCompleted: false }, { isDeleted: false }],
      },
      select: {
        id: true,
      },
    });

  if (isLoadingMilestones || isLoadingCount) {
    return (
      <div className="h-full flex flex-col border rounded-lg bg-card text-card-foreground shadow-sm">
        <div className="px-6 py-4 bg-foreground/5">
          <SectionHeader className="flex items-center gap-2 text-lg md:text-lg">
            <Milestone className="h-5 w-5 shrink-0" />
            <CardTitle>{t("projects.overview.currentMilestones")}</CardTitle>
          </SectionHeader>
        </div>
        <div className="p-6 flex-1 flex justify-center items-center">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border rounded-lg bg-card text-card-foreground shadow-sm">
      {/* Matches the collapsible section headers in the right panel, minus
          the hover tint — that reads as "clickable", and this one isn't.
          Wraps to its own line — left-justified under the title — when narrow. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-4 bg-foreground/5">
        <SectionHeader className="flex items-center gap-2 text-lg md:text-lg">
          <Milestone className="h-5 w-5 shrink-0" />
          <CardTitle>{t("projects.overview.currentMilestones")}</CardTitle>
        </SectionHeader>
        {milestones?.length ? (
          <Link
            className="group text-sm text-muted-foreground"
            scroll={false}
            href={`/projects/milestones/${projectId}`}
          >
            {t("projects.overview.seeAllMilestones", {
              count: milestonesCountResult?.length ?? 0,
            })}
            <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </Link>
        ) : null}
      </div>
      <div className="p-6 flex-1 overflow-auto">
        {milestones?.length ? (
          <MilestoneDisplay
            milestones={milestones as MilestonesWithTypes[]}
            projectId={projectId}
          />
        ) : (
          <Link
            href={`/projects/milestones/${projectId}`}
            className="text-muted-foreground text-center"
          >
            {t("milestones.empty.active")}
          </Link>
        )}
      </div>
    </div>
  );
};

export default MilestonesSection;
