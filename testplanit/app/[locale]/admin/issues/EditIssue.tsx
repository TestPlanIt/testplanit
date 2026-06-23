"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { IntegrationProvider } from "~/zenstack/models";
import type { Issue } from "~/zenstack/models";
import { useState } from "react";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { HelpPopover } from "@/components/ui/help-popover";
import { useTranslations } from "next-intl";

// Helper function to construct external URL based on integration provider
const constructExternalUrl = (
  provider: IntegrationProvider,
  baseUrl: string | undefined,
  externalKey: string
): string | null => {
  if (!baseUrl) {
    return null;
  }

  // Remove trailing slash from baseUrl
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  switch (provider) {
    case IntegrationProvider.JIRA:
      // JIRA: baseUrl/browse/KEY
      return `${cleanBaseUrl}/browse/${externalKey}`;
    case IntegrationProvider.GITHUB:
      // GitHub: baseUrl/issues/NUMBER (externalKey should be just the number)
      return `${cleanBaseUrl}/issues/${externalKey}`;
    case IntegrationProvider.AZURE_DEVOPS:
      // Azure DevOps: baseUrl/_workitems/edit/ID
      return `${cleanBaseUrl}/_workitems/edit/${externalKey}`;
    case IntegrationProvider.GITLAB: {
      // GitLab key format: "namespace/project#iid"
      const match = externalKey.match(/^(.+)#(\d+)$/);
      if (match) return `${cleanBaseUrl}/${match[1]}/-/issues/${match[2]}`;
      return null;
    }
    case IntegrationProvider.GITEA: {
      // Gitea/Forgejo/Gogs key format: "owner/repo#number"
      const match = externalKey.match(/^(.+)#(\d+)$/);
      if (match) return `${cleanBaseUrl}/${match[1]}/issues/${match[2]}`;
      return null;
    }
    case IntegrationProvider.SIMPLE_URL:
      // For simple URL, use the baseUrl as a template if it contains {issueId}
      if (baseUrl.includes("{issueId}")) {
        return baseUrl.replace("{issueId}", externalKey);
      }
      return `${cleanBaseUrl}/${externalKey}`;
    default:
      return null;
  }
};

// Create a schema for the edit issue form
const EditIssueSchema = z.object({
  name: z.string().min(1, "Name is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  externalKey: z.string().optional(),
});

type EditIssueFormData = z.infer<typeof EditIssueSchema>;

interface EditIssueProps {
  issue: Issue;
  open: boolean;
  onClose: () => void;
}

export function EditIssue({ issue, open, onClose }: EditIssueProps) {
  const t = useTranslations("admin.issues.edit");
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateIssue } = useClientQueries(schema).issue.useUpdate();

  // Fetch integration details if issue has an integration
  const { data: integration } = useClientQueries(schema).integration.useFindUnique(
    {
      where: { id: issue.integrationId || 0 },
    },
    {
      enabled: !!issue.integrationId,
    }
  );

  const form = useForm<EditIssueFormData>({
    resolver: standardSchemaResolver(EditIssueSchema),
    defaultValues: {
      name: issue.name,
      title: issue.title,
      description: issue.description || "",
      externalKey: issue.externalKey || "",
    },
  });

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: EditIssueFormData) {
    setIsSubmitting(true);
    try {
      // Calculate externalUrl if externalKey and integration are provided
      let externalUrl: string | null = null;
      if (data.externalKey && integration) {
        const settings = integration.settings as { baseUrl?: string } | null;
        const baseUrl = settings?.baseUrl;
        externalUrl = constructExternalUrl(
          integration.provider,
          baseUrl,
          data.externalKey
        );
      }

      await updateIssue({
        where: { id: issue.id },
        data: {
          name: data.name,
          title: data.title,
          description: data.description || null,
          externalKey: data.externalKey || null,
          externalUrl: externalUrl,
        },
      });
      onClose();
      setIsSubmitting(false);
    } catch {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("name")}
                    <HelpPopover helpKey="issue.name" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="externalKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.externalKey")}
                    <HelpPopover helpKey="issue.externalKey" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., JIRA-123, #456" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.title")}
                    <HelpPopover helpKey="issue.title" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.description")}
                    <HelpPopover helpKey="issue.description" />
                  </FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("actions.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
