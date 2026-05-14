"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IntegrationAuthType, IntegrationProvider } from "@prisma/client";
import {
  AlertTriangle,
  Check,
  Copy,
  Lock,
  Edit,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
  options?: { value: string; label: string }[];
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
  [IntegrationProvider.GITLAB]: [
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
      name: "projectPath",
      label: "config.projectPath",
      placeholder: "config.projectPathPlaceholder",
      help: "config.projectPathHelp",
      isCredential: false,
      required: true,
    },
    {
      name: "instanceUrl",
      label: "config.instanceUrl",
      placeholder: "config.instanceUrlPlaceholder",
      help: "config.instanceUrlHelp",
      isCredential: false,
      required: false,
    },
  ],
  [IntegrationProvider.GITEA]: [
    {
      name: "platform",
      label: "config.platform",
      placeholder: "config.platformPlaceholder",
      help: "config.platformHelp",
      type: "select",
      options: [
        { value: "gitea", label: "config.platformGitea" },
        { value: "forgejo", label: "config.platformForgejo" },
        { value: "gogs", label: "config.platformGogs" },
      ],
      isCredential: false,
      required: true,
    },
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
      name: "owner",
      label: "config.owner",
      placeholder: "config.ownerPlaceholder",
      help: "config.ownerHelp",
      isCredential: false,
      required: true,
    },
    {
      name: "repo",
      label: "config.repo",
      placeholder: "config.repoPlaceholder",
      help: "config.repoHelp",
      isCredential: false,
      required: true,
    },
    {
      name: "instanceUrl",
      label: "config.instanceUrl",
      placeholder: "config.giteaInstanceUrlPlaceholder",
      help: "config.instanceUrlHelp",
      isCredential: false,
      required: true,
    },
  ],
};

function generateApiKey(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return (
    "tpi_forge_" + Array.from(array, (b) => chars[b % chars.length]).join("")
  );
}

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
  const [copied, setCopied] = useState(false);
  const [unlockedFields, setUnlockedFields] = useState<Set<string>>(new Set());

  // Get fields based on provider and authType combination, or fall back to provider-only fields
  const authKey = authType ? `${provider}_${authType}` : "";
  const authFields = authTypeFields[authKey] || [];
  const baseFields = providerFields[provider] || [];

  // Merge auth-specific fields with base provider fields
  // Use a Set to avoid duplicate fields by name
  const fieldMap = new Map<string, FieldConfig>();
  [...baseFields, ...authFields].forEach((field) => {
    fieldMap.set(field.name, field);
  });
  const fields = Array.from(fieldMap.values());

  const getFieldLabel = (label: string): string => {
    if (label.startsWith("common.")) {
      return (tCommon as unknown as (key: string) => string)(label);
    }
    return (t as unknown as (key: string) => string)(label);
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
  const showApiKeyWarning =
    provider === IntegrationProvider.JIRA &&
    authType === IntegrationAuthType.API_KEY;

  return (
    <div className="space-y-4">
      {showApiKeyWarning && (
        <Alert className="border-warning/50 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-warning-foreground">
            {t("config.apiKeyWarningTitle")}
          </AlertTitle>
          <AlertDescription className="text-warning-foreground">
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
        const isEncrypted =
          isEdit &&
          field.isCredential &&
          !value &&
          !unlockedFields.has(field.name);

        return (
          <FormItem key={field.name}>
            <FormLabel className="flex items-center">
              {getFieldLabel(field.label)}
              {field.required && (
                <span className="text-destructive ml-1">{"*"}</span>
              )}
              {field.help && (
                <HelpPopover
                  helpKey={`integration.${field.help.replace("config.", "").replace("Help", "")}`}
                />
              )}
            </FormLabel>
            <FormControl>
              <div className="relative">
                {field.type === "select" && field.options ? (
                  <Select
                    value={value}
                    onValueChange={(v) => handleFieldChange(field, v)}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={(t as unknown as (key: string) => string)(
                          field.placeholder
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {(t as unknown as (key: string) => string)(opt.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={field.type || "text"}
                    placeholder={
                      isEncrypted
                        ? "••••••••••••"
                        : (t as unknown as (key: string) => string)(
                            field.placeholder
                          )
                    }
                    value={value}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    disabled={isEncrypted}
                  />
                )}
                {isEncrypted && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <Badge variant="secondary" className="text-xs">
                      <Lock className="w-3 h-3 mr-1" />
                      {t("config.encrypted")}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setUnlockedFields((prev) => {
                          const next = new Set(prev);
                          next.add(field.name);
                          return next;
                        });
                      }}
                    >
                      <Edit className="w-3 h-3" />
                      {t("config.changeCredential")}
                    </Button>
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

      {provider === IntegrationProvider.JIRA && (
        <div className="border-t pt-4 mt-4">
          <FormItem>
            <FormLabel className="flex items-center">
              {t("config.forgeApiKeyLabel")}
              <HelpPopover helpKey="integration.forgeApiKey" />
            </FormLabel>
            <FormDescription className="mb-2">
              {t("config.forgeApiKeyDescription")}
            </FormDescription>
            <FormControl>
              <div className="flex gap-2">
                <Input
                  type="text"
                  readOnly
                  value={settings.forgeApiKey || ""}
                  placeholder={t("config.forgeApiKeyPlaceholder")}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const key = generateApiKey();
                    onSettingsChange({ ...settings, forgeApiKey: key });
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("config.forgeApiKeyGenerate")}
                </Button>
                {settings.forgeApiKey && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(settings.forgeApiKey);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied
                      ? t("config.forgeApiKeyCopied")
                      : t("config.forgeApiKeyCopy")}
                  </Button>
                )}
              </div>
            </FormControl>
          </FormItem>
        </div>
      )}
    </div>
  );
}
