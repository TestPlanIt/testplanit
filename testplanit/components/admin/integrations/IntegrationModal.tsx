"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { IntegrationAuthType, IntegrationProvider } from "~/zenstack/models";
import type { Integration } from "~/zenstack/models";
import { Activity, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";
import { IntegrationConfigForm } from "./IntegrationConfigForm";
import { IntegrationTypeSelector } from "./IntegrationTypeSelector";

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  integration?: Integration | null;
  onSuccess?: () => void;
}

const formSchema = z.object({
  name: z.string().min(1, "Integration name is required"),
  provider: z.nativeEnum(IntegrationProvider),
  authType: z.nativeEnum(IntegrationAuthType),
  credentials: z.record(z.string(), z.string()).optional(),
  settings: z.record(z.string(), z.string()).optional(),
});

type FormData = z.infer<typeof formSchema>;

// Map providers to their available auth types
const providerAuthTypes: Record<IntegrationProvider, IntegrationAuthType[]> = {
  [IntegrationProvider.JIRA]: [
    IntegrationAuthType.API_KEY,
    IntegrationAuthType.OAUTH2,
  ],
  [IntegrationProvider.GITHUB]: [
    IntegrationAuthType.PERSONAL_ACCESS_TOKEN,
    IntegrationAuthType.OAUTH2,
  ],
  [IntegrationProvider.AZURE_DEVOPS]: [
    IntegrationAuthType.PERSONAL_ACCESS_TOKEN,
  ],
  [IntegrationProvider.SIMPLE_URL]: [IntegrationAuthType.NONE],
  [IntegrationProvider.GITLAB]: [
    IntegrationAuthType.PERSONAL_ACCESS_TOKEN,
    IntegrationAuthType.OAUTH2,
  ],
  [IntegrationProvider.GITEA]: [
    IntegrationAuthType.PERSONAL_ACCESS_TOKEN,
    IntegrationAuthType.OAUTH2,
  ],
  [IntegrationProvider.REDMINE]: [IntegrationAuthType.API_KEY],
  [IntegrationProvider.MANTISBT]: [IntegrationAuthType.API_KEY],
};

export function IntegrationModal({
  isOpen,
  onClose,
  integration,
  onSuccess,
}: IntegrationModalProps) {
  const t = useTranslations("admin.integrations");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [selectedType, setSelectedType] = useState<IntegrationProvider | null>(
    integration?.provider || null
  );
  const [isTesting, setIsTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);

  // Upsert (not create) so re-adding an integration with the same name
  // as a soft-deleted one resurrects the row with the new payload
  // instead of failing on the unique-name constraint. The new-name
  // collision against an ACTIVE row is still rejected by the API route's
  // explicit duplicate-name check before the mutation runs.
  const createIntegrationMutation =
    useClientQueries(schema).integration.useUpsert();
  const updateIntegrationMutation =
    useClientQueries(schema).integration.useUpdate();

  const isCreating = createIntegrationMutation.status === "pending";
  const isUpdating = updateIntegrationMutation.status === "pending";

  const form = useForm<FormData>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      name: integration?.name || "",
      provider: integration?.provider || undefined,
      authType: integration?.authType || undefined,
      credentials: {},
      settings:
        typeof integration?.settings === "object" &&
        integration.settings !== null &&
        !Array.isArray(integration.settings)
          ? (integration.settings as Record<string, string>)
          : {},
    },
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (integration) {
      form.reset({
        name: integration.name,
        provider: integration.provider,
        authType: integration.authType,
        credentials: {},
        settings:
          typeof integration.settings === "object" &&
          integration.settings !== null &&
          !Array.isArray(integration.settings)
            ? (integration.settings as Record<string, string>)
            : {},
      });
      setSelectedType(integration.provider);
    } else {
      // Opening for a NEW integration: clear any state left over from a
      // prior edit session in this (persistent) modal. Without this, stale
      // credentials/settings/authType leak into the create flow and produce
      // a misleading "missing required configuration" error on Test
      // Connection even though the visible fields look filled in.
      form.reset({
        name: "",
        provider: undefined,
        authType: undefined,
        credentials: {},
        settings: {},
      });
      setSelectedType(null);
    }
    setTestPassed(false);
  }, [isOpen, integration, form]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    const values = form.getValues();

    try {
      const response = await fetch("/api/integrations/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationId: integration?.id,
          provider: values.provider,
          authType: values.authType,
          credentials: values.credentials,
          settings: values.settings,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // OAuth 2.0 (3LO): a passing test only confirms the client
        // credentials are well-formed — the integration isn't connected
        // until a user completes the authorization flow. Tell the admin
        // that's the expected next step rather than implying it's live.
        if (data.requiresUserAuth) {
          toast.success(t("testCredentialsSaved"), {
            description: t("testCredentialsSavedDescription"),
          });
        } else {
          toast.success(t("testSuccess"), {
            description: t("testSuccessDescription"),
          });
        }
        setTestPassed(true);
      } else {
        // The route returns a `capabilities` object describing each
        // probe it ran (connection / searchIssues / readIssue). When
        // present, surface the SPECIFIC failed probe so the admin
        // knows whether to fix the credential, the auth scope, or
        // the org-level token policy. Falls back to the top-level
        // `error` for missing-config / unsupported-provider responses.
        const caps = data.capabilities ?? {};
        const failed: string[] = [];
        if (caps.connection?.ok === false) {
          failed.push(`Connection: ${caps.connection.error}`);
        }
        if (caps.searchIssues?.ok === false) {
          failed.push(`Search issues: ${caps.searchIssues.error}`);
        }
        if (caps.readIssue?.ok === false) {
          failed.push(`Read issue: ${caps.readIssue.error}`);
        }
        const description =
          failed.length > 0
            ? failed.join("\n")
            : data.error || t("testFailedDescription");
        toast.error(t("testFailed"), { description });
        setTestPassed(false);
      }
    } catch {
      toast.error(t("testError"), {
        description: t("testErrorDescription"),
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Kick off the per-user OAuth (3LO) authorization for a saved integration.
  // Uses the generic OAuth route (only needs an integrationId — no project),
  // and the callback flips the integration to ACTIVE once a token is stored.
  const handleAuthorize = () => {
    if (!integration) return;
    const params = new URLSearchParams({
      integrationId: integration.id.toString(),
    });
    window.location.href = `/api/integrations/oauth/${integration.provider.toLowerCase()}/auth?${params.toString()}`;
  };

  const onSubmit = async (values: FormData) => {
    const mutate = integration
      ? updateIntegrationMutation.mutate
      : createIntegrationMutation.mutate;

    // Filter out empty credential values so we don't overwrite encrypted fields
    const filteredCredentials = Object.fromEntries(
      Object.entries(values.credentials || {}).filter(([, v]) => v !== "")
    );
    // Only include credentials in the update if the user actually entered new values
    const hasNewCredentials = Object.keys(filteredCredentials).length > 0;

    const submitData = {
      ...values,
      credentials: hasNewCredentials
        ? filteredCredentials
        : integration
          ? undefined
          : {},
      settings: values.settings || {},
      // Only a non-OAuth integration can be activated by a passing test.
      // OAuth 2.0 (3LO) stays in its default (awaiting-authorization) state
      // until a user completes the authorization flow and the callback
      // stores a token — see the OAuth callback route.
      ...(testPassed &&
        !integration &&
        values.authType !== IntegrationAuthType.OAUTH2 && {
          status: "ACTIVE",
        }),
    };

    // Edit path stays an update-by-id. Add path is an upsert keyed by
    // the unique `name` so a soft-deleted row gets resurrected with the
    // new payload + isDeleted: false; otherwise a fresh row is created.
    const data = integration
      ? { where: { id: integration.id }, data: submitData }
      : {
          where: { name: submitData.name },
          create: submitData,
          update: { ...submitData, isDeleted: false },
        };

    mutate(data as any, {
      onSuccess: () => {
        toast.success(
          integration ? t("edit.successMessage") : t("add.successMessage"),
          {
            description: integration
              ? t("edit.successDescription")
              : t("add.successDescription"),
          }
        );
        onSuccess?.();
        handleClose();
      },
      onError: (error) => {
        toast.error(t("errors.createFailed"), {
          description: error.message,
        });
      },
    });
  };

  const isLoading = isCreating || isUpdating;

  const handleClose = () => {
    setTestPassed(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl min-h-[34rem] content-start">
        <DialogHeader>
          <DialogTitle>
            {integration
              ? tGlobal("admin.integrations.editIntegration")
              : tGlobal("admin.integrations.addIntegration")}
          </DialogTitle>
          <DialogDescription>
            {integration ? t("edit.description") : t("add.description")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit as any)}
            className="space-y-6"
          >
            {!integration && (
              <IntegrationTypeSelector
                selectedType={selectedType}
                onSelectType={(type: IntegrationProvider) => {
                  setSelectedType(type);
                  form.setValue("provider", type);
                  form.setValue("authType", providerAuthTypes[type][0]);
                }}
              />
            )}

            {selectedType && (
              <>
                <FormField
                  control={form.control as any}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("config.name")}
                        <HelpPopover helpKey="integration.name" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("config.namePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {providerAuthTypes[selectedType].length > 1 && (
                  <FormField
                    control={form.control as any}
                    name="authType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          {t("config.authType")}
                          <HelpPopover helpKey="integration.authType" />
                        </FormLabel>
                        <FormControl>
                          <select
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            {...field}
                          >
                            {providerAuthTypes[selectedType].map((authType) => (
                              <option key={authType} value={authType}>
                                {t(`authType.${authType.toLowerCase()}` as any)}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <IntegrationConfigForm
                  provider={selectedType}
                  authType={form.watch("authType")}
                  credentials={form.watch("credentials") || {}}
                  settings={form.watch("settings") || {}}
                  onCredentialsChange={(credentials: Record<string, string>) =>
                    form.setValue("credentials", credentials)
                  }
                  onSettingsChange={(settings: Record<string, string>) =>
                    form.setValue("settings", settings)
                  }
                  isEdit={!!integration}
                />

                <div className="flex justify-between">
                  <div className="flex gap-2">
                    {selectedType !== IntegrationProvider.SIMPLE_URL && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={isTesting || isLoading}
                      >
                        {isTesting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Activity className="h-4 w-4" />
                        )}
                        {t("testConnection")}
                      </Button>
                    )}
                    {/* Per-user OAuth (3LO) authorization for a saved
                        integration — the step that actually connects it and
                        flips it ACTIVE. Only meaningful once the integration
                        exists (edit mode). */}
                    {integration &&
                      integration.authType === IntegrationAuthType.OAUTH2 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleAuthorize}
                          disabled={isLoading}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {integration.status === "ACTIVE"
                            ? t("reauthorize")
                            : t("authorize")}
                        </Button>
                      )}
                  </div>

                  <div className="space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleClose}
                      disabled={isLoading}
                    >
                      {tCommon("cancel")}
                    </Button>
                    <Button type="submit" disabled={isLoading || !selectedType}>
                      {isLoading && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {integration
                        ? tCommon("actions.save")
                        : tCommon("actions.create")}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
