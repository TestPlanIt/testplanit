"use client";

import { useTranslations } from "next-intl";
import { IntegrationProvider, IntegrationAuthType } from "@prisma/client";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HelpPopover } from "@/components/ui/help-popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lock, AlertTriangle } from "lucide-react";

interface IntegrationConfigFormProps {
  provider: IntegrationProvider;
  authType?: IntegrationAuthType;
  credentials: Record<string, string>;
  settings: Record<string, string>;
  onCredentialsChange: (credentials: Record<string, string>) => void;
  onSettingsChange: (settings: Record<string, string>) => void;
  isEdit?: boolean;
}

interface FieldConfig {
  name: string;
  label: string;
  placeholder: string;
  help?: string;
  type?: string;
  isCredential?: boolean;
  required?: boolean;
}

// Provider + AuthType specific fields
const authTypeFields: Record<string, FieldConfig[]> = {
  [`${IntegrationProvider.JIRA}_${IntegrationAuthType.API_KEY}`]: [
    {
      name: "email",
      label: "common.fields.email",
      placeholder: "config.emailPlaceholder",
      help: "config.emailHelp",
      isCredential: true,
      required: true,
    },
    {
      name: "apiToken",
      label: "config.apiToken",
      placeholder: "config.apiTokenPlaceholder",
      help: "config.apiTokenHelp",
      type: "password",
      isCredential: true,
      required: true,
    },
    {
      name: "baseUrl",
      label: "config.jiraUrl",
      placeholder: "config.jiraUrlPlaceholder",
      help: "config.jiraUrlHelp",
      isCredential: false,
      required: true,
    },
  ],
  [`${IntegrationProvider.JIRA}_${IntegrationAuthType.OAUTH2}`]: [
    {
      name: "clientId",
      label: "config.clientId",
      placeholder: "config.clientIdPlaceholder",
      help: "config.clientIdHelp",
      isCredential: true,
      required: true,
    },
    {
      name: "clientSecret",
      label: "config.clientSecret",
      placeholder: "config.clientSecretPlaceholder",
      help: "config.clientSecretHelp",
      type: "password",
      isCredential: true,
      required: true,
    },
    {
      name: "baseUrl",
      label: "config.jiraUrl",
      placeholder: "config.jiraUrlPlaceholder",
      help: "config.jiraUrlHelp",
      isCredential: false,
      required: true,
    },
  ],
  [`${IntegrationProvider.SIMPLE_URL}_${IntegrationAuthType.API_KEY}`]: [
    {
      name: "apiKey",
      label: "config.apiKey",
      placeholder: "config.apiKeyPlaceholder",
      help: "config.apiKeyHelp",
      type: "password",
      isCredential: true,
      required: false,
    },
  ],
};

const providerFields: Record<IntegrationProvider, FieldConfig[]> = {
  [IntegrationProvider.JIRA]: [],
  [IntegrationProvider.SIMPLE_URL]: [
    {
      name: "baseUrl",
      label: "config.baseUrl",
      placeholder: "config.baseUrlPlaceholder",
      help: "config.baseUrlHelp",
      isCredential: false,
      required: true,
    },
  ],
  [IntegrationProvider.GITHUB]: [
    {
      name: "personalAccessToken",
      label: "authType.personal_access_token",
      placeholder: "config.personalAccessTokenPlaceholder",
      help: "config.personalAccessTokenHelp",
      type: "password",
      isCredential: true,
      required: true,
    },
  ],
  [IntegrationProvider.AZURE_DEVOPS]: [
    {
      name: "personalAccessToken",
      label: "authType.personal_access_token",
      placeholder: "config.personalAccessTokenPlaceholder",
      help: "config.personalAccessTokenHelp",
      type: "password",
      isCredential: true,
      required: true,
    },
    {
      name: "organizationUrl",
      label: "config.organizationUrl",
      placeholder: "config.organizationUrlPlaceholder",
      help: "config.organizationUrlHelp",
      isCredential: false,
      required: true,
    },
  ],
};

export function IntegrationConfigForm({
  provider,
  authType,
  credentials,
  settings,
  onCredentialsChange,
  onSettingsChange,
  isEdit,
}: IntegrationConfigFormProps) {
  const t = useTranslations("admin.integrations");
  const tCommon = useTranslations();

  // Get fields based on provider and authType combination, or fall back to provider-only fields
  const authKey = authType ? `${provider}_${authType}` : '';
  const authFields = authTypeFields[authKey] || [];
  const baseFields = providerFields[provider] || [];

  // Merge auth-specific fields with base provider fields
  // Use a Set to avoid duplicate fields by name
  const fieldMap = new Map<string, FieldConfig>();
  [...baseFields, ...authFields].forEach(field => {
    fieldMap.set(field.name, field);
  });
  const fields = Array.from(fieldMap.values());

  const getFieldLabel = (label: string): string => {
    if (label.startsWith('common.')) {
      // Type assertion needed for dynamic keys - validated at runtime by startsWith check
      return tCommon(label as Parameters<typeof tCommon>[0]);
    }
    // Type assertion needed for dynamic keys - all non-common keys are in admin.integrations namespace
    return t(label as Parameters<typeof t>[0]);
  };

  const handleFieldChange = (field: FieldConfig, value: string) => {
    if (field.isCredential) {
      onCredentialsChange({ ...credentials, [field.name]: value });
    } else {
      onSettingsChange({ ...settings, [field.name]: value });
    }
  };

  const getFieldValue = (field: FieldConfig) => {
    if (field.isCredential) {
      return credentials[field.name] || "";
    }
    return settings[field.name] || "";
  };

  // Show warning for API key authentication with Jira
  const showApiKeyWarning = provider === IntegrationProvider.JIRA && authType === IntegrationAuthType.API_KEY;

  return (
    <div className="space-y-4">
      {showApiKeyWarning && (
        <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="text-amber-900 dark:text-amber-100">
            {t("config.apiKeyWarningTitle")}
          </AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <div className="mt-2 space-y-2">
              <p>{t("config.apiKeyWarningDescription")}</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>{t("config.apiKeyWarningPoint1")}</li>
                <li>{t("config.apiKeyWarningPoint2")}</li>
                <li>{t("config.apiKeyWarningPoint3")}</li>
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {fields.map((field) => {
        const value = getFieldValue(field);
        const isEncrypted = isEdit && field.isCredential && !value;

        return (
          <FormItem key={field.name}>
            <FormLabel className="flex items-center">
              {getFieldLabel(field.label)}
              {field.required && (
                <span className="text-destructive ml-1">{"*"}</span>
              )}
              {field.help && <HelpPopover helpKey={`integration.${field.help.replace('config.', '').replace('Help', '')}`} />}
            </FormLabel>
            <FormControl>
              <div className="relative">
                <Input
                  type={field.type || "text"}
                  placeholder={
                    isEncrypted ? "••••••••••••" : t(field.placeholder as Parameters<typeof t>[0])
                  }
                  value={value}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                  disabled={isEncrypted}
                />
                {isEncrypted && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Badge variant="secondary" className="text-xs">
                      <Lock className="w-3 h-3 mr-1" />
                      {t("config.encrypted")}
                    </Badge>
                  </div>
                )}
              </div>
            </FormControl>
            {isEncrypted && (
              <FormDescription>
                <span className="block text-xs mt-1">
                  {t("config.encryptedHelp")}
                </span>
              </FormDescription>
            )}
          </FormItem>
        );
      })}
    </div>
  );
}
