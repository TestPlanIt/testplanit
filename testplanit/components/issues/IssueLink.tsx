"use client";

import React from "react";
import { ExternalLink, Bug } from "lucide-react";
import * as icons from "simple-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, type ClassValue } from "~/utils";
import { useTranslations } from "next-intl";

interface IssueLinkProps {
  issue: {
    id: number;
    name: string;
    externalId?: string | null;
    data?: any;
    issueConfig?: {
      id: number;
      name: string;
      systemType: string;
      baseUrl?: string | null;
      integration?: {
        id: number;
        name: string;
        provider: string;
      } | null;
    } | null;
  };
  showExternalLink?: boolean;
  className?: ClassValue;
}

export function IssueLink({
  issue,
  showExternalLink = true,
  className,
}: IssueLinkProps) {
  const t = useTranslations("common.ui.issues");
  
  const getProviderIcon = () => {
    const provider = issue.issueConfig?.integration?.provider;
    switch (provider) {
      case "GITHUB":
        return (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
            <path d={icons.siGithub.path} />
          </svg>
        );
      case "JIRA":
        return (
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 text-blue-600"
            fill="blue-600"
          >
            <path d={icons.siJira.path} />
          </svg>
        );
      case "AZURE_DEVOPS":
        return (
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 text-blue-700"
            fill="currentColor"
          >
            <path
              d={
                (icons as any).siAzuredevops?.path ||
                (icons as any).siMicrosoftazure?.path ||
                ""
              }
            />
          </svg>
        );
      default:
        return <Bug className="w-4 h-4" />;
    }
  };

  const getExternalUrl = () => {
    if (!issue.externalId || !issue.issueConfig) return null;

    // For LINK type configurations, use the baseUrl with placeholder replacement
    if (issue.issueConfig.systemType === "LINK" && issue.issueConfig.baseUrl) {
      return issue.issueConfig.baseUrl.replace("{issueId}", issue.externalId);
    }

    // For integrated systems, construct the URL based on provider
    const integration = issue.issueConfig.integration;
    if (!integration) return null;

    switch (integration.provider) {
      case "JIRA":
        // If we have the full issue data with self link, use that
        if (issue.data?.self) {
          const match = issue.data.self.match(/^(https?:\/\/[^\/]+)/);
          if (match) {
            return `${match[1]}/browse/${issue.externalId}`;
          }
        }
        return null;

      case "GITHUB":
        // GitHub issues typically store the full URL in the data
        return issue.data?.html_url || null;

      case "AZURE_DEVOPS":
        // Azure DevOps typically stores the URL in _links.html.href
        return issue.data?._links?.html?.href || null;

      default:
        return null;
    }
  };

  const externalUrl = getExternalUrl();
  const hasExternalLink = showExternalLink && !!externalUrl;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {getProviderIcon()}
              <span className="font-medium">{issue.name}</span>
              {issue.externalId && (
                <span className="text-sm text-muted-foreground">
                  {"("}
                  {issue.externalId}
                  {")"}
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <p className="font-semibold">{issue.name}</p>
              {issue.externalId && (
                <p className="text-sm">
                  {t("externalId")}
                  {issue.externalId}
                </p>
              )}
              {issue.issueConfig && (
                <p className="text-sm text-muted-foreground">
                  {issue.issueConfig.integration?.name ||
                    issue.issueConfig.name}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {hasExternalLink && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {t("viewIn")}{" "}
                {issue.issueConfig?.integration?.provider || "external system"}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
