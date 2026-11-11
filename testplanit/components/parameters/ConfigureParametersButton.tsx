"use client";

import { Button } from "@/components/ui/button";
import { SquareStack } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ConfigureParametersButtonProps {
  parameterCount: number;
  canEdit: boolean;
  onOpen: () => void;
  /** When true, collapse to an icon-only button; the label expands on hover
   * (mirrors the header action buttons' narrow-mode pattern). */
  compact?: boolean;
}

export function ConfigureParametersButton({
  parameterCount,
  canEdit,
  onOpen,
  compact = false,
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
      className={
        compact
          ? "group gap-0 px-2 transition-all duration-200 hover:gap-2 hover:px-2"
          : ""
      }
    >
      <SquareStack className="h-4 w-4 shrink-0" />
      {compact ? (
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          {label}
        </span>
      ) : (
        label
      )}
    </Button>
  );
}
