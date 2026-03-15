"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
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
import { Prisma } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import {
  useCreateLlmIntegration,
  useFindManyLlmIntegration
} from "~/lib/hooks/llm-integration";
import {
  useCreateLlmProviderConfig, useFindManyLlmProviderConfig, useUpdateLlmProviderConfig
} from "~/lib/hooks/llm-provider-config";

const createFormSchema = (t: any, existingNames: string[]) =>
  z.object({
    name: z
      .string()
      .min(1, t("validation.nameRequired"))
      .refine(
        (name) =>
          !existingNames.some(
            (existing) => existing.toLowerCase() === name.toLowerCase()
          ),
        { message: t("validation.nameUnique") }
      ),
    provider: z.enum([
      "OPENAI",
      "ANTHROPIC",
      "AZURE_OPENAI",
      "GEMINI",
      "OLLAMA",
      "CUSTOM_LLM",
    ] as const),
    apiKey: z.string().optional(),
    endpoint: z.string().optional(),
    deploymentName: z.string().optional(),
    defaultModel: z.string().min(1, t("validation.defaultModelRequired")),
    maxTokensPerRequest: z.number().min(1).max(1048576),
    maxRequestsPerMinute: z.number().min(1).max(10000),
    costPerInputToken: z.number().min(0),
    costPerOutputToken: z.number().min(0),
    monthlyBudget: z.number().min(0).optional(),
    defaultTemperature: z.number().min(0).max(2),
    defaultMaxTokens: z.number().min(1).max(1048576),
    timeout: z.number().min(5000).max(600000), // 5 seconds to 10 minutes
    streamingEnabled: z.boolean(),
    isDefault: z.boolean(),
  });

type FormData = z.infer<ReturnType<typeof createFormSchema>>;

interface AddLlmIntegrationProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Providers that support dynamic model fetching
const PROVIDERS_WITH_DYNAMIC_MODELS = ["OPENAI", "ANTHROPIC", "GEMINI", "OLLAMA"];

const providerDefaults: Record<string, Partial<FormData>> = {
  OPENAI: {
    defaultModel: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1",
    maxTokensPerRequest: 16384,
    maxRequestsPerMinute: 60,
    costPerInputToken: 0.15,
    costPerOutputToken: 0.6,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000, // 30 seconds
  },
  ANTHROPIC: {
    defaultModel: "claude-haiku-4-5-20251001",
    endpoint: "https://api.anthropic.com/v1",
    maxTokensPerRequest: 64000,
    maxRequestsPerMinute: 50,
    costPerInputToken: 1.0,
    costPerOutputToken: 5.0,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000, // 30 seconds
  },
  AZURE_OPENAI: {
    defaultModel: "gpt-4o-mini",
    maxTokensPerRequest: 16384,
    maxRequestsPerMinute: 60,
    costPerInputToken: 0.15,
    costPerOutputToken: 0.6,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000, // 30 seconds
  },
  GEMINI: {
    defaultModel: "gemini-2.0-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    maxTokensPerRequest: 8192,
    maxRequestsPerMinute: 60,
    costPerInputToken: 0.1,
    costPerOutputToken: 0.4,
    defaultTemperature: 0.7,
    defaultMaxTokens: 2048,
    timeout: 30000, // 30 seconds
  },
  OLLAMA: {
    defaultModel: "llama3.2",
    endpoint: "", // User must provide a publicly accessible URL
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 100,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 120000, // 2 minutes for local models
  },
  CUSTOM_LLM: {
    defaultModel: "custom-model",
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 60,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 60000, // 1 minute
  },
};

export function AddLlmIntegration({
  open,
  onClose,
  onSuccess,
}: AddLlmIntegrationProps) {
  const t = useTranslations("admin.llm.add");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tIntegrations = useTranslations("admin.integrations");
  const tLlm = useTranslations("admin.llm");
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const { mutateAsync: createLlmIntegration } = useCreateLlmIntegration();
  const { mutateAsync: createLlmProviderConfig } = useCreateLlmProviderConfig();
  const { mutateAsync: updateLlmProviderConfig } = useUpdateLlmProviderConfig();
  const { data: existingDefaultConfigs } = useFindManyLlmProviderConfig({
    where: { isDefault: true },
  });
  const { data: existingIntegrations } = useFindManyLlmIntegration({
    select: { name: true },
  });

  const existingNames = (existingIntegrations ?? []).map((i) => i.name);
  const formSchema = createFormSchema(t, existingNames);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      provider: "GEMINI",
      apiKey: "",
      endpoint: "",
      deploymentName: "",
      defaultModel: "gemini-1.5-flash",
      maxTokensPerRequest: 8192,
      maxRequestsPerMinute: 60,
      costPerInputToken: 0.075,
      costPerOutputToken: 0.3,
      monthlyBudget: 0,
      defaultTemperature: 0.7,
      defaultMaxTokens: 2048,
      timeout: 30000,
      streamingEnabled: true,
      isDefault: false,
    },
  });

  const provider = form.watch("provider");
  const apiKey = form.watch("apiKey");
  const endpoint = form.watch("endpoint");

  const fetchAvailableModels = useCallback(
    async (providerType: string, apiKey?: string, endpoint?: string) => {
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
          // Set the first model as default if available
          if (data.models && data.models.length > 0) {
            form.setValue("defaultModel", data.models[0]);
            toast.success(`Found ${data.models.length} available models`, {
              description: `Selected "${data.models[0]}" as default model`,
            });
          } else {
            toast.warning("No models found", {
              description: "The provider returned no available models",
            });
          }
        } else {
          setModelsError(data.error || "Failed to fetch models");
          toast.error(t("failedToFetchModels"), {
            description: data.error || "Unknown error",
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setModelsError(errorMessage);
        toast.error(t("failedToFetchModels"), {
          description: errorMessage,
        });
      } finally {
        setFetchingModels(false);
      }
    },
    [form, t]
  );

  const handleProviderChange = (value: string) => {
    const defaults = providerDefaults[value];
    if (defaults) {
      Object.entries(defaults).forEach(([key, val]) => {
        form.setValue(key as any, val as any);
      });
    }

    // Clear previous models and reset default model
    setAvailableModels([]);
    setModelsError(null);

    if (PROVIDERS_WITH_DYNAMIC_MODELS.includes(value)) {
      // For dynamic providers, clear the model field until we fetch the list
      form.setValue("defaultModel", "");
    } else if (defaults?.defaultModel) {
      form.setValue("defaultModel", defaults.defaultModel as string);
    }
  };

  // Auto-fetch models when provider, API key, or endpoint changes
  useEffect(() => {
    // Don't fetch on initial render or if provider doesn't support dynamic models
    if (!PROVIDERS_WITH_DYNAMIC_MODELS.includes(provider)) {
      return;
    }

    // For providers that require an API key, wait until one is provided
    if (["OPENAI", "ANTHROPIC", "GEMINI"].includes(provider) && !apiKey) {
      return;
    }

    // Ollama and custom providers require an endpoint
    if (["OLLAMA", "CUSTOM_LLM"].includes(provider) && !endpoint) {
      return;
    }

    // Debounce the API calls to avoid too many requests
    const timeoutId = setTimeout(() => {
      fetchAvailableModels(provider, apiKey, endpoint);
    }, 1000); // 1 second delay

    return () => clearTimeout(timeoutId);
  }, [provider, apiKey, endpoint, fetchAvailableModels]);

  const testConnection = async () => {
    setTestingConnection(true);
    const values = form.getValues();

    try {
      const response = await fetch("/api/admin/llm/test-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: values.provider,
          apiKey: values.apiKey,
          endpoint: values.endpoint,
          deploymentName: values.deploymentName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(tIntegrations("testSuccess"), {
          description: t("connectionSuccessfulDescription"),
        });
      } else {
        const errorMsg = data.error || t("failedToConnect");
        const endpointVal = values.endpoint?.replace(/\/+$/, "");
        const hint =
          endpointVal && !endpointVal.endsWith("/v1")
            ? " " + t("endpointV1Hint")
            : "";
        toast.error(tIntegrations("testFailed"), {
          description: errorMsg + hint,
        });
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : t("failedToConnect");
      const endpointVal = values.endpoint?.replace(/\/+$/, "");
      const hint =
        endpointVal && !endpointVal.endsWith("/v1")
          ? " " + t("endpointV1Hint")
          : "";
      toast.error(tIntegrations("testFailed"), {
        description: errorMsg + hint,
      });
    } finally {
      setTestingConnection(false);
    }
  };

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
          existingDefaultConfigs.map((config) =>
            updateLlmProviderConfig({
              where: { id: config.id },
              data: { isDefault: false },
            })
          )
        );
      }

      // Create the integration using ZenStack hook
      // Build settings object only with relevant fields for the provider
      const settings: Record<string, string> = {};
      if (values.provider === "AZURE_OPENAI") {
        if (values.deploymentName) {
          settings.deploymentName = values.deploymentName;
        }
      }

      const integrationData = {
        name: values.name,
        provider: values.provider,
        status: "ACTIVE" as const,
        credentials: {
          apiKey: values.apiKey,
          endpoint: values.endpoint,
          baseUrl: values.endpoint,
        },
        settings: Object.keys(settings).length > 0 ? settings : Prisma.JsonNull,
      };

      const llmIntegration = await createLlmIntegration({
        data: integrationData,
      });

      if (llmIntegration) {
        // Create the LLM provider config
        await createLlmProviderConfig({
          data: {
            llmIntegrationId: llmIntegration.id,
            defaultModel: values.defaultModel,
            availableModels: {},
            maxTokensPerRequest: values.maxTokensPerRequest,
            maxRequestsPerMinute: values.maxRequestsPerMinute,
            maxRequestsPerDay: null,
            costPerInputToken: values.costPerInputToken,
            costPerOutputToken: values.costPerOutputToken,
            monthlyBudget: values.monthlyBudget || 0,
            defaultTemperature: values.defaultTemperature,
            defaultMaxTokens: values.defaultMaxTokens,
            timeout: values.timeout,
            retryAttempts: 3,
            streamingEnabled: values.streamingEnabled,
            isDefault: values.isDefault,
          },
        });

        toast.success(tCommon("fields.success"), {
          description: t("integrationCreated"),
        });
        onSuccess();
      }
    } catch (error: any) {
      const message =
        error?.info?.message ||
        error?.info?.error ||
        error?.message ||
        "Unknown error occurred";
      toast.error(t("failedToCreate"), {
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
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
                    <Input
                      placeholder={t("integrationNamePlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.provider")}
                    <HelpPopover helpKey="llm.provider" />
                  </FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      handleProviderChange(value);
                    }}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("selectProvider")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="OPENAI">{t("openai")}</SelectItem>
                      <SelectItem value="ANTHROPIC">
                        {t("anthropic")}
                      </SelectItem>
                      <SelectItem value="AZURE_OPENAI">
                        {t("azureOpenai")}
                      </SelectItem>
                      <SelectItem value="GEMINI">{t("gemini")}</SelectItem>
                      <SelectItem value="OLLAMA">{t("ollama")}</SelectItem>
                      <SelectItem value="CUSTOM_LLM">
                        {t("customLlm")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {provider !== "OLLAMA" && (
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
                    <FormDescription>{t("apiKeyDescription")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="endpoint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {t("endpoint")}
                    <HelpPopover helpKey="llm.endpoint" />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={t("endpointPlaceholder")} {...field} />
                  </FormControl>
                  <FormDescription>{t("endpointDescription")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {provider === "AZURE_OPENAI" && (
              <FormField
                control={form.control}
                name="deploymentName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {t("deploymentName")}
                      <HelpPopover helpKey="llm.deploymentName" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("deploymentNamePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("deploymentNameDescription")}
                    </FormDescription>
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
                    {PROVIDERS_WITH_DYNAMIC_MODELS.includes(provider) &&
                      fetchingModels && (
                        <div className="flex items-center text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          {t("fetchingModels")}
                        </div>
                      )}
                  </FormLabel>
                  <FormControl>
                    {PROVIDERS_WITH_DYNAMIC_MODELS.includes(provider) &&
                    availableModels.length > 0 ? (
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("selectModel")} />
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
                      <Input
                        placeholder={t("defaultModelPlaceholder")}
                        {...field}
                      />
                    )}
                  </FormControl>
                  {PROVIDERS_WITH_DYNAMIC_MODELS.includes(provider) &&
                    modelsError && (
                      <div className="text-sm text-destructive mt-1">
                        {modelsError}
                      </div>
                    )}
                  {PROVIDERS_WITH_DYNAMIC_MODELS.includes(provider) &&
                    availableModels.length === 0 &&
                    !fetchingModels &&
                    !modelsError && (
                      <FormDescription className="text-muted-foreground">
                        {provider === "GEMINI"
                          ? "Enter your API key and endpoint above. Models will be fetched automatically."
                          : provider === "OPENAI" || provider === "ANTHROPIC"
                            ? "Enter your API key above. We'll fetch the available models automatically."
                            : "Models will be fetched automatically from your Ollama instance."}
                      </FormDescription>
                    )}
                  {!PROVIDERS_WITH_DYNAMIC_MODELS.includes(provider) && (
                    <FormDescription>
                      {t("defaultModelDescription")}
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
                    {t("maxTokensPerRequest")}
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
                    {t("maxRequestsPerMinute")}
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
                    {t("costPerInputToken")}
                    <HelpPopover helpKey="llm.costPerInputToken" />
                  </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.000001"
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
                    {t("costPerOutputToken")}
                    <HelpPopover helpKey="llm.costPerOutputToken" />
                  </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.000001"
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
                    {t("monthlyBudget")}
                    <HelpPopover helpKey="llm.monthlyBudget" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseFloat(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    {t("monthlyBudgetDescription")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="defaultTemperature"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                    {t("defaultTemperature")}
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
                    {t("defaultMaxTokens")}
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
                    {t("timeout")}
                    <HelpPopover helpKey="llm.timeout" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="5000"
                      max="600000"
                      step="1000"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>{t("timeoutDescription")}</FormDescription>
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
                      {t("streamingEnabled")}
                      <HelpPopover helpKey="llm.streamingEnabled" />
                    </FormLabel>
                    <FormDescription>
                      {t("streamingEnabledDescription")}
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
                      {t("setAsDefault")}
                      <HelpPopover helpKey="llm.isDefault" />
                    </FormLabel>
                    <FormDescription>
                      {t("setAsDefaultDescription")}
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

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={testConnection}
                disabled={
                  testingConnection ||
                  !form.watch("name") ||
                  (provider !== "OLLAMA" && !form.watch("apiKey"))
                }
              >
                {testingConnection && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {tIntegrations("testConnection")}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tCommon("actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
