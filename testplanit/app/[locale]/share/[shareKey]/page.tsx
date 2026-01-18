import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { notFound, redirect } from "next/navigation";
import { ShareContent } from "@/components/share/ShareContent";
import { Loader2 } from "lucide-react";

interface SharePageProps {
  params: Promise<{
    shareKey: string;
  }>;
}

export const dynamic = "force-dynamic";

async function fetchShareMetadata(shareKey: string) {
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const host = process.env.NEXTAUTH_URL?.replace(/^https?:\/\//, "") || "localhost:3000";

  try {
    const response = await fetch(`${protocol}://${host}/api/share/${shareKey}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch (error) {
    console.error("Error fetching share metadata:", error);
    return null;
  }
}

export default async function SharePage({ params }: SharePageProps) {
  const { shareKey } = await params;
  const session = await getServerSession(authOptions);

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
          <h1 className="text-2xl font-bold mb-2">Share Link Revoked</h1>
          <p className="text-muted-foreground">
            This share link has been revoked and is no longer accessible.
          </p>
        </div>
      </div>
    );
  }

  // Check if expired
  if (shareData.expired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Share Link Expired</h1>
          <p className="text-muted-foreground">
            This share link has expired and is no longer accessible.
          </p>
        </div>
      </div>
    );
  }

  // Handle AUTHENTICATED mode
  if (shareData.mode === "AUTHENTICATED") {
    if (!session) {
      // Redirect to signin with callback
      redirect(`/en-US/signin?callbackUrl=/share/${shareKey}`);
    }

    // User is authenticated, ShareContent will handle project access check
  }

  // For PUBLIC and PASSWORD_PROTECTED modes, ShareContent will handle the logic
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ShareContent shareKey={shareKey} shareData={shareData} session={session} />
    </Suspense>
  );
}
