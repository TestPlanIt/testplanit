"use client";

import { useState, useEffect, useRef } from "react";
import { Session } from "next-auth";
import { PasswordGate } from "./PasswordGate";
import { SharedReportViewer } from "./SharedReportViewer";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface ShareContentProps {
  shareKey: string;
  shareData: any;
  session: Session | null;
}

export function ShareContent({ shareKey, shareData, session }: ShareContentProps) {
  const t = useTranslations("reports.sharedReport");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("common.errors");
  const tAuthBypass = useTranslations("reports.authBypass");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessGranted, setAccessGranted] = useState(false);
  const [fullShareData, setFullShareData] = useState<any>(null);

  // Track if view has been counted to prevent double-counting
  const viewCountedRef = useRef(false);
  const hasInitializedRef = useRef(false);

  // Check sessionStorage to see if this share has already been viewed in this session
  const getSessionViewKey = () => `share_viewed_${shareKey}`;

  const hasViewedInSession = () => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(getSessionViewKey()) === "true";
  };

  const markViewedInSession = () => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(getSessionViewKey(), "true");
  };

  // Check if user has project access (for auth bypass)
  const checkProjectAccess = async () => {
    if (!session) return false;

    // Prevent duplicate view counting
    if (viewCountedRef.current || hasViewedInSession()) return false;

    // Mark as counted BEFORE making the request to prevent race conditions
    viewCountedRef.current = true;
    markViewedInSession();

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

        // Show toast notification for auth bypass
        if (session && shareData.projectName) {
          const userName = session.user.name || session.user.email || "User";

          // Build full report URL with configuration
          let reportUrl: string | undefined;
          if (data.entityType === "REPORT" && data.projectId) {
            const config = shareData.entityConfig;
            const params = new URLSearchParams();

            if (config.reportType) params.set("reportType", config.reportType);
            if (config.startDate) params.set("startDate", config.startDate);
            if (config.endDate) params.set("endDate", config.endDate);
            if (config.dimensions) params.set("dimensions", Array.isArray(config.dimensions) ? config.dimensions.join(",") : config.dimensions);
            if (config.metrics) params.set("metrics", Array.isArray(config.metrics) ? config.metrics.join(",") : config.metrics);
            if (config.page) params.set("page", config.page.toString());
            if (config.pageSize) params.set("pageSize", config.pageSize.toString());

            reportUrl = `/projects/reports/${data.projectId}?${params.toString()}`;
          }

          toast.success(tAuthBypass("title"), {
            description: tAuthBypass("description", {
              userName,
              projectName: shareData.projectName
            }),
            duration: 5000,
            action: reportUrl ? {
              label: tAuthBypass("viewInApp"),
              onClick: () => {
                window.location.href = reportUrl;
              },
            } : undefined,
          });
        }

        return true;
      }

      // Reset flags on failure
      viewCountedRef.current = false;
      sessionStorage.removeItem(getSessionViewKey());
      return false;
    } catch (error) {
      // Reset flags on error
      viewCountedRef.current = false;
      sessionStorage.removeItem(getSessionViewKey());
      return false;
    }
  };

  // Fetch share data without incrementing view count (for refreshes)
  const fetchShareDataWithoutCounting = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get the verified token from sessionStorage (for password-protected shares)
      const tokenKey = `share_token_${shareKey}`;
      const stored = sessionStorage.getItem(tokenKey);
      let token = null;

      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          token = parsed.token;
        } catch (e) {
          // Invalid token, ignore
        }
      }

      const response = await fetch(`/api/share/${shareKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Handle authentication required
        if (errorData.requiresAuth) {
          window.location.href = `/en-US/signin?callbackUrl=/share/${shareKey}`;
          return;
        }

        throw new Error(errorData.error || tErrors("fetchFailed"));
      }

      const data = await response.json();
      setFullShareData(data);
      setAccessGranted(true);

      // Show toast notification for auth bypass (same as in checkProjectAccess)
      if (session && shareData.projectName && shareData.mode === "PASSWORD_PROTECTED") {
        const userName = session.user.name || session.user.email || "User";

        // Build full report URL with configuration
        let reportUrl: string | undefined;
        if (data.entityType === "REPORT" && data.projectId) {
          const config = shareData.entityConfig;
          const params = new URLSearchParams();

          if (config.reportType) params.set("reportType", config.reportType);
          if (config.startDate) params.set("startDate", config.startDate);
          if (config.endDate) params.set("endDate", config.endDate);
          if (config.dimensions) params.set("dimensions", Array.isArray(config.dimensions) ? config.dimensions.join(",") : config.dimensions);
          if (config.metrics) params.set("metrics", Array.isArray(config.metrics) ? config.metrics.join(",") : config.metrics);
          if (config.page) params.set("page", config.page.toString());
          if (config.pageSize) params.set("pageSize", config.pageSize.toString());

          reportUrl = `/projects/reports/${data.projectId}?${params.toString()}`;
        }

        toast.success(tAuthBypass("title"), {
          description: tAuthBypass("description", {
            userName,
            projectName: shareData.projectName
          }),
          duration: 5000,
          action: reportUrl ? {
            label: tAuthBypass("viewInApp"),
            onClick: () => {
              window.location.href = reportUrl;
            },
          } : undefined,
        });
      }
    } catch (error) {
      console.error("Error accessing share:", error);
      setError(error instanceof Error ? error.message : tErrors("unknown"));
    } finally {
      setIsLoading(false);
    }
  };

  // For PUBLIC mode, grant access immediately
  useEffect(() => {
    // Prevent duplicate execution (React Strict Mode can call this twice)
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    // Handle AUTHENTICATED mode - redirect to Reports page with config
    if (shareData.mode === "AUTHENTICATED" && session) {
      // Build URL params from entityConfig
      const config = shareData.entityConfig;
      const projectId = shareData.projectId;

      if (!config || typeof config !== "object") {
        console.error("Invalid share configuration:", config);
        setError(tErrors("somethingWentWrong"));
        return;
      }

      // Construct URL with report configuration
      const params = new URLSearchParams();

      if (config.reportType) params.set("reportType", config.reportType);
      if (config.startDate) params.set("startDate", config.startDate);
      if (config.endDate) params.set("endDate", config.endDate);
      if (config.dimensions) params.set("dimensions", Array.isArray(config.dimensions) ? config.dimensions.join(",") : config.dimensions);
      if (config.metrics) params.set("metrics", Array.isArray(config.metrics) ? config.metrics.join(",") : config.metrics);
      if (config.page) params.set("page", config.page.toString());
      if (config.pageSize) params.set("pageSize", config.pageSize.toString());

      // Redirect to appropriate Reports page
      const reportsUrl = projectId
        ? `/projects/reports/${projectId}?${params.toString()}`
        : `/reports?${params.toString()}`;

      // Increment view count before redirecting (only if not already counted)
      if (!hasViewedInSession()) {
        // Mark as counted BEFORE making the request to prevent race conditions
        markViewedInSession();

        fetch(`/api/share/${shareKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
          .then(() => {
            console.log("Redirecting to:", reportsUrl);
            window.location.href = reportsUrl;
          })
          .catch((error) => {
            console.error("Error counting view:", error);
            // Redirect anyway even if view counting fails
            console.log("Redirecting to:", reportsUrl);
            window.location.href = reportsUrl;
          });
      } else {
        // Already counted, just redirect
        console.log("Redirecting to:", reportsUrl);
        window.location.href = reportsUrl;
      }
      return;
    }

    // If already viewed in this session, just fetch data without counting
    if (hasViewedInSession()) {
      fetchShareDataWithoutCounting();
      return;
    }

    if (shareData.mode === "PUBLIC") {
      handlePasswordVerified();
    } else if (shareData.mode === "PASSWORD_PROTECTED" && session) {
      // Check if user has project access (bypass password)
      checkProjectAccess();
    }
  }, []);

  const handlePasswordVerified = async () => {
    // Prevent duplicate view counting
    if (viewCountedRef.current || hasViewedInSession()) {
      // Already counted, use initial shareData and grant access without making another API call
      setFullShareData(shareData);
      setAccessGranted(true);
      return;
    }

    // Mark as counted BEFORE making the request to prevent race conditions
    viewCountedRef.current = true;
    markViewedInSession();

    setIsLoading(true);
    setError(null);

    try {
      // Get the verified token from sessionStorage
      const tokenKey = `share_token_${shareKey}`;
      const stored = sessionStorage.getItem(tokenKey);
      let token = null;

      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          token = parsed.token;
        } catch (e) {
          // Invalid token, ignore
        }
      }

      const response = await fetch(`/api/share/${shareKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Handle authentication required
        if (errorData.requiresAuth) {
          window.location.href = `/en-US/signin?callbackUrl=/share/${shareKey}`;
          return;
        }

        throw new Error(errorData.error || tErrors("fetchFailed"));
      }

      const data = await response.json();
      setFullShareData(data);
      setAccessGranted(true);
    } catch (error) {
      console.error("Error accessing share:", error);
      setError(error instanceof Error ? error.message : tErrors("unknown"));
      // Reset the flags on error so user can retry
      viewCountedRef.current = false;
      sessionStorage.removeItem(getSessionViewKey());
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
          <p className="text-muted-foreground">{tCommon("loading")}</p>
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
          <AlertTitle>{tErrors("error")}</AlertTitle>
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
      <SharedReportViewer
        shareData={fullShareData}
        shareMode={shareData.mode}
        isAuthenticatedUser={!!session}
      />
    );
  }

  // Fallback loading state
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
