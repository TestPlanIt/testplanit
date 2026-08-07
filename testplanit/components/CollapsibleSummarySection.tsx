"use client";

import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const SUMMARY_VALUE = "summary";

interface CollapsibleSummarySectionProps {
  /** localStorage key holding the collapsed state, scoped per page+project. */
  storageKey: string;
  children: React.ReactNode;
}

/**
 * Accordion around a page's summary chart cards. Expanded by default; the
 * user's choice is remembered per project in localStorage. Hydrated in an
 * effect because localStorage isn't available during SSR and reading it
 * inline would hydrate-mismatch.
 */
export function CollapsibleSummarySection({
  storageKey,
  children,
}: CollapsibleSummarySectionProps) {
  const tCommon = useTranslations("common");
  const [value, setValue] = useState<string>(SUMMARY_VALUE);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "collapsed") {
        setValue("");
      }
    } catch {
      // localStorage unavailable (private mode) — stay expanded.
    }
  }, [storageKey]);

  const handleValueChange = (next: string) => {
    setValue(next);
    try {
      window.localStorage.setItem(
        storageKey,
        next === "" ? "collapsed" : "expanded"
      );
    } catch {
      // Persistence is best-effort.
    }
  };

  return (
    <Accordion
      type="single"
      collapsible
      value={value}
      onValueChange={handleValueChange}
      className="mb-6"
    >
      <AccordionItem value={SUMMARY_VALUE}>
        <AccordionTrigger data-testid="summary-section-toggle">
          {tCommon("fields.summary")}
        </AccordionTrigger>
        <AccordionContent className="px-3">{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export default CollapsibleSummarySection;
