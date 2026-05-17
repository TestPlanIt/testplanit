"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { notFound, useParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useFindUniqueProjects, useUpdateProjects } from "~/lib/hooks";

export default function AdvancedPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { data: session, status } = useSession();
  const t = useTranslations("projects.settings.advanced");

  const { data: project, isLoading: projectLoading } = useFindUniqueProjects(
    {
      where: { id: projectId },
      select: { id: true, reviewWorkflowEnabled: true },
    },
    {
      enabled: status === "authenticated" && Number.isFinite(projectId),
    }
  );

  const updateProject = useUpdateProjects();

  // Access guard: ADMIN or PROJECTADMIN per D-18 / Open Question 4.
  // Mirrors the quickscript page guard: imperative `notFound()` from useEffect
  // so unauthorized users hit the global not-found surface.
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) return;
    const access = session.user.access;
    if (access !== "ADMIN" && access !== "PROJECTADMIN") {
      notFound();
    }
  }, [session, status]);

  // Bail BEFORE we render the page body for ineligible users — useEffect runs
  // post-paint, so we also need a synchronous guard so the test (and real
  // users) never see the toggle for the wrong access level.
  if (session?.user) {
    const access = session.user.access;
    if (access !== "ADMIN" && access !== "PROJECTADMIN") {
      notFound();
    }
  }

  const reviewWorkflowEnabled = project?.reviewWorkflowEnabled ?? true;

  const handleToggleReviewWorkflow = async (enabled: boolean) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { reviewWorkflowEnabled: enabled },
      });
      toast.success(
        enabled
          ? t("reviewWorkflow.enabledToast")
          : t("reviewWorkflow.disabledToast")
      );
    } catch {
      toast.error(t("reviewWorkflow.saveError"));
    }
  };

  return (
    <main data-testid="advanced-settings-page">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Review workflow toggle (Phase 2's single Advanced toggle).
              Future Advanced toggles can append additional <Card> sections
              below without restructuring this layout. */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="review-workflow-toggle"
                    className="text-base font-medium"
                  >
                    {t("reviewWorkflow.label")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("reviewWorkflow.description")}
                  </p>
                </div>
                <Switch
                  id="review-workflow-toggle"
                  data-testid="review-workflow-toggle"
                  checked={reviewWorkflowEnabled}
                  onCheckedChange={handleToggleReviewWorkflow}
                  disabled={projectLoading || updateProject.isPending}
                />
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </main>
  );
}
