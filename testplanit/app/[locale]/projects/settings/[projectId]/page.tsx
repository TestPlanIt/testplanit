import { getTranslations } from "next-intl/server";
import { authOptions } from "~/server/auth";
import { getServerSession } from "next-auth/next";
import { enhance } from "@zenstackhq/runtime";
import { notFound } from "next/navigation";
import { Link } from "~/lib/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plug, Sparkles } from "lucide-react";
import { ProjectIcon } from "@/components/ProjectIcon";

interface PageProps {
  params: Promise<{
    projectId: string;
    locale: string;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const t = await getTranslations("projects.settings");
  return {
    title: t("title"),
  };
}

export default async function ProjectSettingsPage({ params }: PageProps) {
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

  // Check access to settings:
  // 1. System ADMIN users always have access
  // 2. System PROJECTADMIN users have access to any project they can see
  // 3. Project creator has access
  // 4. Users with Settings area permissions through their project role

  // Check if user is the project creator
  const isCreator = await db.projects.findFirst({
    where: {
      id: projectId,
      createdBy: session.user.id,
    },
  });

  // Check if user has Settings area permissions through their project role
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

  // If user has a role assigned, check if it has Settings permissions
  let hasSettingsPermission = false;
  if (userProjectPerm?.roleId) {
    const settingsPermission = await db.rolePermission.findFirst({
      where: {
        roleId: userProjectPerm.roleId,
        area: ApplicationArea.Settings,
        canAddEdit: true,
      },
    });
    hasSettingsPermission = !!settingsPermission;
  }

  // Also check if user has Settings permissions through their global role with GLOBAL_ROLE projects
  let hasGlobalRoleSettingsPermission = false;
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
      const globalRoleSettingsPermission = await db.rolePermission.findFirst({
        where: {
          roleId: user.roleId,
          area: ApplicationArea.Settings,
          canAddEdit: true,
        },
      });
      hasGlobalRoleSettingsPermission = !!globalRoleSettingsPermission;
    }
  }

  const hasSettingsAccess =
    session.user.access === "ADMIN" ||
    session.user.access === "PROJECTADMIN" ||
    !!isCreator ||
    hasSettingsPermission ||
    hasGlobalRoleSettingsPermission;

  if (!hasSettingsAccess) {
    notFound();
  }

  const t = await getTranslations("projects.settings");

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>{t("title")}</CardTitle>
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <Link href={`/projects/settings/${projectId}/integrations`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Plug className="h-6 w-6 text-primary" />
                    <CardTitle>{t("integrations.title")}</CardTitle>
                  </div>
                  <CardDescription>
                    {t("integrations.description")}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>

            <Link href={`/projects/settings/${projectId}/ai-models`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-6 w-6 text-primary" />
                    <CardTitle>{t("aiModels.title")}</CardTitle>
                  </div>
                  <CardDescription>{t("aiModels.description")}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
