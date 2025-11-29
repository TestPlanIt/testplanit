"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslations } from "next-intl";
import { useUpdateTestRuns, useFindManyWorkflows } from "~/lib/hooks";
import { TriangleAlert, CalendarIcon, CircleCheckBig } from "lucide-react";
import { format } from "date-fns";
import { cn } from "~/utils";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";

interface CompleteTestRunDialogProps {
  trigger: React.ReactNode;
  testRunId: number;
  projectId: number;
  stateId: number;
  stateName: string;
}

const CompleteTestRunDialog: React.FC<CompleteTestRunDialogProps> = ({
  trigger,
  testRunId,
  projectId,
  stateId,
  stateName,
}) => {
  const t = useTranslations();
  const { data: session } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [open, setOpen] = useState(false);

  const { mutate: updateTestRun } = useUpdateTestRuns({
    onSuccess: () => {
      const event = new CustomEvent("testRunCompleted", {
        detail: testRunId,
      });
      window.dispatchEvent(event);
      setOpen(false);
    },
  });

  const { data: workflows } = useFindManyWorkflows({
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

  useEffect(() => {
    if (workflows && workflows.length > 0) {
      const lastWorkflow = workflows.reduce((prev, curr) =>
        curr.order > prev.order ? curr : prev
      );
      setSelectedStateId(lastWorkflow?.id ?? stateId);
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
    } catch (error) {
      console.error("Error completing test run:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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
        </DialogHeader>
        <div className="space-y-4">
          <div>{t("common.dialogs.complete.description")}</div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("common.dialogs.complete.fields.state")}
            </label>
            <Select
              value={selectedStateId.toString()}
              onValueChange={(value) => setSelectedStateId(Number(value))}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "common.dialogs.complete.placeholders.selectState"
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {workflows?.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id.toString()}>
                    <div className="flex items-center gap-2">
                      <DynamicIcon
                        name={workflow.icon?.name as IconName}
                        color={workflow.color?.value}
                        className="h-4 w-4"
                      />
                      {workflow.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("common.dialogs.complete.fields.completionDate")}
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? (
                    format(selectedDate, "PPP")
                  ) : (
                    <span>
                      {t("common.dialogs.complete.placeholders.pickDate")}
                    </span>
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
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            {t("common.dialogs.complete.actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleComplete}
            disabled={isSubmitting}
          >
            {t("common.dialogs.complete.actions.complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompleteTestRunDialog;
