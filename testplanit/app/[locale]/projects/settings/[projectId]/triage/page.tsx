"use client";

import { Loading } from "@/components/Loading";
import {
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PageCardHeader,
  ProjectHeaderInfo,
} from "@/components/ui/page-card-header";
import { Switch } from "@/components/ui/switch";
import { PageTitle } from "@/components/ui/typography";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Fingerprint, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { ApplicationArea } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

type BackfillStatus = {
  state: "none" | "waiting" | "active" | "completed" | "failed" | string;
  processed?: number;
};

const POLL_INTERVAL_MS = 3000;

export default function TriageSettingsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const t = useTranslations("triage.settings");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        failureTriageEnabled: true,
        failureTriageAutoClassify: true,
        quarantineAutoRelease: true,
        quarantineAutoReleasePasses: true,
      },
    },
    { enabled: isAuthenticated }
  );
  const updateProject = useClientQueries(schema).projects.useUpdate();
  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;
    if (!project || !isProjectAdmin) notFound();
  }, [project, projectLoading, permissionsLoading, isProjectAdmin, session]);

  const [backfill, setBackfill] = useState<BackfillStatus>({ state: "none" });
  const [starting, setStarting] = useState(false);
  const backfillRunning =
    backfill.state === "waiting" ||
    backfill.state === "active" ||
    backfill.state === "delayed";

  const pollBackfill = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/triage/backfill`);
      if (!res.ok) return;
      const next = (await res.json()) as BackfillStatus;
      setBackfill((prev) => {
        if (
          prev.state !== "none" &&
          prev.state !== "completed" &&
          prev.state !== "failed"
        ) {
          if (next.state === "completed") toast.success(t("backfillDone"));
          if (next.state === "failed") toast.error(t("backfillFailed"));
        }
        return next;
      });
    } catch {
      // Status is informational; a failed poll just tries again.
    }
  }, [projectId, t]);

  useEffect(() => {
    if (!isProjectAdmin) return;
    void pollBackfill();
  }, [isProjectAdmin, pollBackfill]);

  useEffect(() => {
    if (!backfillRunning) return;
    const timer = setInterval(() => void pollBackfill(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [backfillRunning, pollBackfill]);

  const toggle = async (
    field:
      | "failureTriageEnabled"
      | "failureTriageAutoClassify"
      | "quarantineAutoRelease",
    value: boolean
  ) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { [field]: value },
      });
      if (field === "failureTriageEnabled") {
        toast.success(value ? t("enabledToast") : t("disabledToast"));
      } else if (field === "failureTriageAutoClassify") {
        toast.success(
          value ? t("autoClassifyOnToast") : t("autoClassifyOffToast")
        );
      } else {
        toast.success(
          value ? t("autoReleaseOnToast") : t("autoReleaseOffToast")
        );
      }
    } catch (error) {
      console.error("Failed to update triage settings:", error);
      toast.error(tCommon("errors.error"));
    }
  };

  const [passesDraft, setPassesDraft] = useState<string | null>(null);
  const savePasses = async () => {
    if (passesDraft === null) return;
    const parsed = Number(passesDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      toast.error(t("autoReleasePassesInvalid"));
      return;
    }
    if (parsed === project?.quarantineAutoReleasePasses) {
      setPassesDraft(null);
      return;
    }
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { quarantineAutoReleasePasses: parsed },
      });
      toast.success(t("autoReleasePassesSaved", { count: parsed }));
      setPassesDraft(null);
    } catch (error) {
      console.error("Failed to update triage settings:", error);
      toast.error(tCommon("errors.error"));
    }
  };

  const startBackfill = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/triage/backfill`, {
        method: "POST",
      });
      if (res.status === 409) {
        setBackfill({ state: "active" });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(
          res.status === 503
            ? t("backfillQueueUnavailable")
            : (body.error ?? tCommon("errors.error"))
        );
        return;
      }
      toast.success(t("backfillStarted"));
      setBackfill({ state: "waiting", processed: 0 });
    } catch {
      toast.error(tCommon("errors.error"));
    } finally {
      setStarting(false);
    }
  };

  if (isAuthLoading || projectLoading || permissionsLoading) return <Loading />;
  if (!project) {
    return (
      <Card className="flex h-full w-full min-w-[400px] flex-col">
        <CardContent className="flex h-full flex-col items-center justify-center">
          <PageTitle className="mb-2">
            {tCommon("errors.projectNotFound")}
          </PageTitle>
          <p className="text-muted-foreground">
            {tCommon("errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <main>
      <Card>
        <PageCardHeader
          className="w-full"
          title={tCommon("pageTitles.triage")}
          helpKey="projectTriageSettings"
          description={<ProjectHeaderInfo project={project} />}
          actions={
            <Button
              variant="outline"
              className={collapsibleActionClass()}
              onClick={() => router.push(`/projects/triage/${projectId}`)}
              data-testid="triage-open-button"
            >
              <ActionButtonContent icon={Fingerprint} label={t("openTriage")} />
            </Button>
          }
        />
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">{t("description")}</p>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="triage-enabled-toggle"
                  checked={project.failureTriageEnabled}
                  onCheckedChange={(value) =>
                    void toggle("failureTriageEnabled", value)
                  }
                  disabled={updateProject.isPending}
                  data-testid="triage-enabled-toggle"
                />
                <Label htmlFor="triage-enabled-toggle">
                  {t("enableLabel")}
                </Label>
                <HelpPopover helpKey="projectTriageSettings" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("enableDescription")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="triage-auto-classify-toggle"
                  checked={project.failureTriageAutoClassify}
                  onCheckedChange={(value) =>
                    void toggle("failureTriageAutoClassify", value)
                  }
                  disabled={
                    updateProject.isPending || !project.failureTriageEnabled
                  }
                  data-testid="triage-auto-classify-toggle"
                />
                <Label htmlFor="triage-auto-classify-toggle">
                  {t("autoClassifyLabel")}
                </Label>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("autoClassifyDescription")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  id="triage-auto-release-toggle"
                  checked={project.quarantineAutoRelease}
                  onCheckedChange={(value) =>
                    void toggle("quarantineAutoRelease", value)
                  }
                  disabled={
                    updateProject.isPending || !project.failureTriageEnabled
                  }
                  data-testid="triage-auto-release-toggle"
                />
                <Label htmlFor="triage-auto-release-toggle">
                  {t("autoReleaseLabel")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="triage-auto-release-passes"
                    type="number"
                    min={1}
                    max={100}
                    className="h-8 w-20"
                    value={
                      passesDraft ?? String(project.quarantineAutoReleasePasses)
                    }
                    onChange={(event) => setPassesDraft(event.target.value)}
                    onBlur={() => void savePasses()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    disabled={
                      updateProject.isPending ||
                      !project.failureTriageEnabled ||
                      !project.quarantineAutoRelease
                    }
                    aria-label={t("autoReleasePassesLabel")}
                    data-testid="triage-auto-release-passes"
                  />
                  <Label
                    htmlFor="triage-auto-release-passes"
                    className="font-normal"
                  >
                    {t("autoReleasePassesLabel")}
                  </Label>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("autoReleaseDescription")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("backfillLabel")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("backfillDescription")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void startBackfill()}
                  disabled={
                    starting || backfillRunning || !project.failureTriageEnabled
                  }
                  data-testid="triage-backfill-button"
                >
                  {starting || backfillRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {t("backfillLabel")}
                </Button>
              </div>
              {backfillRunning && (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="triage-backfill-status"
                >
                  {t("backfillRunning", { processed: backfill.processed ?? 0 })}
                </p>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </main>
  );
}
