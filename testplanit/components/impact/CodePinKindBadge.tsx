"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { CodePinKind } from "~/hooks/useCodePins";
import { cn } from "~/utils";

const KIND_LABEL_KEY: Record<CodePinKind, string> = {
  FILE: "kindFile",
  RANGE: "kindRange",
  SYMBOL: "kindSymbol",
  GLOB: "kindGlob",
};

interface CodePinKindBadgeProps {
  kind: CodePinKind;
  className?: string;
}

export function CodePinKindBadge({ kind, className }: CodePinKindBadgeProps) {
  const t = useTranslations("repository.codePins");
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 whitespace-nowrap", className)}
      data-testid={`code-pin-kind-badge-${kind}`}
    >
      {t(KIND_LABEL_KEY[kind])}
    </Badge>
  );
}

export default CodePinKindBadge;
