"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarIcon,
  CircleCheckBig,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import type { IconName } from "~/types/globals";
import { cn } from "~/utils";
import { toast } from "sonner";

interface BulkCompleteTestRunsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testRunIds: number[];
  projectId: number;
  onDone: () => void;
}

const BulkCompleteTestRunsDialog: React.FC<BulkCompleteTestRunsDialogProps> = ({
  open,
  onOpenChange,
  testRunIds,
  projectId,
  onDone,
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedStateId, setSelectedStateId] = useState<number | null>(null);

  const { mutateAsync: updateTestRun } =
    useClientQueries(schema).testRuns.useUpdate();

  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      workflowType: "DONE",
      projects: { some: { projectId } },
    },
    orderBy: { order: "asc" },
    include: { icon: true, color: true },
  });

  useEffect(() => {
    if (workflows && workflows.length > 0) {
      setSelectedStateId(workflows[0].id);
    } else {
      setSelectedStateId(null);
    }
  }, [workflows]);

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const data: Record<string, unknown> = {
        isCompleted: true,
        completedAt: selectedDate,
      };
      // Without a DONE workflow for this project each run keeps its state.
      if (selectedStateId !== null) data.stateId = selectedStateId;

      const results = await Promise.allSettled(
        testRunIds.map((id) => updateTestRun({ where: { id }, data }))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          window.dispatchEvent(
            new CustomEvent("testRunCompleted", { detail: testRunIds[index] })
          );
        }
      });
      if (failed > 0) {
        toast.error(
          t("common.bulk.partialFailure", {
            failedCount: failed,
            totalCount: testRunIds.length,
          })
        );
      } else {
        toast.success(
          t("common.bulk.completeSuccess", { count: testRunIds.length })
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
              <CircleCheckBig className="h-6 w-6 shrink-0" />
              <div>
                {t("runs.bulk.completeTitle", { count: testRunIds.length })}
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("runs.bulk.completeTitle", { count: testRunIds.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            {t("runs.bulk.completeDescription", { count: testRunIds.length })}
          </div>

          {workflows && workflows.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("common.fields.state")}
              </label>
              <Select
                value={selectedStateId?.toString()}
                onValueChange={(value) => setSelectedStateId(Number(value))}
              >
                <SelectTrigger data-testid="bulk-complete-runs-state-trigger">
                  <SelectValue
                    placeholder={t("common.placeholders.selectState")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((workflow) => (
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
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("sessions.complete.fields.completionDate")}
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-start font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="h-4 w-4" />
                  {selectedDate ? (
                    format(selectedDate, "PPP")
                  ) : (
                    <span>{t("sessions.complete.placeholders.pickDate")}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-start space-x-2 text-destructive-foreground bg-destructive p-2">
            <TriangleAlert className="w-12 h-12 shrink-0" />
            <p>{t("common.dialogs.complete.warning")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleComplete}
            disabled={isSubmitting}
            data-testid="bulk-complete-runs-confirm"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting
              ? t("common.dialogs.complete.completing")
              : t("common.actions.complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkCompleteTestRunsDialog;
