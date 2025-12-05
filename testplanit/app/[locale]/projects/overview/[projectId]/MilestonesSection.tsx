import React from "react";
import MilestoneDisplay from "@/projects/milestones/[projectId]/MilestoneDisplay";
import { Link } from "~/lib/navigation";
import { LinkIcon, Milestone } from "lucide-react";
import { useFindManyMilestones } from "~/lib/hooks";
import { MilestonesWithTypes } from "~/utils/milestoneUtils";
import { useTranslations } from "next-intl";
import LoadingSpinner from "@/components/LoadingSpinner";

interface MilestonesSectionProps {
  projectId: number;
}

const MilestonesSection: React.FC<MilestonesSectionProps> = ({ projectId }) => {
  const t = useTranslations();

  const { data: milestones, isLoading: isLoadingMilestones } =
    useFindManyMilestones({
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
    useFindManyMilestones({
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
        <div className="p-6 pb-4 border-b">
          <h3 className="text-2xl font-semibold leading-none tracking-tight text-primary flex items-center">
            <Milestone className="mr-1" />
            <div>{t("projects.overview.currentMilestones")}</div>
          </h3>
        </div>
        <div className="p-6 flex-1 flex justify-center items-center">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border rounded-lg bg-card text-card-foreground shadow-sm">
      <div className="p-6 pb-4 border-b">
        <h3 className="text-2xl font-semibold leading-none tracking-tight text-primary flex items-center">
          <Milestone className="mr-1" />
          <div>{t("projects.overview.currentMilestones")}</div>
        </h3>
        {milestones?.length ? (
          <p className="text-sm text-muted-foreground mt-1.5">
            <Link
              className="group"
              scroll={false}
              href={`/projects/milestones/${projectId}`}
            >
              {t("projects.overview.seeAllMilestones", {
                count: milestonesCountResult?.length ?? 0,
              })}
              <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </Link>
          </p>
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
