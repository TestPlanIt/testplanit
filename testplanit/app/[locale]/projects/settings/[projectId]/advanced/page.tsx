"use client";

import { ProjectIcon } from "@/components/ProjectIcon";
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
      // `name` + `iconUrl` are needed for the shared project-settings header
      // (matches the quickscript / ai-models sibling pages).
      select: {
        id: true,
        name: true,
        iconUrl: true,
        reviewWorkflowEnabled: true,
      },
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
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{t("title")}</span>
            </CardTitle>
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Review workflow toggle (Phase 2's single Advanced toggle).
              Future Advanced toggles can append additional <Card> sections
              below without restructuring this layout. */}
          <Card>
            <CardContent className="pt-6">
              {/* Switch on the LEFT of the label — matches the Admin >
                  Workflows SystemFeatureCard pattern so toggle placement
                  is consistent between the system-wide and per-project
                  controls for the same feature. */}
              <div className="space-y-2">
                <Label className="flex items-center gap-3">
                  <Switch
                    id="review-workflow-toggle"
                    data-testid="review-workflow-toggle"
                    checked={reviewWorkflowEnabled}
                    onCheckedChange={handleToggleReviewWorkflow}
                    disabled={projectLoading || updateProject.isPending}
                  />
                  <span className="text-base font-medium">
                    {t("reviewWorkflow.label")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("reviewWorkflow.description")}
                </p>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </main>
  );
}
