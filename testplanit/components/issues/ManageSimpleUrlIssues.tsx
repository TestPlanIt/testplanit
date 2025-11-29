"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Plus, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useFindManyIssue, useUpsertIssue, useDeleteIssue } from "~/lib/hooks";
import { toast } from "sonner";

interface ManageSimpleUrlIssuesProps {
  projectId: number;
  projectIntegrationId: number;
  integrationId: number;
  linkedIssueIds: number[];
  setLinkedIssueIds: (ids: number[]) => void;
  entityType?: string;
  config?: {
    baseUrl?: string;
  };
}

export function ManageSimpleUrlIssues({
  projectId,
  projectIntegrationId,
  integrationId,
  linkedIssueIds,
  setLinkedIssueIds,
  config,
}: ManageSimpleUrlIssuesProps) {
  const t = useTranslations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [issueId, setIssueId] = useState("");
  const [issueTitle, setIssueTitle] = useState("");

  // Fetch existing issues
  const { data: issues, refetch } = useFindManyIssue({
    where: {
      id: { in: linkedIssueIds },
      isDeleted: false,
    },
  });

  const { mutateAsync: upsertIssue } = useUpsertIssue();
  const { mutateAsync: deleteIssue } = useDeleteIssue();

  const handleAddIssue = async () => {
    if (!issueId.trim()) {
      toast.error(t("common.errors.fieldRequired"));
      return;
    }

    try {
      // Use upsert to handle cases where the issue already exists
      const newIssue = await upsertIssue({
        where: {
          externalId_integrationId: {
            externalId: issueId,
            integrationId: integrationId,
          },
        },
        create: {
          name: issueId,
          title: issueTitle || issueId,
          externalId: issueId,
          externalUrl: config?.baseUrl ? config.baseUrl.replace("{issueId}", issueId) : undefined,
          integrationId,
          projectId,
          createdById: "", // Will be set by the server
        },
        update: {
          // Update fields that might have changed
          title: issueTitle || issueId,
          externalUrl: config?.baseUrl ? config.baseUrl.replace("{issueId}", issueId) : undefined,
        },
      });

      // Add to linked issues
      if (newIssue) {
        setLinkedIssueIds([...linkedIssueIds, newIssue.id]);
      }
      
      // Reset form
      setIssueId("");
      setIssueTitle("");
      setIsAddOpen(false);
      
      toast.success(t("common.messages.created"));
      refetch();
    } catch (error) {
      toast.error(t("common.messages.createError"));
    }
  };

  const handleRemoveIssue = async (issueId: number) => {
    try {
      setLinkedIssueIds(linkedIssueIds.filter(id => id !== issueId));
      toast.success(t("common.status.deleted"));
    } catch (error) {
      toast.error(t("common.errors.error"));
    }
  };

  const getIssueUrl = (issue: any) => {
    if (issue.externalUrl) return issue.externalUrl;
    if (config?.baseUrl && issue.externalId) {
      return config.baseUrl.replace("{issueId}", issue.externalId);
    }
    return null;
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {issues?.map((issue) => {
          const url = getIssueUrl(issue);
          return (
            <Badge key={issue.id} variant="secondary" className="pr-1">
              <span className="mr-1">{issue.name}</span>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 ml-1"
                onClick={() => handleRemoveIssue(issue.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          );
        })}
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAddOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("common.actions.add")}
        </Button>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common.actions.add")} {t("common.fields.issues")}</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="issueId">{t("common.fields.id")}</Label>
              <Input
                id="issueId"
                value={issueId}
                onChange={(e) => setIssueId(e.target.value)}
                placeholder="ISSUE-123"
              />
            </div>
            
            <div>
              <Label htmlFor="issueTitle">{t("common.fields.name")}</Label>
              <Input
                id="issueTitle"
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder={t("common.fields.name")}
              />
            </div>

            {config?.baseUrl && (
              <p className="text-sm text-muted-foreground">
                {t("common.ui.issues.url")}{config.baseUrl.replace("{issueId}", issueId || "ISSUE-123")}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button onClick={handleAddIssue}>
              {t("common.actions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}