"use client";

import { useTranslations } from "next-intl";
import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Integration } from "@prisma/client";

interface EditIntegrationButtonProps {
  integration: Integration;
  onEdit: (integration: Integration) => void;
}

export function EditIntegrationButton({ integration, onEdit }: EditIntegrationButtonProps) {
  const tCommon = useTranslations("common");

  return (
    <Button
      variant="ghost"
      onClick={() => onEdit(integration)}
      className="px-2 py-1 h-auto"
      title={tCommon("actions.edit")}
    >
      <SquarePen className="h-4 w-4" />
      <span className="sr-only">{tCommon("actions.edit")}</span>
    </Button>
  );
}
