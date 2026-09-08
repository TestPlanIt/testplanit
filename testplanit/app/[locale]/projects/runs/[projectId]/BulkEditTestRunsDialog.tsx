"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { MilestoneSelect } from "@/components/forms/MilestoneSelect";
import { ManageTags } from "@/components/ManageTags";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import type { IconName } from "~/types/globals";
import { toast } from "sonner";

type MilestoneOption = React.ComponentProps<
  typeof MilestoneSelect
>["milestones"];

interface BulkEditTestRunsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testRunIds: number[];
  projectId: number;
  milestoneOptions: MilestoneOption;
  onDone: () => void;
}

const BulkEditTestRunsDialog: React.FC<BulkEditTestRunsDialogProps> = ({
  open,
  onOpenChange,
  testRunIds,
  projectId,
  milestoneOptions,
  onDone,
}) => {
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [applyMilestone, setApplyMilestone] = useState(false);
  const [milestoneId, setMilestoneId] = useState<number | null>(null);
  const [applyState, setApplyState] = useState(false);
  const [stateId, setStateId] = useState<number | null>(null);
  const [applyTags, setApplyTags] = useState(false);
  const [tagIds, setTagIds] = useState<number[]>([]);

  const { mutateAsync: updateTestRun } =
    useClientQueries(schema).testRuns.useUpdate();

  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      projects: { some: { projectId } },
    },
    orderBy: { order: "asc" },
    include: { icon: true, color: true },
  });

  const hasChanges =
    applyMilestone ||
    (applyState && stateId !== null) ||
    (applyTags && tagIds.length > 0);

  const handleApply = async () => {
    const data: Record<string, unknown> = {};
    if (applyMilestone) data.milestoneId = milestoneId;
    if (applyState && stateId !== null) data.stateId = stateId;
    if (applyTags && tagIds.length > 0) {
      data.tags = { connect: tagIds.map((id) => ({ id })) };
    }
    if (Object.keys(data).length === 0) return;

    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        testRunIds.map((id) => updateTestRun({ where: { id }, data }))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.error(
          tCommon("bulk.partialFailure", {
            failedCount: failed,
            totalCount: testRunIds.length,
          })
        );
      } else {
        toast.success(
          tCommon("messages.updateSuccessCount", { count: testRunIds.length })
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRuns"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["batchTestRunSummaries"],
      });
      onOpenChange(false);
      onDone();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <SquarePen className="h-6 w-6 shrink-0" />
              <div>
                {tCommon("bulk.editTitle", { count: testRunIds.length })}
              </div>
            </div>
          </DialogTitle>
          <DialogDescription>
            {tCommon("bulk.applyToCount", { count: testRunIds.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={applyMilestone}
                onCheckedChange={(checked) =>
                  setApplyMilestone(checked === true)
                }
                data-testid="bulk-edit-runs-apply-milestone"
              />
              {tCommon("fields.milestone")}
            </label>
            {applyMilestone && (
              <MilestoneSelect
                value={milestoneId}
                onChange={(val) =>
                  setMilestoneId(
                    val === "none" || val == null ? null : Number(val)
                  )
                }
                milestones={milestoneOptions}
                disabled={isSubmitting}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={applyState}
                onCheckedChange={(checked) => setApplyState(checked === true)}
                data-testid="bulk-edit-runs-apply-state"
              />
              {tCommon("fields.state")}
            </label>
            {applyState && (
              <Select
                value={stateId !== null ? stateId.toString() : undefined}
                onValueChange={(value) => setStateId(Number(value))}
                disabled={isSubmitting}
              >
                <SelectTrigger data-testid="bulk-edit-runs-state-trigger">
                  <SelectValue
                    placeholder={tCommon("placeholders.selectState")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {workflows?.map((workflow) => (
                    <SelectItem
                      key={workflow.id}
                      value={workflow.id.toString()}
                    >
                      <WorkflowStateDisplay
                        state={{
                          name: workflow.name,
                          icon: {
                            name: (workflow.icon?.name ?? "circle") as IconName,
                          },
                          color: { value: workflow.color?.value ?? "" },
                          requiresReview: workflow.requiresReview,
                        }}
                        size="sm"
                      />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={applyTags}
                onCheckedChange={(checked) => setApplyTags(checked === true)}
                data-testid="bulk-edit-runs-apply-tags"
              />
              {tCommon("fields.tags")}
            </label>
            {applyTags && (
              <>
                <ManageTags selectedTags={tagIds} setSelectedTags={setTagIds} />
                <p className="text-xs text-muted-foreground">
                  {tCommon("bulk.tagsAdditiveHint")}
                </p>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleApply}
            disabled={isSubmitting || !hasChanges}
            data-testid="bulk-edit-runs-apply"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {tCommon("actions.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkEditTestRunsDialog;
