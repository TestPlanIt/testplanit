"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Bug } from "lucide-react";
import { SearchIssuesDialog } from "./search-issues-dialog";

interface SelectedIssue {
  id: string | number;  // Can be string for external issues
  key: string;
  title: string;
  url?: string;
}

interface IssueSelectorProps {
  projectId: number;
  selectedIssues: SelectedIssue[];
  onIssuesChange: (issues: SelectedIssue[]) => void;
  disabled?: boolean;
}

export function IssueSelector({
  projectId,
  selectedIssues,
  onIssuesChange,
  disabled = false,
}: IssueSelectorProps) {
  const t = useTranslations();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const handleRemoveIssue = (issueId: string | number) => {
    onIssuesChange(selectedIssues.filter((issue) => issue.id !== issueId));
  };

  const handleAddIssue = (issue: any) => {
    if (issue.isExternal) {
      const newIssue: SelectedIssue = {
        id: issue.id,  // Keep original ID (string or number)
        key: issue.externalKey || issue.key || String(issue.id),
        title: issue.title,
        url: issue.externalUrl || issue.url,
      };
      
      // Check if already selected
      if (!selectedIssues.some(i => i.key === newIssue.key)) {
        onIssuesChange([...selectedIssues, newIssue]);
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {selectedIssues.map((issue) => (
          <Badge key={issue.id} className="hover:bg-accent hover:text-accent-foreground hover:border-primary transition-colors group">
            <div className="flex items-center">
              <Bug className="w-4 h-4 shrink-0 mr-1" />
              {issue.url ? (
                <a
                  href={issue.url}
                  className="overflow-hidden truncate max-w-xl flex items-center hover:text-inherit"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="truncate">{issue.key}: {issue.title}</span>
                </a>
              ) : (
                <span className="overflow-hidden truncate max-w-xl">
                  {issue.key}: {issue.title}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleRemoveIssue(issue.id)}
                disabled={disabled}
                className="ml-2 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </Badge>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsSearchOpen(true)}
        disabled={disabled}
      >
        <Plus className="h-4 w-4" />
        {t("issues.linkExternalIssue", { provider: "Jira" })}
      </Button>

      <SearchIssuesDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        projectId={projectId}
        linkedIssueIds={selectedIssues.map((issue) => issue.key)}
        onIssueSelected={(issue) => {
          handleAddIssue(issue);
          setIsSearchOpen(false);
        }}
      />
    </div>
  );
}