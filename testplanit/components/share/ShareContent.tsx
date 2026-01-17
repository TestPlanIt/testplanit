"use client";

import { useState, useEffect } from "react";
import { Session } from "next-auth";
import { PasswordGate } from "./PasswordGate";
import { SharedReportViewer } from "./SharedReportViewer";
import { AuthBypassPrompt } from "./AuthBypassPrompt";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ShareContentProps {
  shareKey: string;
  shareData: any;
  session: Session | null;
}

export function ShareContent({ shareKey, shareData, session }: ShareContentProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessGranted, setAccessGranted] = useState(false);
  const [fullShareData, setFullShareData] = useState<any>(null);
  const [showAuthBypass, setShowAuthBypass] = useState(false);

  // Check if user has project access (for auth bypass)
  const checkProjectAccess = async () => {
    if (!session) return false;

    // Call the share API to check if user has access
    try {
      const response = await fetch(`/api/share/${shareKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();
        setFullShareData(data);
        setAccessGranted(true);
        setShowAuthBypass(true);
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  };

  // For PUBLIC mode, grant access immediately
  useEffect(() => {
    if (shareData.mode === "PUBLIC") {
      handlePasswordVerified();
    } else if (shareData.mode === "PASSWORD_PROTECTED" && session) {
      // Check if user has project access (bypass password)
      checkProjectAccess();
    } else if (shareData.mode === "AUTHENTICATED" && session) {
      // User is authenticated, grant access
      handlePasswordVerified();
    }
  }, []);

  const handlePasswordVerified = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/share/${shareKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Handle authentication required
        if (errorData.requiresAuth) {
          window.location.href = `/en-US/signin?callbackUrl=/share/${shareKey}`;
          return;
        }

        throw new Error(errorData.error || "Failed to access share link");
      }

      const data = await response.json();
      setFullShareData(data);
      setAccessGranted(true);
    } catch (error) {
      console.error("Error accessing share:", error);
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Loading shared content...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show password gate for PASSWORD_PROTECTED mode (if user doesn't have project access)
  if (
    shareData.mode === "PASSWORD_PROTECTED" &&
    !accessGranted &&
    shareData.requiresPassword
  ) {
    return (
      <PasswordGate
        shareKey={shareKey}
        onVerified={handlePasswordVerified}
        projectName={shareData.projectName}
      />
    );
  }

  // Show content if access is granted
  if (accessGranted && fullShareData) {
    return (
      <>
        {showAuthBypass && session && (
          <AuthBypassPrompt
            userName={session.user.name || session.user.email || "User"}
            projectName={shareData.projectName}
            shareData={fullShareData}
          />
        )}
        <SharedReportViewer
          shareData={fullShareData}
          shareMode={shareData.mode}
        />
      </>
    );
  }

  // Fallback loading state
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
