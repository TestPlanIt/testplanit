"use client";

import {
  FormControl, FormField,
  FormItem,
  FormLabel, FormMessage
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";

interface FieldConfig {
  name: string;
  label: string;
  placeholder?: string;
  type?: string; // "password" for sensitive fields
  isCredential: boolean; // true = goes in credentials object; false = goes in settings
  helpKey?: string;
  isUrl?: boolean; // true = show HTTP plaintext warning when value starts with http://
}

// Field definitions per provider -- mirrors IntegrationConfigForm.tsx providerFields pattern
const providerFields: Record<string, FieldConfig[]> = {
  GITHUB: [
    {
      name: "personalAccessToken",
      label: "Personal Access Token",
      type: "password",
      isCredential: true,
      placeholder: "ghp_...",
      helpKey: "codeRepository.githubToken",
    },
    {
      name: "owner",
      label: "Owner",
      placeholder: "myorg",
      isCredential: false,
      helpKey: "codeRepository.owner",
    },
    {
      name: "repo",
      label: "Repository",
      placeholder: "my-repo",
      isCredential: false,
      helpKey: "codeRepository.repo",
    },
  ],
  GITLAB: [
    {
      name: "personalAccessToken",
      label: "Personal Access Token (PAT)",
      type: "password",
      isCredential: true,
      placeholder: "glpat-...",
      helpKey: "codeRepository.gitlabToken",
    },
    {
      name: "projectPath",
      label: "Project ID or Path",
      placeholder: "myorg/my-project",
      isCredential: false,
      helpKey: "codeRepository.projectPath",
    },
    {
      name: "baseUrl",
      label: "GitLab URL (self-hosted only)",
      placeholder: "https://gitlab.com",
      isCredential: false,
      helpKey: "codeRepository.baseUrl",
      isUrl: true,
    },
  ],
  BITBUCKET: [
    {
      name: "email",
      label: "Atlassian Account Email",
      isCredential: true,
      placeholder: "you@example.com",
      helpKey: "codeRepository.bitbucketEmail",
    },
    {
      name: "apiToken",
      label: "API Token",
      type: "password",
      isCredential: true,
      placeholder: "...",
      helpKey: "codeRepository.bitbucketApiToken",
    },
    {
      name: "workspace",
      label: "Workspace",
      placeholder: "myworkspace",
      isCredential: false,
      helpKey: "codeRepository.workspace",
    },
    {
      name: "repoSlug",
      label: "Repository Slug",
      placeholder: "my-repo",
      isCredential: false,
      helpKey: "codeRepository.repoSlug",
    },
  ],
  AZURE_DEVOPS: [
    {
      name: "personalAccessToken",
      label: "Personal Access Token",
      type: "password",
      isCredential: true,
      placeholder: "...",
      helpKey: "codeRepository.azureToken",
    },
    {
      name: "organizationUrl",
      label: "Organization URL",
      placeholder: "https://dev.azure.com/myorg",
      isCredential: false,
      helpKey: "codeRepository.organizationUrl",
      isUrl: true,
    },
    {
      name: "project",
      label: "Project Name",
      placeholder: "MyProject",
      isCredential: false,
      helpKey: "codeRepository.project",
    },
    {
      name: "repositoryId",
      label: "Repository Name or ID",
      placeholder: "my-repo",
      isCredential: false,
      helpKey: "codeRepository.azureRepoId",
    },
  ],
  GITEA: [
    {
      name: "personalAccessToken",
      label: "Personal Access Token",
      type: "password",
      isCredential: true,
      placeholder: "...",
      helpKey: "codeRepository.giteaToken",
    },
    {
      name: "baseUrl",
      label: "Server URL",
      placeholder: "https://gitea.example.com",
      isCredential: false,
      helpKey: "codeRepository.giteaBaseUrl",
      isUrl: true,
    },
    {
      name: "owner",
      label: "Owner",
      placeholder: "myorg",
      isCredential: false,
      helpKey: "codeRepository.giteaOwner",
    },
    {
      name: "repo",
      label: "Repository",
      placeholder: "my-repo",
      isCredential: false,
      helpKey: "codeRepository.giteaRepo",
    },
  ],
};

interface CodeRepositoryConfigFormProps {
  provider: string;
  form: UseFormReturn<any>;
}

export function CodeRepositoryConfigForm({
  provider,
  form,
}: CodeRepositoryConfigFormProps) {
  const fields = providerFields[provider] ?? [];
  const t = useTranslations("admin.codeRepositories");

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const formFieldName = field.isCredential
          ? `credentials.${field.name}`
          : `settings.${field.name}`;

        return (
          <FormField
            key={field.name}
            control={form.control}
            name={formFieldName}
            render={({ field: formField }) => {
              const showHttpWarning =
                field.isUrl &&
                typeof formField.value === "string" &&
                formField.value.startsWith("http://");

              return (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {field.label}
                    <HelpPopover helpKey={field.helpKey ?? ""} />
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...formField}
                      value={formField.value ?? ""}
                      type={field.type ?? "text"}
                      placeholder={field.placeholder}
                      autoComplete={
                        field.type === "password" ? "new-password" : undefined
                      }
                    />
                  </FormControl>
                  {showHttpWarning && (
                    <p className="flex items-center gap-1.5 text-sm text-warning">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      {t("httpWarning")}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        );
      })}
    </div>
  );
}

export { providerFields };
export type { FieldConfig };
