"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent, DialogFooter, DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField,
  FormItem,
  FormLabel, FormMessage
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";
import {
  useUpdateCodeRepository, useUpsertCodeRepository
} from "~/lib/hooks";
import { CodeRepositoryConfigForm } from "./CodeRepositoryConfigForm";

const PROVIDERS = [
  { value: "GITHUB", label: "GitHub" },
  { value: "GITLAB", label: "GitLab" },
  { value: "BITBUCKET", label: "Bitbucket Cloud" },
  { value: "AZURE_DEVOPS", label: "Azure DevOps" },
] as const;

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  provider: z.enum(["GITHUB", "GITLAB", "BITBUCKET", "AZURE_DEVOPS"]),
  credentials: z.record(z.string(), z.string()).optional(),
  settings: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface CodeRepositoryModalProps {
  repository?: {
    id: number;
    name: string;
    provider: string;
    credentials: Record<string, string> | null;
    settings: Record<string, string> | null;
    status: string;
  };
  onClose: () => void;
  onSaved: () => void;
}

export function CodeRepositoryModal({
  repository,
  onClose,
  onSaved,
}: CodeRepositoryModalProps) {
  const tCommon = useTranslations("common");
  const t = useTranslations("admin.codeRepositories");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  const { mutateAsync: upsertRepository } = useUpsertCodeRepository();
  const { mutateAsync: updateRepository } = useUpdateCodeRepository();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: repository?.name ?? "",
      provider: (repository?.provider as FormData["provider"]) ?? "GITHUB",
      credentials: (repository?.credentials as Record<string, string>) ?? {},
      settings: (repository?.settings as Record<string, string>) ?? {},
      isActive: repository ? repository.status !== "INACTIVE" : true,
    },
  });

  const selectedProvider = form.watch("provider");
  const prevProvider = useRef(selectedProvider);

  // Reset credentials and settings when provider changes to clear leftover field values
  useEffect(() => {
    if (prevProvider.current !== selectedProvider) {
      prevProvider.current = selectedProvider;
      form.setValue("credentials", {});
      form.setValue("settings", {});
      setTestResult(null);
    }
  }, [selectedProvider, form]);

  const handleTestConnection = async () => {
    const values = form.getValues();
    setIsTesting(true);
    setTestResult(null);

    try {
      const body: Record<string, unknown> = {
        provider: values.provider,
        credentials: values.credentials,
        settings: values.settings,
      };
      if (repository?.id) body.repositoryId = repository.id;

      const response = await fetch("/api/code-repositories/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, error: t("networkError") });
    } finally {
      setIsTesting(false);
    }
  };

  const onSubmit = async (values: FormData) => {
    try {
      if (repository) {
        // Map isActive → status, preserving ERROR state if admin sets active
        const newStatus = values.isActive ? "ACTIVE" : "INACTIVE";
        await updateRepository({
          where: { id: repository.id },
          data: {
            name: values.name,
            settings: values.settings ?? {},
            credentials: values.credentials ?? {},
            status: newStatus as any,
          },
        });
      } else {
        await upsertRepository({
          where: { name: values.name },
          create: {
            name: values.name,
            provider: values.provider,
            credentials: values.credentials ?? {},
            settings: values.settings ?? {},
            isDeleted: false,
          },
          update: {
            provider: values.provider,
            credentials: values.credentials ?? {},
            settings: values.settings ?? {},
            isDeleted: false,
          },
        });
      }
      toast.success(repository ? t("repositoryUpdated") : t("repositoryCreated"));
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.info?.message ?? t("saveFailed"));
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {repository ? t("editTitle") : t("addTitle")}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-4">
            <FormField
              control={form.control as any}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("name")}
                    <HelpPopover helpKey="codeRepository.name" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("namePlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!repository && (
              <FormField
                control={form.control as any}
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.provider")}
                      <HelpPopover helpKey="codeRepository.provider" />
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("selectProvider")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROVIDERS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <CodeRepositoryConfigForm
              provider={selectedProvider}
              form={form}
            />

            {repository && (
              <FormField
                control={form.control as any}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel>{tCommon("fields.isActive")}</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={isTesting}
              >
                {isTesting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("testConnection")}
              </Button>
              {testResult && (
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="text-sm text-success">
                        {t("connectionSuccess")}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm text-destructive">
                        {testResult.error ?? t("connectionFailed")}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {repository ? tCommon("actions.saveChanges") : t("addRepository")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
