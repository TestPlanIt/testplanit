import { getTranslations } from "next-intl/server";
import { authOptions } from "~/server/auth";
import { getServerSession } from "next-auth/next";
import { enhance } from "@zenstackhq/runtime";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectIcon } from "@/components/ProjectIcon";
import { ReportBuilder } from "~/components/reports/ReportBuilder";

interface PageProps {
  params: Promise<{
    projectId: string;
    locale: string;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const t = await getTranslations("reports.ui");
  return {
    title: t("projectReports"),
  };
}

export default async function ProjectReportsPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    notFound();
  }

  const { prisma } = await import("@/lib/prisma");
  const db = enhance(prisma, { user: session.user as any });
  const { projectId: projectIdParam } = await params;
  const projectId = parseInt(projectIdParam);

  // First check if the project exists and user has basic access to it
  const project = await db.projects.findFirst({
    where: {
      id: projectId,
    },
    select: {
      id: true,
      name: true,
      iconUrl: true,
      defaultAccessType: true,
      defaultRoleId: true,
    },
  });

  if (!project) {
    notFound();
  }

  // Check access to reports:
  // 1. System ADMIN users always have access
  // 2. System PROJECTADMIN users have access to any project they can see
  // 3. Users with Reporting area permissions through their project role

  const { ApplicationArea } = await import("@prisma/client");

  // Get user's project permission with their role
  const userProjectPerm = await db.userProjectPermission.findFirst({
    where: {
      userId: session.user.id,
      projectId: projectId,
      accessType: {
        not: "NO_ACCESS",
      },
    },
  });

  // If user has a role assigned, check if it has Reporting permissions
  let hasReportingPermission = false;
  if (userProjectPerm?.roleId) {
    const reportingPermission = await db.rolePermission.findFirst({
      where: {
        roleId: userProjectPerm.roleId,
        area: ApplicationArea.Reporting,
        OR: [{ canAddEdit: true }, { canDelete: true }],
      },
    });
    hasReportingPermission = !!reportingPermission;
  }

  // Also check if user has Reporting permissions through their global role with GLOBAL_ROLE projects
  let hasGlobalRoleReportingPermission = false;
  if (project.defaultAccessType === "GLOBAL_ROLE") {
    // Get the user's global role
    const user = await db.user.findFirst({
      where: {
        id: session.user.id,
      },
      select: {
        roleId: true,
      },
    });

    if (user?.roleId) {
      const globalRoleReportingPermission = await db.rolePermission.findFirst({
        where: {
          roleId: user.roleId,
          area: ApplicationArea.Reporting,
          OR: [{ canAddEdit: true }, { canDelete: true }],
        },
      });
      hasGlobalRoleReportingPermission = !!globalRoleReportingPermission;
    }
  }

  const hasReportsAccess =
    session.user.access === "ADMIN" ||
    session.user.access === "PROJECTADMIN" ||
    hasReportingPermission ||
    hasGlobalRoleReportingPermission;

  if (!hasReportsAccess) {
    notFound();
  }

  const t = await getTranslations("reports.ui");

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>{t("projectReports")}</CardTitle>
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ReportBuilder
            mode="project"
            projectId={projectId}
          />
        </CardContent>
      </Card>
    </main>
  );
}
