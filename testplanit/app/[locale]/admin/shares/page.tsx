import { ShareLinkList } from "@/components/share/ShareLinkList";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { getServerSession } from "next-auth/next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { authOptions } from "~/server/auth";

interface PageProps {
  params: Promise<{
    locale: string;
  }>;
}

export async function generateMetadata({ params: _params }: PageProps) {
  const t = await getTranslations("reports.shareDialog.manageShares");
  return {
    title: t("adminTitle"),
  };
}

export default async function AdminSharesPage({ params: _params }: PageProps) {
  const session = await getServerSession(authOptions);

  // Only ADMIN users can access this page
  if (!session?.user || session.user.access !== "ADMIN") {
    notFound();
  }

  const t = await getTranslations("reports.shareDialog.manageShares");

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2 pb-2 pt-1">
            <CardTitle>{t("adminTitle")}</CardTitle>
          </SectionHeader>
          <CardDescription>{t("adminDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ShareLinkList showProjectColumn={true} />
        </CardContent>
      </Card>
    </main>
  );
}
