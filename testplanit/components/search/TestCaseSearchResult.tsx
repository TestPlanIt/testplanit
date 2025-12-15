import React from "react";
import { Trash2, Bot, ListChecks } from "lucide-react";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";

interface TestCaseSearchResultProps {
  testCase: {
    id?: number | string;
    name?: string;
    source?: string;
    isDeleted?: boolean;
  };
  highlight?: string;
  showIcon?: boolean;
}

export function TestCaseSearchResult({ 
  testCase, 
  highlight,
  showIcon = true,
}: TestCaseSearchResultProps) {
  // Determine which icon to show
  let icon = null;
  if (showIcon) {
    if (testCase.isDeleted) {
      icon = <Trash2 className="h-4 w-4" />;
    } else if (isAutomatedCaseSource(testCase.source)) {
      icon = <Bot className="h-4 w-4" />;
    } else {
      icon = <ListChecks className="h-4 w-4" />;
    }
  }

  return (
    <span className="flex items-center gap-1">
      {icon}
      {highlight ? (
        <span dangerouslySetInnerHTML={{ __html: highlight }} />
      ) : (
        testCase.name || `Case ${testCase.id || 'Unknown'}`
      )}
    </span>
  );
}