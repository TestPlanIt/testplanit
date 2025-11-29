"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Integration } from "@prisma/client";

interface DeleteIntegrationButtonProps {
  integration: Integration;
  onDelete: (integration: Integration) => void;
}

export function DeleteIntegrationButton({ integration, onDelete }: DeleteIntegrationButtonProps) {
  const tCommon = useTranslations("common");

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onDelete(integration)}
      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
      title={tCommon("actions.delete")}
    >
      <Trash2 className="h-4 w-4" />
      <span className="sr-only">{tCommon("actions.delete")}</span>
    </Button>
  );
}
