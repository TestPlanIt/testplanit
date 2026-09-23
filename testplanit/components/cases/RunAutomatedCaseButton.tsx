"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FilePlay } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";
import type { ExecutionTargetChoice } from "~/app/actions/execution-targets";
import { useExecutionTargetChoices } from "@/components/runs/ExecuteAutomationButton";
import {
  ExecuteAutomationDialog,
  readExecuteError,
} from "@/components/runs/ExecuteAutomationDialog";

interface Props {
  projectId: number;
  caseId: number;
  caseTitle: string;
  automated: boolean;
  canExecute: boolean;
}

interface DialogProps {
  projectId: number;
  caseId: number;
  caseTitle: string;
  targets: ExecutionTargetChoice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The ad-hoc dialog on its own, for hosts that own the trigger (the
 * repository list's row menu). Creates a run holding just this case and
 * dispatches it; the toast offers to open the run.
 */
export function RunAutomatedCaseDialog({
  projectId,
  caseId,
  caseTitle,
  targets,
  open,
  onOpenChange,
}: DialogProps) {
  const t = useTranslations("automation.adhoc");
  const tExecute = useTranslations("automation.execute");
  const router = useRouter();
  return (
    <ExecuteAutomationDialog
      open={open}
      onOpenChange={onOpenChange}
      targets={targets}
      caseCount={1}
      runId={null}
      title={t("title")}
      description={t("description")}
      submit={async ({ targetId, ref, inputs }) => {
        const res = await fetch(`/api/projects/${projectId}/execute-cases`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseIds: [caseId],
            targetId,
            ...(ref ? { ref } : {}),
            ...(inputs ? { inputs } : {}),
            runName: t("runName", { title: caseTitle }).slice(0, 255),
          }),
        });
        if (res.status !== 202) {
          return readExecuteError(res, tExecute("dispatchFailed"));
        }
        const data = (await res.json()) as { runId: number };
        toast.success(t("runCreated"), {
          action: {
            label: t("openRun"),
            onClick: () =>
              router.push(`/projects/runs/${projectId}/${data.runId}`),
          },
        });
        return null;
      }}
    />
  );
}

const NO_TARGETS: ExecutionTargetChoice[] = [];

/**
 * The enabled execution targets an ad-hoc run of this case may use; empty
 * (so nothing should render) unless the case is automated, the viewer may
 * create runs, record results and trigger automation, and the project has
 * an enabled target.
 */
export function useRunAutomatedCaseTargets(
  projectId: number,
  automated: boolean,
  canExecute: boolean
): ExecutionTargetChoice[] {
  const { data: targets } = useExecutionTargetChoices(
    projectId,
    automated && canExecute
  );
  return useMemo(() => {
    if (!automated || !canExecute) return NO_TARGETS;
    const enabled = (targets ?? []).filter((x) => x.isEnabled);
    return enabled.length > 0 ? enabled : NO_TARGETS;
  }, [targets, automated, canExecute]);
}

/**
 * The trigger alone, for a dropdown menu. The host owns the dialog and must
 * render it OUTSIDE the menu: menu content unmounts on item select, which
 * would take a dialog rendered beside this item down with it.
 */
export function RunAutomatedCaseMenuItem({
  onSelect,
}: {
  onSelect: () => void;
}) {
  const t = useTranslations("automation.adhoc");
  return (
    <DropdownMenuItem
      className="flex items-center cursor-pointer"
      onSelect={onSelect}
      data-testid="run-automated-case-button"
    >
      <FilePlay className="me-2 h-4 w-4" />
      <span>{t("button")}</span>
    </DropdownMenuItem>
  );
}

/**
 * Ad-hoc execution of one automated case as a standalone button that owns
 * its dialog: creates a run holding just this case and dispatches it.
 * Renders nothing unless {@link useRunAutomatedCaseTargets} yields a target.
 */
export function RunAutomatedCaseButton({
  projectId,
  caseId,
  caseTitle,
  automated,
  canExecute,
}: Props) {
  const t = useTranslations("automation.adhoc");
  const [open, setOpen] = useState(false);
  const targets = useRunAutomatedCaseTargets(projectId, automated, canExecute);

  if (targets.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="run-automated-case-button"
        className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
      >
        <FilePlay className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          {t("button")}
        </span>
      </Button>
      <RunAutomatedCaseDialog
        projectId={projectId}
        caseId={caseId}
        caseTitle={caseTitle}
        targets={targets}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
