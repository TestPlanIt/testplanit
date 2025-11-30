"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import {
  useUpdateSessions,
  useCreateSessionVersions,
  useFindManyWorkflows,
} from "~/lib/hooks";
import { TriangleAlert, CalendarIcon, CircleCheckBig } from "lucide-react";
import { format } from "date-fns";
import { cn } from "~/utils";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { useTranslations } from "next-intl";

export interface CompletableSession {
  id: number;
  name: string;
  projectId: number;
  templateId: number;
  stateId: number;
  configId: number | null;
  milestoneId: number | null;
  assignedToId: string | null;
  estimate: number | null;
  forecastManual: number | null;
  forecastAutomated: number | null;
  elapsed: number | null;
  note: any;
  mission: any;
  currentVersion: number;
  project: { name: string };
  template: {
    id: number;
    templateName: string;
    isDeleted: boolean;
    isDefault: boolean;
    isEnabled: boolean;
  };
  configuration: { name: string } | null;
  milestone?: { name: string } | null;
  state: { name: string };
  assignedTo: { name: string } | null;
  tags?: string;
  attachments?: string;
  issues?: { id: number; name: string; externalId?: string | null }[];
}

interface CompleteSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: CompletableSession;
  projectId: number;
}

export function CompleteSessionDialog({
  open,
  onOpenChange,
  session,
  projectId,
}: CompleteSessionDialogProps) {
  const router = useRouter();
  const { data: userSession } = useSession();
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const { mutateAsync: updateSessions } = useUpdateSessions();
  const { mutateAsync: createSessionVersions } = useCreateSessionVersions();
  const { data: workflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "SESSIONS",
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

  const [selectedStateId, setSelectedStateId] = useState<number>(
    session?.stateId || 0
  );

  useEffect(() => {
    if (workflows && workflows.length > 0) {
      const lastWorkflow = workflows.reduce((prev, curr) =>
        curr.order > prev.order ? curr : prev
      );
      setSelectedStateId(lastWorkflow?.id ?? session?.stateId);
    } else {
      // If no workflows available, keep the current state
      setSelectedStateId(session?.stateId || 0);
    }
  }, [workflows, session?.stateId]);

  if (!open || !session) {
    return null;
  }
  
  // If no workflows configured, show a message instead of preventing render
  if (!workflows || workflows.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sessions.completeDialog.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("sessions.completeDialog.title")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-muted-foreground">
              {t("sessions.completeDialog.noWorkflowsConfigured")}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const handleComplete = async () => {
    try {
      setIsSubmitting(true);
      const nextVersion = session.currentVersion + 1;
      // First create a new version record
      await createSessionVersions({
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
          stateId: selectedStateId,
          stateName:
            workflows?.find((w) => w.id === selectedStateId)?.name ||
            session.state.name,
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
          tags: session.tags || "[]",
          attachments: session.attachments || "[]",
        },
      });

      // Then update the session
      await updateSessions({
        where: { id: session.id },
        data: {
          isCompleted: true,
          completedAt: selectedDate,
          stateId: selectedStateId,
          currentVersion: nextVersion,
        },
      });

      router.refresh();
      onOpenChange(false);
    } catch (error) {
      console.error("Error completing session:", error);
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
              <div>
                <CircleCheckBig className="h-6 w-6 shrink-0" />
              </div>
              <div>{t("sessions.complete.title")}</div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("sessions.complete.title")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            {t("sessions.complete.confirmMessage", { name: session.name })}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("sessions.complete.fields.state")}
            </label>
            <Select
              value={selectedStateId.toString()}
              onValueChange={(value) => setSelectedStateId(Number(value))}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("sessions.complete.placeholders.selectState")}
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
              {t("sessions.complete.fields.completionDate")}
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
            {t("sessions.complete.actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleComplete}
            disabled={isSubmitting}
          >
            {t("sessions.complete.actions.complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
