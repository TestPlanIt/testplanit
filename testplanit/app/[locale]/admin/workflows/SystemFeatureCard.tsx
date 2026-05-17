"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useUpsertAppConfig } from "~/lib/hooks";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { Label } from "~/components/ui/label";

/**
 * System-level toggle for the review-and-approval feature (D-19 follow-up).
 *
 * Backing store is the `review_feature_enabled` AppConfig row. Admin users
 * toggle it from here and the change reflects to all clients on their next
 * refetch (~30s by default; an explicit query invalidation here makes the
 * change visible in the local tab immediately).
 *
 * Non-admin viewers see the resolved state read-only with a small notice
 * explaining the access constraint. AppConfig's `@@allow('all', auth().access
 * == 'ADMIN')` policy is the authoritative write gate; the UI disable is a
 * defensive layer so non-admins don't see a confusing 403 toast.
 */
export function SystemFeatureCard() {
  const t = useTranslations("admin.workflows.systemFeatureCard");
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { systemEnabled, isLoading } = useReviewFeatureEnabled();
  const upsertAppConfig = useUpsertAppConfig();

  const isAdmin = session?.user?.access === "ADMIN";
  const isEnabled = systemEnabled === true;
  const disabled = isLoading || upsertAppConfig.isPending || !isAdmin;

  const handleToggle = async (next: boolean) => {
    try {
      await upsertAppConfig.mutateAsync({
        where: { key: "review_feature_enabled" },
        create: { key: "review_feature_enabled", value: next },
        update: { value: next },
      });
      await queryClient.invalidateQueries({
        queryKey: ["config", "review-feature"],
      });
      toast.success(
        next ? t("updateSuccessEnabled") : t("updateSuccessDisabled")
      );
    } catch {
      toast.error(t("updateError"));
    }
  };

  return (
    <Card data-testid="system-feature-card">
      <CardHeader>
        <Label className="flex items-center gap-3">
          <Switch
            id="system-feature-toggle"
            data-testid="system-feature-toggle"
            aria-label={t("toggleAriaLabel")}
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={disabled}
          />
          <CardTitle>{t("title")}</CardTitle>
        </Label>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      {!isAdmin && (
        <CardContent>
          <p
            data-testid="system-feature-admin-only-notice"
            className="text-sm text-muted-foreground"
          >
            {t("adminOnlyNotice")}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
