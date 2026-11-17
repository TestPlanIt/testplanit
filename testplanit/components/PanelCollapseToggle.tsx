"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "~/utils";

/** Expand/collapse chevron for a case detail panel's card header. */
export const PanelCollapseToggle: React.FC<{
  collapsed: boolean;
  onToggle: () => void;
  testId: string;
}> = ({ collapsed, onToggle, testId }) => {
  const tCommon = useTranslations("common");
  const label = collapsed
    ? tCommon("actions.expand")
    : tCommon("actions.collapse");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      data-testid={testId}
      onClick={onToggle}
    >
      <ChevronDown
        className={cn(
          "h-4 w-4 transition-transform duration-200",
          collapsed && "-rotate-90 rtl:rotate-90"
        )}
      />
    </Button>
  );
};
