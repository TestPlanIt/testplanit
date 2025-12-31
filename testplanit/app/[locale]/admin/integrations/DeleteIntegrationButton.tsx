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
      variant="destructive"
      onClick={() => onDelete(integration)}
      className="px-2 py-1 h-auto"
      title={tCommon("actions.delete")}
    >
      <Trash2 className="h-4 w-4" />
      <span className="sr-only">{tCommon("actions.delete")}</span>
    </Button>
  );
}
