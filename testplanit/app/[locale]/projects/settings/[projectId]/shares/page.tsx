import { getTranslations } from "next-intl/server";
import { authOptions } from "~/server/auth";
import { getServerSession } from "next-auth/next";
import { enhance } from "@zenstackhq/runtime";
import { notFound } from "next/navigation";
import { ShareLinkList } from "@/components/share/ShareLinkList";

interface PageProps {
  params: Promise<{
    projectId: string;
    locale: string;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const t = await getTranslations("reports.shareDialog");
  return {
    title: t("manageShares.title"),
  };
}

export default async function ProjectSharesPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    notFound();
  }

  const { prisma } = await import("@/lib/prisma");
  const db = enhance(prisma, { user: session.user as any });
  const { projectId: projectIdParam } = await params;
  const projectId = parseInt(projectIdParam);

  // Check if the project exists and user has access
  const project = await db.projects.findFirst({
    where: {
      id: projectId,
    },
    select: {
      id: true,
      name: true,
      createdBy: true,
    },
  });

  if (!project) {
    notFound();
  }

  // Check access to settings:
  // 1. System ADMIN users always have access
  // 2. System PROJECTADMIN users assigned to this project have access
  // 3. Project creator has access
  // 4. Users with Settings area permissions through their project role
  // 5. Users with Settings permissions through their global role (for GLOBAL_ROLE projects)

  const isCreator = project.createdBy === session.user.id;
  const isAdmin = session.user.access === "ADMIN";

  // Check if user is PROJECTADMIN and assigned to this project
  const isProjectAdmin =
    session.user.access === "PROJECTADMIN" &&
    !!(await db.projectAssignment.findFirst({
      where: {
        userId: session.user.id,
        projectId: projectId,
      },
    }));

  // Check if user has Settings area permissions through their project role
  const { ApplicationArea } = await import("@prisma/client");

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
    isAdmin ||
    isProjectAdmin ||
    isCreator ||
    hasSettingsPermission ||
    hasGlobalRoleSettingsPermission;

  if (!hasSettingsAccess) {
    notFound();
  }

  const t = await getTranslations("reports.shareDialog.manageShares");

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <ShareLinkList projectId={projectId} showProjectColumn={false} />
    </div>
  );
}
