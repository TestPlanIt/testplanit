"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod/v4";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";
import {
  useCreateIntegration,
  useUpdateIntegration,
} from "@/lib/hooks/integration";
import {
  Integration,
  IntegrationProvider,
  IntegrationAuthType,
} from "@prisma/client";
import { IntegrationTypeSelector } from "./IntegrationTypeSelector";
import { IntegrationConfigForm } from "./IntegrationConfigForm";

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
  [IntegrationProvider.GITHUB]: [IntegrationAuthType.PERSONAL_ACCESS_TOKEN],
  [IntegrationProvider.AZURE_DEVOPS]: [
    IntegrationAuthType.PERSONAL_ACCESS_TOKEN,
  ],
  [IntegrationProvider.SIMPLE_URL]: [IntegrationAuthType.API_KEY],
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

  const createIntegrationMutation = useCreateIntegration();
  const updateIntegrationMutation = useUpdateIntegration();

  const isCreating = createIntegrationMutation.status === "pending";
  const isUpdating = updateIntegrationMutation.status === "pending";

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
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
    }
  }, [integration, form]);

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
        toast.success(t("testSuccess"), {
          description: t("testSuccessDescription"),
        });
        setTestPassed(true);
      } else {
        toast.error(t("testFailed"), {
          description: data.error || t("testFailedDescription"),
        });
        setTestPassed(false);
      }
    } catch (error) {
      toast.error(t("testError"), {
        description: t("testErrorDescription"),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const onSubmit = async (values: FormData) => {
    const mutate = integration
      ? updateIntegrationMutation.mutate
      : createIntegrationMutation.mutate;
    const submitData = {
      ...values,
      credentials: values.credentials || {},
      settings: values.settings || {},
      ...(testPassed && !integration && { status: "ACTIVE" }),
    };

    const data = integration
      ? { where: { id: integration.id }, data: submitData }
      : { data: submitData };

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {integration ? tGlobal("admin.integrations.editIntegration") : tGlobal("admin.integrations.addIntegration")}
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

                  <div className="space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleClose}
                      disabled={isLoading}
                    >
                      {tCommon("actions.cancel")}
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
