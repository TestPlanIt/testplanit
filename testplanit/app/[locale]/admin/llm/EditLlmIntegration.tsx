"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Edit, Info, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  useUpdateLlmIntegration,
  useFindManyLlmIntegration,
} from "~/lib/hooks/llm-integration";
import {
  useUpdateLlmProviderConfig,
  useFindManyLlmProviderConfig,
} from "~/lib/hooks/llm-provider-config";
import { useDeleteManyLlmUsage } from "~/lib/hooks/llm-usage";

const createFormSchema = (t: any, existingNames: string[], currentName: string) =>
  z.object({
    name: z
      .string()
      .min(1, t("validation.nameRequired"))
      .refine(
        (name) =>
          !existingNames.some(
            (existing) =>
              existing.toLowerCase() === name.toLowerCase() &&
              existing.toLowerCase() !== currentName.toLowerCase()
          ),
        { message: t("validation.nameUnique") }
      ),
    apiKey: z.string().optional(),
    endpoint: z.string().optional(),
    deploymentName: z.string().optional(),
    defaultModel: z.string().min(1, t("validation.defaultModelRequired")),
    maxTokensPerRequest: z.number().min(1).max(128000),
    maxRequestsPerMinute: z.number().min(1).max(10000),
    costPerInputToken: z.number().min(0),
    costPerOutputToken: z.number().min(0),
    monthlyBudget: z.number().min(0).optional(),
    defaultTemperature: z.number().min(0).max(2),
    defaultMaxTokens: z.number().min(1).max(128000),
    timeout: z.number().min(5000).max(600000), // 5 seconds to 10 minutes
    streamingEnabled: z.boolean(),
    isDefault: z.boolean(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
  });

type FormData = z.infer<ReturnType<typeof createFormSchema>>;

// Providers that support dynamic model fetching
const PROVIDERS_WITH_DYNAMIC_MODELS = [
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "OLLAMA",
];

interface EditLlmIntegrationProps {
  integration: any;
  currentSpend?: number;
}

export function EditLlmIntegration({
  integration,
  currentSpend = 0,
}: EditLlmIntegrationProps) {
  const t = useTranslations("admin.llm.edit");
  const tAdd = useTranslations("admin.llm.add");
  const tCommon = useTranslations("common");
  const tLlm = useTranslations("admin.llm");
  const tIntegrations = useTranslations("admin.integrations");
  const tBudgetAlert = useTranslations("admin.llm.budgetAlert");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const { mutateAsync: updateLlmIntegration } = useUpdateLlmIntegration();
  const { mutateAsync: updateLlmProviderConfig } = useUpdateLlmProviderConfig();
  const { mutateAsync: deleteManyLlmUsage } = useDeleteManyLlmUsage();
  const [resettingSpend, setResettingSpend] = useState(false);
  const { data: existingDefaultConfigs } = useFindManyLlmProviderConfig({
    where: { isDefault: true },
  });
  const { data: existingIntegrations } = useFindManyLlmIntegration({
    select: { name: true },
  });

  const existingNames = (existingIntegrations ?? []).map((i) => i.name);
  const formSchema = createFormSchema(t, existingNames, integration?.name ?? "");

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      defaultModel: "",
      maxTokensPerRequest: 4096,
      maxRequestsPerMinute: 60,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      monthlyBudget: 0,
      defaultTemperature: 0.7,
      defaultMaxTokens: 1000,
      timeout: 30000,
      streamingEnabled: true,
      isDefault: false,
      status: "ACTIVE",
    },
  });

  const apiKey = form.watch("apiKey");
  const endpoint = form.watch("endpoint");
  const watchedBudget = form.watch("monthlyBudget");

  const fetchAvailableModels = async (
    providerType: string,
    apiKey?: string,
    endpoint?: string
  ) => {
    if (!PROVIDERS_WITH_DYNAMIC_MODELS.includes(providerType)) {
      return;
    }

    setFetchingModels(true);
    setModelsError(null);
    setAvailableModels([]);

    try {
      const response = await fetch("/api/admin/llm/available-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerType,
          apiKey,
          endpoint,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setAvailableModels(data.models || []);
        // Don't auto-set the first model when editing - keep the current selection
        if (data.models && data.models.length > 0) {
          toast.success(`Found ${data.models.length} available models`, {
            description: "Model list updated successfully",
          });
        } else {
          toast.warning("No models found", {
            description: "The provider returned no available models",
          });
        }
      } else {
        setModelsError(data.error || "Failed to fetch models");
        toast.error("Failed to fetch models", {
          description: data.error || "Unknown error",
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setModelsError(errorMessage);
      toast.error("Failed to fetch models", {
        description: errorMessage,
      });
    } finally {
      setFetchingModels(false);
    }
  };

  // Auto-fetch models when API key or endpoint changes (but not on initial load)
  useEffect(() => {
    // Don't fetch on initial render or if provider doesn't support dynamic models
    if (
      !integration?.provider ||
      !PROVIDERS_WITH_DYNAMIC_MODELS.includes(integration.provider)
    ) {
      return;
    }

    // Only fetch if the modal is open to avoid unnecessary API calls
    if (!open) {
      return;
    }

    // For providers that require an API key, wait until one is provided
    if (
      ["OPENAI", "ANTHROPIC", "GEMINI"].includes(integration.provider) &&
      !apiKey
    ) {
      return;
    }

    // Debounce the API calls to avoid too many requests
    const timeoutId = setTimeout(() => {
      fetchAvailableModels(integration.provider, apiKey, endpoint);
    }, 1000); // 1 second delay

    return () => clearTimeout(timeoutId);
  }, [apiKey, endpoint, integration?.provider, open]); // Dependencies: fetch when any of these change

  useEffect(() => {
    if (integration && open) {
      form.reset({
        name: integration.name,
        apiKey: integration.credentials?.apiKey || "",
        endpoint: integration.credentials?.endpoint || "",
        deploymentName: integration.settings?.deploymentName || "",
        defaultModel: integration.llmProviderConfig?.defaultModel || "",
        maxTokensPerRequest:
          integration.llmProviderConfig?.maxTokensPerRequest || 4096,
        maxRequestsPerMinute:
          integration.llmProviderConfig?.maxRequestsPerMinute || 60,
        costPerInputToken:
          Number(integration.llmProviderConfig?.costPerInputToken) || 0,
        costPerOutputToken:
          Number(integration.llmProviderConfig?.costPerOutputToken) || 0,
        monthlyBudget:
          Number(integration.llmProviderConfig?.monthlyBudget) || 0,
        defaultTemperature:
          integration.llmProviderConfig?.defaultTemperature || 0.7,
        defaultMaxTokens:
          integration.llmProviderConfig?.defaultMaxTokens || 1000,
        timeout: integration.llmProviderConfig?.timeout || 30000,
        streamingEnabled:
          integration.llmProviderConfig?.streamingEnabled ?? true,
        isDefault: integration.llmProviderConfig?.isDefault || false,
        status: integration.status,
      });
    }
  }, [integration, open, form]);

  const onSubmit = async (values: FormData) => {
    setLoading(true);

    try {
      // If setting as default, unset other defaults first
      if (
        values.isDefault &&
        existingDefaultConfigs &&
        existingDefaultConfigs.length > 0
      ) {
        await Promise.all(
          existingDefaultConfigs
            .filter((config) => config.id !== integration.llmProviderConfig?.id)
            .map((config) =>
              updateLlmProviderConfig({
                where: { id: config.id },
                data: { isDefault: false },
              })
            )
        );
      }

      // Update the integration
      await updateLlmIntegration({
        where: { id: integration.id },
        data: {
          name: values.name,
          status: values.status,
          credentials: {
            ...(integration.credentials || {}),
            ...(values.apiKey && { apiKey: values.apiKey }),
            ...(values.endpoint && {
              endpoint: values.endpoint,
              baseUrl: values.endpoint,
            }),
          },
          settings: {
            ...(integration.settings || {}),
            ...(values.deploymentName && {
              deploymentName: values.deploymentName,
            }),
          },
        },
      });

      // Update the LLM provider config
      if (integration.llmProviderConfig) {
        await updateLlmProviderConfig({
          where: { id: integration.llmProviderConfig.id },
          data: {
            defaultModel: values.defaultModel,
            maxTokensPerRequest: values.maxTokensPerRequest,
            maxRequestsPerMinute: values.maxRequestsPerMinute,
            costPerInputToken: values.costPerInputToken,
            costPerOutputToken: values.costPerOutputToken,
            monthlyBudget: values.monthlyBudget || 0,
            defaultTemperature: values.defaultTemperature,
            defaultMaxTokens: values.defaultMaxTokens,
            timeout: values.timeout,
            streamingEnabled: values.streamingEnabled,
            isDefault: values.isDefault,
            // Reset budget alert thresholds when config is saved — allows re-alerting against updated budget
            alertThresholdsFired: {},
          },
        });
      }

      // Clear the server-side LLM adapter cache so the new settings take effect
      try {
        await fetch("/api/admin/llm/clear-cache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ llmIntegrationId: integration.id }),
        });
      } catch (cacheError) {
        console.warn("Failed to clear LLM cache:", cacheError);
        // Don't fail the whole operation if cache clearing fails
      }

      toast.success(tCommon("fields.success"), {
        description: t("integrationUpdated"),
      });

      setOpen(false);
      // ZenStack will automatically invalidate hooks - no manual refresh needed
    } catch (error: any) {
      console.error("Error updating integration:", error);
      toast.error(tCommon("errors.error"), {
        description: error.message || t("failedToUpdate"),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetSpend = async () => {
    if (!integration?.id) return;

    setResettingSpend(true);
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      await deleteManyLlmUsage({
        where: {
          llmIntegrationId: integration.id,
          createdAt: { gte: startOfMonth },
        },
      });

      toast.success(tBudgetAlert("spendReset"));
    } catch (error: any) {
      console.error("Error resetting spend:", error);
      toast.error(tCommon("errors.error"), {
        description: error.message || tCommon("errors.error"),
      });
    } finally {
      setResettingSpend(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="px-2 py-1 h-auto"
      >
        <Edit className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={(value) => { if (!resettingSpend) setOpen(value); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => { if (resettingSpend) e.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t("description", { name: integration?.name })}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tIntegrations("config.name")}
                      <HelpPopover helpKey="llm.name" />
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
                name="status"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>{tCommon("fields.isActive")}</FormLabel>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value === "ACTIVE"}
                        onCheckedChange={(checked) =>
                          field.onChange(checked ? "ACTIVE" : "INACTIVE")
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {integration?.provider !== "OLLAMA" && (
                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tIntegrations("authType.api_key")}
                        <HelpPopover helpKey="llm.apiKey" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={t("apiKeyPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {tAdd("apiKeyDescription")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {(integration?.provider === "AZURE_OPENAI" ||
                integration?.provider === "OPENAI" ||
                integration?.provider === "CUSTOM_LLM" ||
                integration?.provider === "OLLAMA") && (
                <FormField
                  control={form.control}
                  name="endpoint"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("endpoint")}
                        <HelpPopover helpKey="llm.endpoint" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {integration?.provider === "AZURE_OPENAI" && (
                <FormField
                  control={form.control}
                  name="deploymentName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("deploymentName")}
                        <HelpPopover helpKey="llm.deploymentName" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="defaultModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                      <span className="flex items-center">
                        {tLlm("defaultModel")}
                        <HelpPopover helpKey="llm.defaultModel" />
                      </span>
                      {PROVIDERS_WITH_DYNAMIC_MODELS.includes(
                        integration?.provider
                      ) &&
                        fetchingModels && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            {tAdd("fetchingModels")}
                          </div>
                        )}
                    </FormLabel>
                    <FormControl>
                      {PROVIDERS_WITH_DYNAMIC_MODELS.includes(
                        integration?.provider
                      ) && availableModels.length > 0 ? (
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a model" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.map((model) => (
                              <SelectItem key={model} value={model}>
                                {model}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input {...field} />
                      )}
                    </FormControl>
                    {PROVIDERS_WITH_DYNAMIC_MODELS.includes(
                      integration?.provider
                    ) &&
                      modelsError && (
                        <div className="text-sm text-destructive mt-1">
                          {modelsError}
                        </div>
                      )}
                    {PROVIDERS_WITH_DYNAMIC_MODELS.includes(
                      integration?.provider
                    ) &&
                      availableModels.length === 0 &&
                      !fetchingModels &&
                      !modelsError && (
                        <FormDescription className="text-muted-foreground">
                          {integration?.provider === "GEMINI"
                            ? "Enter your API key and endpoint above. Models will be fetched automatically."
                            : integration?.provider === "OPENAI" ||
                                integration?.provider === "ANTHROPIC"
                              ? "Enter your API key above. We'll fetch the available models automatically."
                              : "Models will be fetched automatically from your Ollama instance."}
                        </FormDescription>
                      )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="maxTokensPerRequest"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("maxTokensPerRequest")}
                        <HelpPopover helpKey="llm.maxTokensPerRequest" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxRequestsPerMinute"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("maxRequestsPerMinute")}
                        <HelpPopover helpKey="llm.maxRequestsPerMinute" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="costPerInputToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("costPerInputToken")}
                        <HelpPopover helpKey="llm.costPerInputToken" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.0001"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="costPerOutputToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("costPerOutputToken")}
                        <HelpPopover helpKey="llm.costPerOutputToken" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.0001"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="monthlyBudget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tAdd("monthlyBudget")}
                      <HelpPopover helpKey="llm.monthlyBudget" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={tAdd("monthlyBudgetPlaceholder")}
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          field.onChange(isNaN(val) ? 0 : val);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      {tAdd("monthlyBudgetDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchedBudget != null &&
                Number(watchedBudget) > 0 &&
                (() => {
                  const budgetNum = Number(watchedBudget);
                  const percentage =
                    budgetNum > 0 ? (currentSpend / budgetNum) * 100 : 0;
                  return (
                    <div className="space-y-3">
                      {/* Disclaimer callout */}
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          {tBudgetAlert("budgetDisclaimer")}
                        </AlertDescription>
                      </Alert>

                      {/* Spend display and progress bar */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">
                            {tBudgetAlert("spendLabel")}
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                percentage > 100 ? "text-destructive font-medium" : ""
                              }
                            >
                              {tBudgetAlert("spendOfBudget", {
                                currentSpend: `$${currentSpend.toFixed(2)}`,
                                budgetLimit: `$${budgetNum.toFixed(2)}`,
                              })}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleResetSpend();
                              }}
                              disabled={resettingSpend || currentSpend === 0}
                            >
                              {resettingSpend ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                              {tBudgetAlert("resetSpend")}
                            </Button>
                          </div>
                        </div>

                        {/* Color-coded progress bar */}
                        <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              percentage > 100
                                ? "bg-destructive"
                                : percentage > 80
                                  ? "bg-warning"
                                  : "bg-success"
                            }`}
                            style={{ width: `${Math.min(percentage, 100)}%` }}
                          />
                        </div>

                        {/* Percentage text */}
                        <div className="text-xs text-muted-foreground">
                          {percentage > 100
                            ? tBudgetAlert("overBudget")
                            : tBudgetAlert("budgetPercentage", {
                                percentage: percentage.toFixed(0),
                              })}
                        </div>
                      </div>
                    </div>
                  );
                })()}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="defaultTemperature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("defaultTemperature")}
                        <HelpPopover helpKey="llm.defaultTemperature" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="defaultMaxTokens"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tAdd("defaultMaxTokens")}
                        <HelpPopover helpKey="llm.defaultMaxTokens" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="timeout"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tAdd("timeout")}
                      <HelpPopover helpKey="llm.timeout" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="5000"
                        max="600000"
                        step="1000"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {tAdd("timeoutDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="streamingEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="flex items-center">
                        {tAdd("streamingEnabled")}
                        <HelpPopover helpKey="llm.streamingEnabled" />
                      </FormLabel>
                      <FormDescription>
                        {tAdd("streamingEnabledDescription")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isDefault"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="flex items-center">
                        {tAdd("setAsDefault")}
                        <HelpPopover helpKey="llm.isDefault" />
                      </FormLabel>
                      <FormDescription>
                        {tAdd("setAsDefaultDescription")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={integration.llmProviderConfig?.isDefault}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("update")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
