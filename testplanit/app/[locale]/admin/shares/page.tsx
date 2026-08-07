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
import { Suspense } from "react";
import { authOptions } from "~/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("reports.shareDialog.manageShares");
  return {
    title: t("adminTitle"),
  };
}

// Session-gated content: getServerSession reads headers, so it must stream
// behind Suspense rather than block the route shell.
async function AdminSharesContent() {
  const session = await getServerSession(authOptions);

  // Only ADMIN users can access this page
  if (!session?.user || session.user.access !== "ADMIN") {
    notFound();
  }

  return <ShareLinkList showProjectColumn={true} />;
}

export default async function AdminSharesPage() {
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
          <Suspense fallback={null}>
            <AdminSharesContent />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
