import { getTranslations } from "next-intl/server";
import { authOptions } from "~/server/auth";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { ShareLinkList } from "@/components/share/ShareLinkList";

interface PageProps {
  params: Promise<{
    locale: string;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const t = await getTranslations("reports.shareDialog.manageShares");
  return {
    title: t("adminTitle"),
  };
}

export default async function AdminSharesPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);

  // Only ADMIN users can access this page
  if (!session?.user) {
    const { locale } = await params;
    redirect(`/${locale}/signin`);
  }

  if (session.user.access !== "ADMIN") {
    notFound();
  }

  const t = await getTranslations("reports.shareDialog.manageShares");

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("adminTitle")}</h1>
        <p className="text-muted-foreground">{t("adminDescription")}</p>
      </div>

      <ShareLinkList showProjectColumn={true} />
    </div>
  );
}
