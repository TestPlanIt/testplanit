"use client";

import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Asterisk, ExternalLink, Link2, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";
import { useFindManyIssue, useUpsertIssue } from "~/lib/hooks";
import { buildSimpleUrlLink } from "~/lib/integrations/simpleUrl";

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
  projectIntegrationId: _projectIntegrationId,
  integrationId,
  linkedIssueIds,
  setLinkedIssueIds,
  config,
}: ManageSimpleUrlIssuesProps) {
  const t = useTranslations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [selectedExisting, setSelectedExisting] = useState<{
    id: number;
    name: string;
    title: string | null;
  } | null>(null);

  const addIssueSchema = z.object({
    issueId: z.string().trim().min(1, t("common.errors.fieldRequired")),
    issueTitle: z.string().trim().min(1, t("common.errors.fieldRequired")),
  });
  type AddIssueFormValues = z.infer<typeof addIssueSchema>;

  const form = useForm<AddIssueFormValues>({
    resolver: standardSchemaResolver(addIssueSchema),
    defaultValues: { issueId: "", issueTitle: "" },
    mode: "onBlur",
  });

  // Reset the form whenever the dialog closes
  useEffect(() => {
    if (!isAddOpen) {
      form.reset({ issueId: "", issueTitle: "" });
    }
  }, [isAddOpen, form]);

  // Fetch linked issues
  const { data: issues, refetch } = useFindManyIssue({
    where: {
      id: { in: linkedIssueIds },
      isDeleted: false,
    },
  });

  const { mutateAsync: upsertIssue } = useUpsertIssue();

  const watchedIssueId =
    useWatch({ control: form.control, name: "issueId" }) || "";

  const onSubmit = async (values: AddIssueFormValues) => {
    const issueId = values.issueId.trim();
    const issueTitle = values.issueTitle.trim();

    try {
      const newIssue = await upsertIssue({
        where: {
          externalId_integrationId: {
            externalId: issueId,
            integrationId: integrationId,
          },
        },
        create: {
          name: issueId,
          title: issueTitle,
          externalId: issueId,
          integration: { connect: { id: integrationId } },
          project: { connect: { id: projectId } },
          // SIMPLE_URL has no API to populate these — leave null instead of the
          // schema default "medium"
          status: null,
          priority: null,
          // createdBy is auto-injected by the /api/model handler
        } as any,
        update: {
          title: issueTitle,
        },
      });

      if (newIssue) {
        setLinkedIssueIds([...linkedIssueIds, newIssue.id]);
      }

      setIsAddOpen(false);
      toast.success(t("common.messages.created"));
      void refetch();
    } catch {
      toast.error(t("common.messages.createError"));
    }
  };

  const handleRemoveIssue = (removeId: number) => {
    setLinkedIssueIds(linkedIssueIds.filter((id) => id !== removeId));
    toast.success(t("common.status.deleted"));
  };

  const handleLinkExisting = () => {
    if (!selectedExisting) return;
    if (linkedIssueIds.includes(selectedExisting.id)) {
      toast.error(t("issues.alreadyLinked"));
      return;
    }
    setLinkedIssueIds([...linkedIssueIds, selectedExisting.id]);
    setSelectedExisting(null);
    setIsLinkOpen(false);
    void refetch();
  };

  const getIssueUrl = (issue: any) =>
    buildSimpleUrlLink(config?.baseUrl, issue.externalId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {issues?.map((issue) => {
          const url = getIssueUrl(issue);
          return (
            <div
              key={issue.id}
              className="inline-flex items-center rounded-md bg-primary text-primary-foreground pl-0.5 pr-0.5 py-0 gap-0.5"
            >
              <IssuesDisplay
                id={issue.id}
                name={issue.name}
                externalId={issue.externalId}
                externalUrl={url}
                title={issue.title}
                status={issue.externalStatus}
                size="small"
                projectIds={[projectId]}
                data={issue.data}
                integrationProvider="SIMPLE_URL"
                integrationId={issue.integrationId ?? undefined}
                issueTypeName={issue.issueTypeName}
                issueTypeIconUrl={issue.issueTypeIconUrl}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 hover:bg-destructive/20 hover:text-destructive"
                aria-label={t("common.actions.remove")}
                onClick={() => handleRemoveIssue(issue.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsLinkOpen(true)}
        >
          <Link2 className="h-4 w-4" />
          {t("issues.linkIssue")}
        </Button>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("issues.addIssue")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("issues.addIssue")}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit(onSubmit)(e);
              }}
              className="space-y-4"
              autoComplete="off"
            >
              <FormField
                control={form.control}
                name="issueId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="inline-flex items-center gap-0.5">
                      {t("common.fields.id")}
                      <sup>
                        <Asterisk className="w-3 h-3 text-destructive" />
                      </sup>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("common.placeholders.issueIdExample")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="issueTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="inline-flex items-center gap-0.5">
                      {t("common.name")}
                      <sup>
                        <Asterisk className="w-3 h-3 text-destructive" />
                      </sup>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("common.name")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {config?.baseUrl &&
                (() => {
                  const previewUrl = config.baseUrl.replace(
                    "{issueId}",
                    watchedIssueId || "ISSUE-123"
                  );
                  return (
                    <p className="text-sm text-muted-foreground break-all">
                      {t("common.ui.issues.url")}
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {previewUrl}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </p>
                  );
                })()}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddOpen(false)}
                  disabled={form.formState.isSubmitting}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {t("common.add")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Link-existing dialog */}
      <Dialog
        open={isLinkOpen}
        onOpenChange={(open) => {
          setIsLinkOpen(open);
          if (!open) setSelectedExisting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <DialogTitle>{t("issues.searchIssues")}</DialogTitle>
                <DialogDescription>
                  {t("issues.searchIssuesDescription")}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsLinkOpen(false);
                  setSelectedExisting(null);
                  setIsAddOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                {t("issues.createNewIssue")}
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-2">
            <Label>{t("common.fields.issues")}</Label>
            <AsyncCombobox<{ id: number; name: string; title: string | null }>
              value={selectedExisting}
              onValueChange={setSelectedExisting}
              fetchOptions={async (query, page, pageSize) => {
                // Search existing SIMPLE_URL issues for this integration,
                // excluding ones already linked. Use the ZenStack REST API.
                const whereClause: any = {
                  integrationId,
                  isDeleted: false,
                };
                if (linkedIssueIds.length > 0) {
                  whereClause.id = { notIn: linkedIssueIds };
                }
                if (query) {
                  whereClause.OR = [
                    { name: { contains: query, mode: "insensitive" } },
                    { title: { contains: query, mode: "insensitive" } },
                    { externalId: { contains: query, mode: "insensitive" } },
                  ];
                }

                try {
                  const q = encodeURIComponent(
                    JSON.stringify({
                      where: whereClause,
                      orderBy: { name: "asc" },
                      take: pageSize,
                      skip: page * pageSize,
                      select: { id: true, name: true, title: true },
                    })
                  );
                  const countQ = encodeURIComponent(
                    JSON.stringify({ where: whereClause })
                  );
                  const [listRes, countRes] = await Promise.all([
                    fetch(`/api/model/issue/findMany?q=${q}`),
                    fetch(`/api/model/issue/count?q=${countQ}`),
                  ]);
                  const listJson = await listRes.json();
                  const countJson = await countRes.json();
                  return {
                    results: listJson.data ?? listJson ?? [],
                    total: countJson.data ?? countJson ?? 0,
                  };
                } catch {
                  return { results: [], total: 0 };
                }
              }}
              renderOption={(issue) => (
                <span className="truncate">
                  {issue.name}
                  {issue.title && issue.title !== issue.name
                    ? ` — ${issue.title}`
                    : ""}
                </span>
              )}
              getOptionValue={(issue) => issue.id}
              placeholder={t("issues.searchPlaceholder")}
              showTotal
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsLinkOpen(false);
                setSelectedExisting(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleLinkExisting}
              disabled={!selectedExisting}
            >
              {t("common.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
