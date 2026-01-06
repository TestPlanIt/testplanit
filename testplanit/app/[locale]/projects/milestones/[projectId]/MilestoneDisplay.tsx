import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  MilestonesWithTypes,
  createColorMap,
  sortMilestones,
} from "~/utils/milestoneUtils";
import { useTheme } from "next-themes";
import { useFindManyColor, useUpdateMilestones } from "~/lib/hooks";
import { DeleteMilestoneModal } from "./DeleteMilestoneModal";
import { Loading } from "@/components/Loading";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import MilestoneItemCard from "./MilestoneItemCard";
import { CompleteMilestoneDialog } from "../CompleteMilestoneDialog";

interface ColorMap {
  [key: string]: {
    dark: string;
    light: string;
  };
}

interface MilestoneDisplayProps {
  milestones: MilestonesWithTypes[];
  projectId?: number;
}

const MilestoneDisplay: React.FC<MilestoneDisplayProps> = ({
  milestones,
  projectId,
}) => {
  const { data: session } = useSession();
  const { resolvedTheme } = useTheme();
  const t = useTranslations();
  const { data: colors, isLoading: isColorsLoading } = useFindManyColor({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });
  const { mutateAsync: updateMilestones } = useUpdateMilestones();
  const router = useRouter();

  const [colorMap, setColorMap] = useState<ColorMap | null>(null);
  const [selectedMilestoneForAction, setSelectedMilestoneForAction] =
    useState<MilestonesWithTypes | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isCompleteMilestoneDialogOpen, setIsCompleteMilestoneDialogOpen] =
    useState(false);

  useEffect(() => {
    if (colors) {
      const map = createColorMap(colors);
      setColorMap(map);
    }
  }, [colors]);

  if (isColorsLoading || !colorMap) return <Loading />;
  if (milestones?.length === 0) return null;

  const sortedMilestones = sortMilestones(milestones);

  if (!session) return null;

  const handleOpenCompleteDialog = (milestone: MilestonesWithTypes) => {
    setSelectedMilestoneForAction(milestone);
    setIsCompleteMilestoneDialogOpen(true);
  };

  const handleStartMilestone = async (milestone: MilestonesWithTypes) => {
    const startDate = new Date();
    await updateMilestones({
      where: { id: milestone.id },
      data: { isStarted: true, startedAt: startDate },
    });
  };

  const handleStopMilestone = async (milestone: MilestonesWithTypes) => {
    await updateMilestones({
      where: { id: milestone.id },
      data: { isStarted: false, startedAt: null },
    });
  };

  const handleReopenMilestone = async (milestone: MilestonesWithTypes) => {
    await updateMilestones({
      where: { id: milestone.id },
      data: { isCompleted: false, completedAt: null },
    });
  };

  const openEditModal = (milestone: MilestonesWithTypes) => {
    router.push(`/projects/milestones/${projectId}/${milestone.id}?edit=true`);
  };

  const openDeleteModal = (milestone: MilestonesWithTypes) => {
    setSelectedMilestoneForAction(milestone);
    setDeleteModalOpen(true);
  };

  const isParentCompleted = (parentId: number | null): boolean => {
    if (!parentId) return false;
    const parentMilestone = milestones.find((m) => m.id === parentId);
    return parentMilestone ? parentMilestone.isCompleted : false;
  };

  const renderIncompleteMilestones = (
    milestonesToRender: MilestonesWithTypes[],
    parentId: number | null = null,
    level: number = 0
  ): React.ReactElement[] => {
    return milestonesToRender
      .filter((m) => m.parentId === parentId && !m.isCompleted)
      .map((currentMilestone) => (
        <React.Fragment key={currentMilestone.id}>
          <MilestoneItemCard
            milestone={currentMilestone}
            projectId={projectId}
            theme={resolvedTheme}
            colorMap={colorMap}
            session={session}
            isParentCompleted={isParentCompleted}
            onOpenCompleteDialog={handleOpenCompleteDialog}
            onStartMilestone={handleStartMilestone}
            onStopMilestone={handleStopMilestone}
            onReopenMilestone={handleReopenMilestone}
            onOpenEditModal={openEditModal}
            onOpenDeleteModal={openDeleteModal}
            level={level}
          />
          {renderIncompleteMilestones(
            milestonesToRender,
            currentMilestone.id,
            level + 1
          )}
        </React.Fragment>
      ));
  };

  const renderCompletedMilestones = (
    milestonesToRender: MilestonesWithTypes[]
  ): React.ReactElement[] => {
    return milestonesToRender
      .filter((m) => m.isCompleted)
      .map((currentMilestone) => (
        <MilestoneItemCard
          key={currentMilestone.id}
          milestone={currentMilestone}
          projectId={projectId}
          theme={resolvedTheme}
          colorMap={colorMap}
          session={session}
          isParentCompleted={isParentCompleted}
          onOpenCompleteDialog={handleOpenCompleteDialog}
          onStartMilestone={handleStartMilestone}
          onStopMilestone={handleStopMilestone}
          onReopenMilestone={handleReopenMilestone}
          onOpenEditModal={openEditModal}
          onOpenDeleteModal={openDeleteModal}
        />
      ));
  };

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full relative">
        <div className="flex flex-col w-full">
          {renderIncompleteMilestones(sortedMilestones)}
        </div>
        <div className="flex flex-col w-full mt-8">
          {renderCompletedMilestones(sortedMilestones)}
        </div>
      </div>

      {selectedMilestoneForAction && (
        <CompleteMilestoneDialog
          open={isCompleteMilestoneDialogOpen}
          onOpenChange={setIsCompleteMilestoneDialogOpen}
          milestoneToComplete={selectedMilestoneForAction}
          onCompleteSuccess={() => {
            setSelectedMilestoneForAction(null);
            router.refresh();
          }}
        />
      )}

      {selectedMilestoneForAction && (
        <DeleteMilestoneModal
          milestone={selectedMilestoneForAction}
          open={deleteModalOpen}
          onOpenChange={setDeleteModalOpen}
          milestones={milestones}
        />
      )}
    </div>
  );
};

export default MilestoneDisplay;
