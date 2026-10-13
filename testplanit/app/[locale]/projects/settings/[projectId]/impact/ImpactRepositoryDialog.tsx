"use client";

import { CodeRepositoryName } from "@/components/CodeRepositoryName";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitBranch, SquarePen, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "~/utils";
import {
  ImpactRepositoryForm,
  type CodeRepositoryOption,
  type DatePreferences,
  type ImpactConfigRow,
  type ImpactRepositoryFormMode,
} from "./ImpactRepositoryForm";

const FORM_ID = "impact-repository-form";

interface ImpactRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ImpactRepositoryFormMode;
  /** View and edit switch in place; the page hears about it. */
  onModeChange: (mode: ImpactRepositoryFormMode) => void;
  projectId: number;
  /** The connection shown, or null when connecting a new repository. */
  config: ImpactConfigRow | null;
  repositories: CodeRepositoryOption[];
  connectedRepositoryIds: number[];
  preferences?: DatePreferences | null;
  refetchConfigs: () => Promise<{ data?: ImpactConfigRow[] | null }>;
  onSaved: (configId: number) => void;
}

/**
 * One Impact repository connection in a dialog: connect a new one, view an
 * existing one read-only, or edit it. Follows the admin modals: the list
 * behind it is the place to disconnect.
 */
export function ImpactRepositoryDialog({
  open,
  onOpenChange,
  mode,
  onModeChange,
  projectId,
  config,
  repositories,
  connectedRepositoryIds,
  preferences,
  refetchConfigs,
  onSaved,
}: ImpactRepositoryDialogProps) {
  const t = useTranslations("projects.settings.impact");
  const tCommon = useTranslations("common");
  const tRepo = useTranslations("projects.settings.codeRepository");
  // "Read-only" already exists as the API-token badge; one string, one key.
  const tApiTokens = useTranslations("users.profile.apiTokens");
  const [fullScreen, setFullScreen] = useState(false);

  const title =
    mode === "add"
      ? t("repositories.connectTitle")
      : mode === "edit"
        ? t("repositories.editTitle", { name: config?.repository.name ?? "" })
        : (config?.repository.name ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col overflow-y-hidden sm:max-w-4xl",
          !fullScreen && "h-[90vh]"
        )}
        fullScreen={fullScreen}
        onFullScreenChange={setFullScreen}
        data-testid="impact-repository-dialog"
        data-mode={mode}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "add" ? (
              <>
                <GitBranch className="h-5 w-5 text-primary" />
                <span className="truncate">{title}</span>
              </>
            ) : (
              <CodeRepositoryName
                name={title}
                provider={config?.repository.provider}
                iconClassName="h-5 w-5 text-primary"
              />
            )}
            {mode === "view" && (
              <Badge variant="secondary" data-testid="impact-dialog-view-badge">
                {tApiTokens("readOnlyBadge")}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? t("repositories.connectDescription")
              : mode === "edit"
                ? t("repositories.editDescription")
                : t("repositories.viewDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <ImpactRepositoryForm
            key={`${mode}:${config?.id ?? "new"}`}
            projectId={projectId}
            config={mode === "add" ? null : config}
            mode={mode}
            formId={FORM_ID}
            repositories={repositories}
            connectedRepositoryIds={connectedRepositoryIds}
            preferences={preferences}
            refetchConfigs={refetchConfigs}
            onSaved={onSaved}
          />
        </div>

        <DialogFooter className="items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="impact-dialog-close"
          >
            {mode === "view" ? tCommon("actions.close") : tCommon("cancel")}
          </Button>
          {mode === "view" && (
            <Button
              type="button"
              onClick={() => onModeChange("edit")}
              data-testid="impact-dialog-edit"
            >
              <SquarePen className="h-4 w-4" />
              {tCommon("actions.edit")}
            </Button>
          )}
          {mode !== "view" && (
            <Button type="submit" form={FORM_ID} data-testid="impact-save">
              <Save className="h-4 w-4" />
              {mode === "add" ? t("repositories.connect") : tRepo("save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
