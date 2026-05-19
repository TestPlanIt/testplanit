"use client";

import { Button } from "@/components/ui/button";
import { SquareStack } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ConfigureParametersButtonProps {
  parameterCount: number;
  canEdit: boolean;
  onOpen: () => void;
}

export function ConfigureParametersButton({
  parameterCount,
  canEdit,
  onOpen,
}: ConfigureParametersButtonProps) {
  const t = useTranslations("parameters");

  if (!canEdit) return null;

  const label =
    parameterCount === 0
      ? t("configureButtonEmpty")
      : t("configureButtonSet", { count: String(parameterCount) });

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onOpen}
      data-testid="configure-parameters-button"
      className=""
    >
      <SquareStack className="w-4 h-4" />
      {label}
    </Button>
  );
}
