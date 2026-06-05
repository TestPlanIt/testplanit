"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { testScimProbeAction } from "~/app/actions/scimTokenActions";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface TestScimButtonProps {
  tokenId: string;
}

interface ProbeResultState {
  ok: boolean;
  status: number;
  reason?: string;
}

export function TestScimButton({ tokenId }: TestScimButtonProps) {
  const t = useTranslations("admin.scim.probe");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProbeResultState | null>(null);

  const onClick = useCallback(async () => {
    // Clear any prior banner BEFORE the new probe runs so the row never
    // carries two banners at once (no-stacking invariant).
    setResult(null);
    setPending(true);
    try {
      const res = await testScimProbeAction(tokenId);
      setResult({ ok: res.ok, status: res.status, reason: res.reason });
    } catch (err) {
      setResult({
        ok: false,
        status: 0,
        reason: err instanceof Error ? err.message : t("networkError"),
      });
    } finally {
      setPending(false);
    }
  }, [tokenId, t]);

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={pending}
        data-testid={`scim-test-button-${tokenId}`}
      >
        {pending && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {pending ? t("testing") : t("button")}
      </Button>
      {result &&
        (result.ok ? (
          <Alert
            role="status"
            className="mt-2 border-success bg-success/10 text-success-foreground"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              {t("okBanner", { status: String(result.status) })}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert role="alert" variant="destructive" className="mt-2">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              {t("failBanner", {
                status: String(result.status),
                reason: result.reason ?? "Unknown",
              })}
            </AlertDescription>
          </Alert>
        ))}
    </div>
  );
}
