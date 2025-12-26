"use client";
import { useState, useEffect, useMemo } from "react";
import { useUpdateIssue, useFindUniqueIntegration } from "~/lib/hooks";
import { Issue, IntegrationProvider } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { SquarePen } from "lucide-react";

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
  DialogTrigger,
} from "@/components/ui/dialog";

import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

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

interface EditIssueModalProps {
  issue: Issue;
}

export function EditIssueModal({ issue }: EditIssueModalProps) {
  const t = useTranslations("admin.issues.edit");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateIssue } = useUpdateIssue();

  // Fetch integration details if issue has an integration
  const { data: integration } = useFindUniqueIntegration(
    {
      where: { id: issue.integrationId || 0 },
    },
    {
      enabled: open && !!issue.integrationId,
    }
  );

  const handleCancel = () => setOpen(false);

  const defaultFormValues = useMemo(
    () => ({
      name: issue.name,
      title: issue.title,
      description: issue.description || "",
      externalKey: issue.externalKey || "",
    }),
    [issue]
  );

  const form = useForm<EditIssueFormData>({
    resolver: zodResolver(EditIssueSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form]);

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
      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SquarePen className="h-5 w-5" />
        </Button>
      </DialogTrigger>
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
                    {tCommon("fields.name")}
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
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("status.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
