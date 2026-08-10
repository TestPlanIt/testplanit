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
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import type { IconName } from "~/types/globals";
import { cn } from "~/utils";
import { toast } from "sonner";
import type { SessionsWithDetails } from "./SessionDisplay";

interface BulkCompleteSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionsWithDetails[];
  projectId: number;
  onDone: () => void;
}

const BulkCompleteSessionsDialog: React.FC<BulkCompleteSessionsDialogProps> = ({
  open,
  onOpenChange,
  sessions,
  projectId,
  onDone,
}) => {
  const t = useTranslations();
  const { data: userSession } = useSession();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedStateId, setSelectedStateId] = useState<number | null>(null);

  const { mutateAsync: updateSession } =
    useClientQueries(schema).sessions.useUpdate();
  const { mutateAsync: createSessionVersion } =
    useClientQueries(schema).sessionVersions.useCreate();

  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "SESSIONS",
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

  // Same flow as the single-session CompleteSessionDialog: complete first,
  // then snapshot. The completion write is the one the server gates on
  // canClose, and SessionVersions is unique on (sessionId, version) — writing
  // the snapshot first would leave an orphan row behind a rejected update, and
  // the retry would then collide on that unique index and never succeed.
  const completeOne = async (session: SessionsWithDetails) => {
    const stateId = selectedStateId ?? session.stateId;
    const nextVersion = session.currentVersion + 1;
    await updateSession({
      where: { id: session.id },
      data: {
        isCompleted: true,
        completedAt: selectedDate,
        stateId,
        currentVersion: nextVersion,
      },
    });
    await createSessionVersion({
      data: {
        sessionId: session.id,
        version: nextVersion,
        name: session.name,
        staticProjectId: projectId,
        staticProjectName: session.project.name,
        projectId: projectId,
        templateId: session.templateId,
        templateName: session.template.templateName,
        configId: session.configId,
        configurationName: session.configuration?.name || null,
        milestoneId: session.milestoneId,
        milestoneName: session.milestone?.name || null,
        stateId,
        stateName:
          workflows?.find((w) => w.id === stateId)?.name || session.state.name,
        assignedToId: session.assignedToId,
        assignedToName: session.assignedTo?.name || null,
        createdById: userSession?.user?.id || "",
        createdByName: userSession?.user?.name || "",
        estimate: session.estimate,
        forecastManual: session.forecastManual,
        forecastAutomated: session.forecastAutomated,
        elapsed: session.elapsed,
        note: JSON.stringify(session.note),
        mission: JSON.stringify(session.mission),
        isCompleted: true,
        completedAt: selectedDate,
        tags: "[]",
        attachments: "[]",
      },
    });
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        sessions.map((session) => completeOne(session))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.error(
          t("common.bulk.partialFailure", {
            failedCount: failed,
            totalCount: sessions.length,
          })
        );
      } else {
        toast.success(
          t("common.bulk.completeSuccess", { count: sessions.length })
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "Sessions"],
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
                {t("sessions.bulk.completeTitle", { count: sessions.length })}
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("sessions.bulk.completeTitle", { count: sessions.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            {t("sessions.bulk.completeDescription", {
              count: sessions.length,
            })}
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
                <SelectTrigger data-testid="bulk-complete-sessions-state-trigger">
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
            <p>{t("sessions.complete.warning")}</p>
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
            data-testid="bulk-complete-sessions-confirm"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("sessions.actions.complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkCompleteSessionsDialog;
