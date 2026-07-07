"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
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
import { format } from "date-fns";
import {
  CalendarIcon,
  CircleCheckBig,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { useTransitionGateStatus } from "~/hooks/useTransitionGateStatus";
import { IconName } from "~/types/globals";
import { cn } from "~/utils";

interface CompleteTestRunDialogProps {
  open: boolean;
  onClose: () => void;
  testRunId: number;
  projectId: number;
  stateId: number;
  stateName: string;
}

const CompleteTestRunDialog: React.FC<CompleteTestRunDialogProps> = ({
  open,
  onClose,
  testRunId,
  projectId,
  stateId,
  stateName: _stateName,
}) => {
  const t = useTranslations();
  const { data: session } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const { mutateAsync: updateTestRun } =
    useClientQueries(schema).testRuns.useUpdate();

  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      workflowType: "DONE",
      projects: {
        some: {
          projectId: projectId,
        },
      },
    },
    orderBy: { order: "asc" },
    include: { icon: true, color: true },
  });

  const [selectedStateId, setSelectedStateId] = useState<number>(stateId);

  // Client mirror of the strict-transitive review gate. Disables the
  // Complete button (and surfaces an inline warning) when the picked
  // target state would be blocked server-side, so the user doesn't fire
  // the mutation only to receive a 403.
  const transitionGate = useTransitionGateStatus(
    "RUN",
    testRunId,
    stateId,
    projectId
  );
  const stateTransitionCheck = transitionGate.canTransitionTo(selectedStateId);

  useEffect(() => {
    if (workflows && workflows.length > 0) {
      // workflows are already sorted by order ascending, so first item is the lowest order
      setSelectedStateId(workflows[0].id ?? stateId);
    } else if (workflows && workflows.length === 0) {
      setSelectedStateId(stateId);
    }
  }, [workflows, stateId]);

  const handleComplete = async () => {
    if (!session?.user?.id) return;
    try {
      setIsSubmitting(true);
      await updateTestRun({
        where: { id: testRunId },
        data: {
          isCompleted: true,
          completedAt: selectedDate,
          stateId: selectedStateId,
        },
      });
      const event = new CustomEvent("testRunCompleted", {
        detail: testRunId,
      });
      window.dispatchEvent(event);
      onClose();
    } catch (error) {
      console.error("Error completing test run:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <div>
                <CircleCheckBig className="h-6 w-6 shrink-0" />
              </div>
              <div>{t("common.dialogs.complete.title")}</div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("common.dialogs.complete.title")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>{t("common.dialogs.complete.description")}</div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("common.fields.state")}
            </label>
            <Select
              value={selectedStateId.toString()}
              onValueChange={(value) => setSelectedStateId(Number(value))}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("common.placeholders.selectState")}
                />
              </SelectTrigger>
              <SelectContent>
                {workflows?.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id.toString()}>
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
            {!stateTransitionCheck.allowed &&
              stateTransitionCheck.blockingGate && (
                <p className="text-sm text-destructive">
                  {t("reviews.transitionGate.blockedByGate", {
                    gateName: stateTransitionCheck.blockingGate.name,
                  })}
                </p>
              )}
          </div>

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
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleComplete}
            disabled={isSubmitting || !stateTransitionCheck.allowed}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting
              ? t("common.dialogs.complete.completing")
              : t("common.dialogs.complete.title")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompleteTestRunDialog;
