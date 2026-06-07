"use client";

import { Ban } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface RevokeScimTokenButtonProps {
  tokenId: string;
  onRevoke: () => void;
}

export function RevokeScimTokenButton({
  tokenId,
  onRevoke,
}: RevokeScimTokenButtonProps) {
  const t = useTranslations("admin.scim.revoke");

  return (
    <Button
      variant="destructive"
      onClick={onRevoke}
      className="px-2 py-1 h-auto"
      title={t("confirm")}
      data-testid={`scim-revoke-button-${tokenId}`}
    >
      <Ban className="h-4 w-4" />
      <span className="sr-only">{t("confirm")}</span>
    </Button>
  );
}
