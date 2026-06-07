"use client";

import { Activity, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { testScimProbeAction } from "~/app/actions/scimTokenActions";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TestScimButtonProps {
  tokenId: string;
}

export function TestScimButton({ tokenId }: TestScimButtonProps) {
  const t = useTranslations("admin.scim.probe");
  const [pending, setPending] = useState(false);

  const onClick = useCallback(async () => {
    setPending(true);
    try {
      const res = await testScimProbeAction(tokenId);
      if (res.ok) {
        toast.success(t("button"), {
          description: t("okBanner", { status: String(res.status) }),
        });
      } else {
        toast.error(t("button"), {
          description: t("failBanner", {
            status: String(res.status),
            reason: res.reason ?? "Unknown",
          }),
        });
      }
    } catch (err) {
      toast.error(t("button"), {
        description: err instanceof Error ? err.message : t("networkError"),
      });
    } finally {
      setPending(false);
    }
  }, [tokenId, t]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          onClick={onClick}
          disabled={pending}
          className="px-2 py-1 h-auto"
          data-testid={`scim-test-button-${tokenId}`}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Activity className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="sr-only">{t("button")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t("button")}</p>
      </TooltipContent>
    </Tooltip>
  );
}
