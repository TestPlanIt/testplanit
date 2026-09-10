"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateFormatter } from "@/components/DateFormatter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteExecutionTarget,
  listExecutionTargets,
  setExecutionTargetEnabled,
  verifyExecutionTarget,
  type ExecutionTargetView,
} from "~/app/actions/execution-targets";
import type { DispatchCapability } from "~/lib/execution/types";
import { translateServerError } from "~/lib/i18n/translateServerError";
import { AutomationTargetDialog } from "./automation-target-dialog";

export const executionTargetsQueryKey = (projectId: number) => [
  "executionTargets",
  projectId,
];

interface Props {
  projectId: number;
}

export function AutomationTargetsList({ projectId }: Props) {
  const t = useTranslations("automation.settings");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: executionTargetsQueryKey(projectId),
    queryFn: async () => {
      const result = await listExecutionTargets(projectId);
      if (!result.success) throw new Error(result.error);
      return result.targets;
    },
  });
  const targets = data ?? [];
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: executionTargetsQueryKey(projectId),
    });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExecutionTargetView | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{
    targetId: number;
    secret: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExecutionTargetView | null>(
    null
  );
  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<
    Record<number, DispatchCapability>
  >({});

  const handleToggle = async (target: ExecutionTargetView, next: boolean) => {
    const result = await setExecutionTargetEnabled(target.id, next);
    if (!result.success) {
      toast.error(translateServerError(tGlobal, result, result.error));
      return;
    }
    toast.success(next ? t("enabledToast") : t("disabledToast"));
    void refresh();
  };

  const handleVerify = async (target: ExecutionTargetView) => {
    setVerifying(target.id);
    try {
      const result = await verifyExecutionTarget(target.id);
      if (!result.success) {
        toast.error(translateServerError(tGlobal, result, result.error));
        return;
      }
      setVerifyResults((prev) => ({ ...prev, [target.id]: result.capability }));
      void refresh();
    } finally {
      setVerifying(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteExecutionTarget(deleteTarget.id);
    setDeleteTarget(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(t("deleted"));
    void refresh();
  };

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success(t("secretCopied"));
    } catch {
      toast.error(tCommon("errors.fetchFailed"));
    }
  };

  const providerLabel = (provider: ExecutionTargetView["provider"]) =>
    tGlobal(`enums.ExecutionProvider.${provider}`);

  const renderVerifyResult = (target: ExecutionTargetView) => {
    const result = verifyResults[target.id];
    if (!result) return null;
    return (
      <div
        className="rounded-md border p-3 text-xs space-y-1"
        data-testid={`automation-target-test-result-${target.id}`}
      >
        <div className="flex items-center gap-2 font-medium">
          {result.ok ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" aria-hidden />
          )}
          <span>
            {result.ok
              ? result.warnings.length > 0
                ? t("verifyOkWithWarnings")
                : t("verifyOk")
              : t("verifyFailed")}
          </span>
        </div>
        {result.error && <p className="text-destructive">{result.error}</p>}
        {result.warnings.map((w, i) => (
          <p key={i} className="text-muted-foreground">
            {w}
          </p>
        ))}
        {result.declaredInputs && result.declaredInputs.length > 0 && (
          <p className="font-mono text-muted-foreground">
            {t("declaredInputs", { inputs: result.declaredInputs.join(", ") })}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="automation-targets-section">
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          data-testid="automation-target-create-button"
        >
          <Plus className="h-4 w-4" />
          <span>{t("createButton")}</span>
        </Button>
      </div>

      {revealedSecret && (
        <div
          className="space-y-3 rounded-md border border-primary/40 bg-muted/30 p-3"
          data-testid="automation-target-revealed-secret-box"
        >
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("revealedSecretWarning")}</span>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {t("secret")}
            </div>
            <div className="flex items-center gap-2">
              <code
                data-testid="automation-target-revealed-secret"
                className="flex-1 break-all text-xs"
              >
                {revealedSecret.secret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copySecret(revealedSecret.secret)}
                data-testid="automation-target-secret-copy"
              >
                <Copy className="h-4 w-4" />
                <span>{t("copySecret")}</span>
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => setRevealedSecret(null)}
              data-testid="automation-target-secret-done"
            >
              <Check className="h-4 w-4" />
              <span>{t("done")}</span>
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{tCommon("loading")}</span>
        </div>
      ) : targets.length === 0 ? (
        <div
          className="rounded-md border border-dashed p-6 text-center"
          data-testid="automation-targets-empty"
        >
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("emptyDescription")}
          </p>
        </div>
      ) : (
        targets.map((target) => (
          <Card
            key={target.id}
            data-testid={`automation-target-card-${target.id}`}
            className={target.isEnabled ? undefined : "opacity-60"}
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle
                    data-testid={`automation-target-card-title-${target.id}`}
                  >
                    {target.name}
                  </CardTitle>
                  <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {providerLabel(target.provider)}
                    </Badge>
                    {target.codeRepository && (
                      <span
                        className="max-w-[16rem] truncate text-xs"
                        title={target.codeRepository.name}
                      >
                        {target.codeRepository.name}
                      </span>
                    )}
                    {target.workflowRef && (
                      <code className="text-xs">{target.workflowRef}</code>
                    )}
                    {target.url && (
                      <code className="break-all text-xs">{target.url}</code>
                    )}
                    <span className="text-xs">
                      {target.defaultRef ?? t("defaultRefDefault")}
                    </span>
                    {target.provider !== "GENERIC_WEBHOOK" && (
                      <span className="text-xs">
                        {target.hasOwnCredentials
                          ? t("hasOwnCredentials")
                          : t("usesRepositoryCredentials")}
                      </span>
                    )}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={target.isEnabled}
                    onCheckedChange={(next: boolean) =>
                      void handleToggle(target, next)
                    }
                    aria-label={t("enabled")}
                    data-testid={`automation-target-enabled-toggle-${target.id}`}
                  />
                  <span className="text-sm text-muted-foreground">
                    {t("enabled")}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {target.lastVerifiedAt ? (
                    <span className="inline-flex items-center gap-1">
                      {target.lastVerifyError ? (
                        <AlertTriangle
                          className="h-3.5 w-3.5 text-amber-600"
                          aria-hidden
                        />
                      ) : (
                        <ShieldCheck
                          className="h-3.5 w-3.5 text-green-600"
                          aria-hidden
                        />
                      )}
                      <span>{t("lastVerified")}:</span>
                      <DateFormatter date={target.lastVerifiedAt} />
                      {target.lastVerifyError && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="underline decoration-dotted">
                              {t("verifyOkWithWarnings")}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            {target.lastVerifyError}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  ) : (
                    <span>{t("neverVerified")}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={verifying === target.id}
                    onClick={() => void handleVerify(target)}
                    data-testid={`automation-target-test-button-${target.id}`}
                  >
                    {verifying === target.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    <span>
                      {verifying === target.id ? t("verifying") : t("verify")}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(target);
                      setDialogOpen(true);
                    }}
                    data-testid={`automation-target-edit-button-${target.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                    <span>{tCommon("actions.edit")}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteTarget(target)}
                    data-testid={`automation-target-delete-button-${target.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{tCommon("actions.delete")}</span>
                  </Button>
                </div>
              </div>
              {renderVerifyResult(target)}
            </CardContent>
          </Card>
        ))
      )}

      <AutomationTargetDialog
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        target={editing}
        onSaved={(saved, secret) => {
          toast.success(t("saved"));
          if (secret) setRevealedSecret({ targetId: saved.id, secret });
          void refresh();
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent data-testid="automation-target-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="automation-target-delete-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className={buttonVariants({ variant: "destructive" })}
              data-testid="automation-target-delete-confirm"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
