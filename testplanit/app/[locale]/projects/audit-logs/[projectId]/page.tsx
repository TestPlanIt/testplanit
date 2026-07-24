"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProjectAuditLog } from "~/components/projects/ProjectAuditLog";
import { useRequireAuth } from "~/hooks/useRequireAuth";

export default function ProjectAuditLogsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const t = useTranslations("admin.menu");
  const tAudit = useTranslations("admin.auditLogs");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  // Export lives in ProjectAuditLog (owns the filter state); it reports its
  // handler + state up so the button can render in the header, like admin.
  const [exportState, setExportState] = useState<{
    canExport: boolean;
    isExporting: boolean;
    exportCsv: () => void;
  } | null>(null);

  // Fetch project data (allow global admin access or project assignment)
  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        assignedUsers: {
          where: {
            user: {
              id: session?.user?.id || "",
            },
          },
          select: {
            user: {
              select: {
                access: true,
              },
            },
          },
        },
      },
    },
    {
      enabled: status === "authenticated",
      retry: 3,
      retryDelay: 1000,
    }
  );

  // Access control check - must be ADMIN or PROJECTADMIN
  useEffect(() => {
    if (!projectLoading && project && session?.user) {
      const hasAccess =
        session.user.access === "ADMIN" ||
        session.user.access === "PROJECTADMIN";

      if (!hasAccess) {
        notFound();
      }
    } else if (!projectLoading && !project && session?.user) {
      notFound();
    }
  }, [project, projectLoading, session]);

  if (isAuthLoading) {
    return <Loading />;
  }

  if (projectLoading) {
    return <Loading />;
  }

  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-100 h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
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
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{t("auditLogs")}</CardTitle>
              <HelpPopover helpKey="projectAuditLogs" />
            </SectionHeader>
            <Button
              variant="outline"
              onClick={() => exportState?.exportCsv()}
              disabled={!exportState?.canExport || exportState?.isExporting}
              aria-label={tAudit("exportCsv")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <Download className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                {exportState?.isExporting
                  ? tGlobal("repository.exportModal.exporting")
                  : tAudit("exportCsv")}
              </span>
            </Button>
          </div>
          <CardDescription>
            <span className="flex items-center gap-2 uppercase">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectAuditLog
            projectId={projectId}
            onExportStateChange={setExportState}
          />
        </CardContent>
      </Card>
    </main>
  );
}
