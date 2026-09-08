"use client";

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
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";
import { IntegrationConfigForm } from "./IntegrationConfigForm";
import { IntegrationErrorAlert } from "./IntegrationErrorAlert";
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
  const [testError, setTestError] = useState<string | null>(null);

  // Saves go through the admin API routes rather than a direct ZenStack
  // mutation. The model write persists `credentials` as whatever JSON the
  // client sent, so the client secrets typed into this form landed in the
  // database in cleartext; the routes encrypt them at rest, merge partial
  // credential edits over what is stored, and evict the cached adapter so an
  // edited clientId takes effect without a restart.
  //
  // POST upserts by the unique `name` so re-adding an integration whose name
  // belongs to a soft-deleted row resurrects it instead of failing the unique
  // constraint; a collision against an ACTIVE row is rejected there.
  const [isSaving, setIsSaving] = useState(false);

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

  // useWatch creates proper field subscriptions that re-render when
  // form.reset() fires — form.watch() in the render body does not reliably
  // do so, causing stale authType/credentials/settings after edit open.
  const watchedAuthType = useWatch({ control: form.control, name: "authType" });
  const watchedCredentials = useWatch({
    control: form.control,
    name: "credentials",
  });
  const watchedSettings = useWatch({ control: form.control, name: "settings" });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (integration) {
      const settings =
        typeof integration.settings === "object" &&
        integration.settings !== null &&
        !Array.isArray(integration.settings)
          ? (integration.settings as Record<string, string>)
          : {};
      form.reset({
        name: integration.name,
        provider: integration.provider,
        authType: integration.authType,
        credentials: {},
        settings,
      });
      // Explicit setValue calls are a belt-and-suspenders guard: form.reset()
      // doesn't always flush synchronously through watch() subscriptions in
      // React 18 batching, so provider/authType (both hidden in edit mode)
      // can end up undefined in the schema validator, causing a silent save
      // failure with no error toast.
      form.setValue("provider", integration.provider);
      form.setValue("authType", integration.authType);
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
    setTestError(null);
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
        setTestError(null);
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
        // Kept on screen after the toast expires: these messages name the
        // exact remedy (and sometimes a URL to visit), which is more than a
        // transient toast can carry.
        setTestError(description);
        setTestPassed(false);
      }
    } catch {
      toast.error(t("testError"), {
        description: t("testErrorDescription"),
      });
      setTestError(t("testErrorDescription"));
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
    // Secrets are never sent back to the browser, so the credential inputs
    // start blank on edit. An untouched (empty) field means "keep what is
    // stored" — the server merges what we send over the stored object — so
    // send only what was actually typed.
    const filteredCredentials = Object.fromEntries(
      Object.entries(values.credentials || {}).filter(([, v]) => v !== "")
    );
    const hasNewCredentials = Object.keys(filteredCredentials).length > 0;

    // Only a non-OAuth integration can be activated by a passing test.
    // OAuth 2.0 (3LO) stays in its default (awaiting-authorization) state
    // until a user completes the authorization flow and the callback
    // stores a token — see the OAuth callback route.
    const activateOnCreate =
      testPassed &&
      !integration &&
      values.authType !== IntegrationAuthType.OAUTH2;

    setIsSaving(true);
    try {
      const response = integration
        ? await fetch(`/api/integrations/${integration.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: values.name,
              authType: values.authType,
              settings: values.settings || {},
              // Omitted entirely when nothing was retyped, so the stored
              // credentials are left untouched.
              ...(hasNewCredentials
                ? { credentials: filteredCredentials }
                : {}),
            }),
          })
        : await fetch("/api/integrations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: values.name,
              type: values.provider,
              authType: values.authType,
              config: filteredCredentials,
              settings: values.settings || {},
              ...(activateOnCreate ? { status: "ACTIVE" } : {}),
            }),
          });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || response.statusText);
      }

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
    } catch (error) {
      toast.error(t("errors.createFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = isSaving;

  const handleClose = () => {
    setTestPassed(false);
    setTestError(null);
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
                  authType={watchedAuthType}
                  credentials={watchedCredentials || {}}
                  settings={watchedSettings || {}}
                  onCredentialsChange={(credentials: Record<string, string>) =>
                    form.setValue("credentials", credentials)
                  }
                  onSettingsChange={(settings: Record<string, string>) =>
                    form.setValue("settings", settings)
                  }
                  isEdit={!!integration}
                />

                {testError && (
                  <IntegrationErrorAlert
                    title={t("testFailed")}
                    message={testError}
                  />
                )}

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
