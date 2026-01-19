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
  // 2. Project creator has access
  // 3. Users with Settings area permissions through their project role

  const isCreator = project.createdBy === session.user.id;
  const isAdmin = session.user.access === "ADMIN";

  // Check if user has Settings area permissions through their project role
  const { ApplicationArea } = await import("@prisma/client");

  const userProjectPerm = await db.userProjectPermission.findFirst({
    where: {
      userId: session.user.id,
      projectId: projectId,
    },
    include: {
      role: {
        include: {
          rolePermissions: true,
        },
      },
    },
  });

  const hasSettingsPermission = userProjectPerm?.role?.rolePermissions?.some(
    (perm) => perm.area === ApplicationArea.Settings
  );

  // Also check default role if user has no explicit permission
  const hasDefaultAccess =
    !userProjectPerm &&
    project &&
    (await db.projects.findFirst({
      where: {
        id: projectId,
        defaultAccessType: "GLOBAL_ROLE",
      },
    }));

  if (!isAdmin && !isCreator && !hasSettingsPermission && !hasDefaultAccess) {
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
