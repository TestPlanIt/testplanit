import { ShareContent } from "@/components/share/ShareContent";
import { SharedReportLoading } from "@/components/share/SharedReportLoading";
import { PageTitle } from "@/components/ui/typography";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { internalAppUrl } from "~/lib/internalAppUrl";
import { redirect } from "~/lib/navigation";
import { authOptions } from "~/server/auth";

interface SharePageProps {
  params: Promise<{
    shareKey: string;
    locale: string;
  }>;
}

export const dynamic = "force-dynamic";

async function fetchShareMetadata(shareKey: string) {
  // The server's own address, not the browser-facing NEXTAUTH_URL.
  const baseUrl = internalAppUrl();

  try {
    // Forward the viewer's session so a saved report resolves for its owner.
    const cookie = (await headers()).get("cookie");
    const response = await fetch(`${baseUrl}/api/share/${shareKey}`, {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined,
    });

    // Parse response body even for error status codes (403 for revoked/expired, 404 for not found)
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      // Return error data with status flags (revoked, expired, deleted)
      return data;
    }

    return data;
  } catch (error) {
    console.error("Error fetching share metadata:", error);
    return null;
  }
}

export default async function SharePage({ params }: SharePageProps) {
  const { shareKey } = await params;
  const session = await getServerSession(authOptions);
  const t = await getTranslations("reports.shareDialog.status");

  // Fetch share link metadata
  const shareData = await fetchShareMetadata(shareKey);

  if (!shareData) {
    notFound();
  }

  // Check if revoked
  if (shareData.revoked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md text-center">
          <PageTitle as="h1" className="mb-2">
            {t("revoked.title")}
          </PageTitle>
          <p className="text-muted-foreground">{t("revoked.description")}</p>
        </div>
      </div>
    );
  }

  // Check if expired
  if (shareData.expired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md text-center">
          <PageTitle as="h1" className="mb-2">
            {t("expired.title")}
          </PageTitle>
          <p className="text-muted-foreground">{t("expired.description")}</p>
        </div>
      </div>
    );
  }

  // Handle AUTHENTICATED mode
  if (shareData.mode === "AUTHENTICATED") {
    if (!session) {
      // Redirect to signin with callback
      redirect({
        href: `/signin?callbackUrl=/share/${shareKey}`,
        locale: "en-US",
      });
    }

    // User is authenticated, ShareContent will handle project access check
  }

  // For PUBLIC and PASSWORD_PROTECTED modes, ShareContent will handle the logic
  return (
    <Suspense fallback={<SharedReportLoading />}>
      <ShareContent
        shareKey={shareKey}
        shareData={shareData}
        session={session}
      />
    </Suspense>
  );
}
