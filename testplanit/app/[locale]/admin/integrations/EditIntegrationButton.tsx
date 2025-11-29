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
      variant="secondary"
      size="sm"
      onClick={() => onEdit(integration)}
      className="h-8 w-8 p-0"
      title={tCommon("actions.edit")}
    >
      <SquarePen className="h-4 w-4" />
      <span className="sr-only">{tCommon("actions.edit")}</span>
    </Button>
  );
}
