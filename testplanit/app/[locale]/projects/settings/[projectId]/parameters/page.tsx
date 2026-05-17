"use client";

import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, SquareStack } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useFindFirstProjects } from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";
import { DatasetCreateDialog } from "../datasets/dataset-create-dialog";
import { DatasetsList } from "../datasets/datasets-list";
import { JunitIterationPropertyForm } from "../junit/junit-iteration-property-form";

/**
 * Project-scoped "Test Case Parameters" settings page.
 *
 * Combines two settings surfaces that used to live at separate routes:
 *   - Shared Datasets (was /settings/{projectId}/datasets)
 *   - JUnit Mapping  (was /settings/{projectId}/junit)
 *
 * Both are parameterized-test-case configuration; the merge keeps them
 * under a single SquareStack-iconed nav entry. The old routes redirect
 * to this page with the appropriate tab preselected (see the redirect
 * shims in ../junit/page.tsx and ../datasets/page.tsx) so existing
 * bookmarks keep working.
 *
 * Access (mirrors the prior pages):
 *   - ADMIN: unconditional
 *   - PROJECTADMIN: must be assigned to THIS project (WR-04 scope)
 */

type ParametersTab = "datasets" | "junit";

const DEFAULT_TAB: ParametersTab = "datasets";
const VALID_TABS: ParametersTab[] = ["datasets", "junit"];

function parseTab(raw: string | null): ParametersTab {
  return raw && (VALID_TABS as string[]).includes(raw)
    ? (raw as ParametersTab)
    : DEFAULT_TAB;
}

export default function ProjectParametersSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = parseInt(params.projectId as string);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const t = useTranslations("projects.settings.parameters");
  const tDatasets = useTranslations("projects.settings.datasets");
  const tCommon = useTranslations("common");

  const [createOpen, setCreateOpen] = useState(false);

  // Tab state is driven by the URL `?tab=` query so bookmarks/back work
  // and the old-URL redirects can land on a specific tab.
  const tab = useMemo(
    () => parseTab(searchParams?.get("tab") ?? null),
    [searchParams],
  );

  const handleTabChange = useCallback(
    (next: string) => {
      const nextTab = parseTab(next);
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (nextTab === DEFAULT_TAB) {
        sp.delete("tab");
      } else {
        sp.set("tab", nextTab);
      }
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const { data: project, isLoading: projectLoading } = useFindFirstProjects(
    {
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        junitIterationPropertyNames: true,
        assignedUsers: {
          where: { user: { id: session?.user?.id || "" } },
          select: { user: { select: { access: true } } },
        },
      },
    },
    { enabled: isAuthenticated },
  );

  useEffect(() => {
    if (!projectLoading && project && session?.user) {
      const isAssignedToThisProject =
        Array.isArray(project.assignedUsers) &&
        project.assignedUsers.length > 0;
      const hasAccess =
        session.user.access === "ADMIN" ||
        (session.user.access === "PROJECTADMIN" && isAssignedToThisProject);
      if (!hasAccess) notFound();
    } else if (!projectLoading && !project && session?.user) {
      notFound();
    }
  }, [project, projectLoading, session]);

  if (isAuthLoading || projectLoading) {
    return <Loading />;
  }
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <h2 className="text-2xl font-semibold mb-2">
            {tCommon("errors.projectNotFound")}
          </h2>
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
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle className="flex items-center gap-2">
              <SquareStack className="h-5 w-5" aria-hidden />
              <span>{t("title")}</span>
            </CardTitle>
            {tab === "datasets" && (
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                data-testid="dataset-create-button"
              >
                <Plus className="h-4 w-4" />
                {tDatasets("newButton")}
              </Button>
            )}
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
          <p className="text-sm text-muted-foreground pt-2">
            {t("description")}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs
            value={tab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <TabsList>
              <TabsTrigger
                value="datasets"
                data-testid="parameters-tab-datasets"
              >
                {t("tabDatasets")}
              </TabsTrigger>
              <TabsTrigger value="junit" data-testid="parameters-tab-junit">
                {t("tabJunit")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="datasets" className="pt-4">
              <DatasetsList projectId={projectId} />
            </TabsContent>
            <TabsContent value="junit" className="pt-4">
              <JunitIterationPropertyForm
                projectId={projectId}
                initialNames={
                  (project.junitIterationPropertyNames as
                    | readonly string[]
                    | undefined) ?? []
                }
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <DatasetCreateDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </main>
  );
}
