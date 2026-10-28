"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/tables/DataTable";
import { ColumnDef } from "@/components/tables/tableFeatures";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SsoConfigSummary } from "~/lib/auth/ssoConfig";
import { Access, SsoProviderType } from "~/zenstack/models";
import { CirclePlus, Plus, Settings, Trash2, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";

type SignInProviderRow = {
  id: string;
  name: string;
  configured: boolean;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onConfigure: (() => void) | null;
  onDelete?: () => void;
  typeLabel?: string;
};

export default function SSOAdminPage() {
  const { data: session } = useSession();
  const t = useTranslations();
  const router = useRouter();

  const { data: ssoProviders, refetch } = useClientQueries(
    schema
  ).ssoProvider.useFindMany({
    include: { samlConfig: true },
  });
  const { mutateAsync: createProvider } =
    useClientQueries(schema).ssoProvider.useCreate();
  const { mutateAsync: updateProvider } =
    useClientQueries(schema).ssoProvider.useUpdate();
  const { mutateAsync: deleteProvider } =
    useClientQueries(schema).ssoProvider.useDelete();

  // Domain restriction hooks
  const { data: allowedDomains, refetch: refetchDomains } = useClientQueries(
    schema
  ).allowedEmailDomain.useFindMany({
    orderBy: { domain: "asc" },
  });
  const { mutateAsync: createDomain } =
    useClientQueries(schema).allowedEmailDomain.useCreate();
  const { mutateAsync: updateDomain } =
    useClientQueries(schema).allowedEmailDomain.useUpdate();
  const { mutateAsync: deleteDomain } =
    useClientQueries(schema).allowedEmailDomain.useDelete();

  // Registration settings hooks
  const { data: registrationSettings, refetch: refetchSettings } =
    useClientQueries(schema).registrationSettings.useFindFirst();
  const { mutateAsync: upsertSettings } =
    useClientQueries(schema).registrationSettings.useUpsert();

  // Google OAuth configuration state
  const [isGoogleConfigOpen, setIsGoogleConfigOpen] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [isSavingGoogleConfig, setIsSavingGoogleConfig] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);

  // SAML state. Each SAML provider is edited on its own page
  // (/admin/sso/saml/[providerId]) and gets its own row here, so this page
  // only routes to that page, adds providers, and removes them.
  const [isOpeningSamlConfig, setIsOpeningSamlConfig] = useState(false);
  const [samlProviderToDelete, setSamlProviderToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isDeletingSamlProvider, setIsDeletingSamlProvider] = useState(false);

  // Domain restriction state
  const [newDomain, setNewDomain] = useState("");
  const [isAddingDomain, setIsAddingDomain] = useState(false);

  // Apple configuration state
  const [isAppleConfigOpen, setIsAppleConfigOpen] = useState(false);
  const [appleClientId, setAppleClientId] = useState("");
  const [appleTeamId, setAppleTeamId] = useState("");
  const [appleKeyId, setAppleKeyId] = useState("");
  const [applePrivateKey, setApplePrivateKey] = useState("");
  const [isSavingAppleConfig, setIsSavingAppleConfig] = useState(false);
  const [appleConfigured, setAppleConfigured] = useState(false);

  // Microsoft configuration state
  const [isMicrosoftConfigOpen, setIsMicrosoftConfigOpen] = useState(false);
  const [microsoftClientId, setMicrosoftClientId] = useState("");
  const [microsoftClientSecret, setMicrosoftClientSecret] = useState("");
  const [microsoftTenantId, setMicrosoftTenantId] = useState("");
  const [isSavingMicrosoftConfig, setIsSavingMicrosoftConfig] = useState(false);
  const [microsoftConfigured, setMicrosoftConfigured] = useState(false);

  // Magic Link state
  const [magicLinkConfigured, setMagicLinkConfigured] = useState(false);

  // Each provider's identifiers and which secrets are stored; the secrets
  // themselves stay on the server.
  const [configSummaries, setConfigSummaries] = useState<
    Record<string, SsoConfigSummary>
  >({});
  useEffect(() => {
    if (!ssoProviders) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/sso/config-summary");
        if (!response.ok) return;
        const body = (await response.json()) as {
          providers: Record<string, SsoConfigSummary>;
        };
        if (!cancelled) setConfigSummaries(body.providers ?? {});
      } catch (error) {
        console.error("Failed to load SSO configuration:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ssoProviders]);
  const summaryFor = useCallback(
    (type: SsoProviderType) => {
      const provider = ssoProviders?.find((p) => p.type === type);
      return provider ? configSummaries[provider.id] : undefined;
    },
    [ssoProviders, configSummaries]
  );

  // Optimistic toggle state — updates immediately on click, syncs with server data
  const [toggleState, setToggleState] = useState<Record<string, boolean>>({});

  // Column visibility for the Sign-in Providers table (all columns shown).
  const [providerColumnVisibility, setProviderColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  // Email server configuration status
  const [isEmailServerConfigured, setIsEmailServerConfigured] = useState(true);

  // Email verification confirmation dialog state
  const [showEmailVerificationConfirm, setShowEmailVerificationConfirm] =
    useState(false);
  const [isVerifyingAllUsers, setIsVerifyingAllUsers] = useState(false);

  // Check if Google OAuth is configured based on SSO providers data
  useEffect(() => {
    const config = summaryFor(SsoProviderType.GOOGLE);
    setGoogleConfigured(!!(config?.clientId && config.hasClientSecret));
    if (config?.clientId) {
      setGoogleClientId(config.clientId);
    }
  }, [summaryFor]);

  // Check if Apple Sign In is configured based on SSO providers data
  useEffect(() => {
    const config = summaryFor(SsoProviderType.APPLE);
    if (config?.clientId && config.teamId && config.keyId) {
      setAppleClientId(config.clientId);
      setAppleTeamId(config.teamId);
      setAppleKeyId(config.keyId);
      setAppleConfigured(config.hasPrivateKey);
    } else {
      setAppleConfigured(false);
    }
  }, [summaryFor]);

  // Check if Microsoft SSO is configured based on SSO providers data
  useEffect(() => {
    const config = summaryFor(SsoProviderType.MICROSOFT);
    setMicrosoftConfigured(!!(config?.clientId && config.hasClientSecret));
    if (config?.clientId) {
      setMicrosoftClientId(config.clientId);
    }
    if (config?.tenantId) {
      setMicrosoftTenantId(config.tenantId);
    }
  }, [summaryFor]);

  // Check if Magic Link is configured (requires email settings)
  useEffect(() => {
    // Fetch magic link configuration status from server
    const checkMagicLinkConfig = async () => {
      try {
        const response = await fetch("/api/admin/sso/magic-link-status");
        if (response.ok) {
          const data = await response.json();
          setMagicLinkConfigured(data.configured);
          // Email server configuration status is the same as magic link status
          setIsEmailServerConfigured(data.configured);
        }
      } catch (error) {
        console.error("Failed to check Magic Link configuration:", error);
      }
    };

    void checkMagicLinkConfig();
  }, []);

  // Sync optimistic toggle state with server data
  useEffect(() => {
    if (ssoProviders) {
      const serverState: Record<string, boolean> = {};
      for (const p of ssoProviders) {
        serverState[p.type] = p.enabled;
        // SAML rows are per provider, so they key on the provider id — several
        // providers share the SAML type and would otherwise overwrite each other.
        if (p.type === SsoProviderType.SAML) {
          serverState[p.id] = p.enabled;
        }
      }
      setToggleState((prev) => ({ ...prev, ...serverState }));
    }
  }, [ssoProviders]);

  useEffect(() => {
    if (registrationSettings) {
      setToggleState((prev) => ({
        ...prev,
        allowOpenRegistration:
          registrationSettings.allowOpenRegistration ?? true,
      }));
    }
  }, [registrationSettings]);

  // Save Google OAuth configuration using ZenStack hooks
  const saveGoogleConfig = async () => {
    const hasStoredSecret = !!summaryFor(SsoProviderType.GOOGLE)
      ?.hasClientSecret;
    if (!googleClientId || (!googleClientSecret && !hasStoredSecret)) {
      toast.error(t("admin.sso.dialogs.googleOAuth.validation.bothRequired"));
      return;
    }

    setIsSavingGoogleConfig(true);
    try {
      // A blank secret keeps the stored one.
      const config: Record<string, string> = { clientId: googleClientId };
      if (googleClientSecret) config.clientSecret = googleClientSecret;

      const existingProvider = ssoProviders?.find(
        (p) => p.type === SsoProviderType.GOOGLE
      );

      if (existingProvider) {
        // Update existing provider and enable it
        await updateProvider({
          where: { id: existingProvider.id },
          data: { config, enabled: true },
        });
      } else {
        // Create new provider
        await createProvider({
          data: {
            name: "Google OAuth",
            type: SsoProviderType.GOOGLE,
            enabled: true,
            config,
          },
        });
      }

      toast.success(t("admin.sso.messages.googleConfigSaved"));
      setGoogleConfigured(true);
      setIsGoogleConfigOpen(false);
      setGoogleClientSecret(""); // Clear the secret from memory
      void refetch(); // Refresh SSO providers
    } catch (error) {
      console.error("Failed to save Google OAuth config:", error);
      toast.error(t("admin.sso.messages.googleConfigFailed"));
    } finally {
      setIsSavingGoogleConfig(false);
    }
  };

  const openSamlConfig = (providerId: string) => {
    router.push(`/admin/sso/saml/${providerId}`);
  };

  // SsoProvider.name is unique and labels the sign-in button, so a new row
  // needs a free name; the admin renames it on the provider's own page.
  const nextSamlProviderName = () => {
    const taken = new Set((ssoProviders ?? []).map((p) => p.name));
    const base = t("admin.sso.globalSettings.samlProvider.title");
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base} ${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  };

  // Created disabled, so enabling SAML stays a deliberate step after the
  // configuration has actually been filled in.
  const addSamlProvider = async () => {
    setIsOpeningSamlConfig(true);
    try {
      const created = await createProvider({
        data: {
          name: nextSamlProviderName(),
          type: SsoProviderType.SAML,
          enabled: false,
        },
      });

      if (!created?.id) {
        toast.error(t("admin.sso.messages.createFailed"));
        return;
      }

      toast.success(t("admin.sso.messages.samlCreated"));
      router.push(`/admin/sso/saml/${created.id}`);
    } catch (error) {
      console.error("Failed to add SAML provider:", error);
      toast.error(t("admin.sso.messages.createFailed"));
    } finally {
      setIsOpeningSamlConfig(false);
    }
  };

  if (session?.user?.access !== "ADMIN") {
    return (
      <div className="container mx-auto py-10">
        <p>{t("common.errors.permissionDenied")}</p>
      </div>
    );
  }

  const handleToggleGoogle = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, [SsoProviderType.GOOGLE]: enabled }));
    try {
      const existingGoogle = ssoProviders?.find(
        (p) => p.type === SsoProviderType.GOOGLE
      );

      if (enabled && !googleConfigured) {
        toast.warning(t("admin.sso.messages.configureFirst"));
      }

      if (existingGoogle) {
        await updateProvider({
          where: { id: existingGoogle.id },
          data: { enabled },
        });
        toast.success(
          enabled
            ? t("admin.sso.messages.googleEnabled")
            : t("admin.sso.messages.googleDisabled")
        );
      } else {
        await createProvider({
          data: {
            name: "Google OAuth",
            type: SsoProviderType.GOOGLE,
            enabled,
          },
        });
        toast.success(t("admin.sso.messages.googleCreated"));
      }
      void refetch();
    } catch {
      setToggleState((prev) => ({
        ...prev,
        [SsoProviderType.GOOGLE]: !enabled,
      }));
      toast.error(t("admin.sso.messages.googleUpdateFailed"));
    }
  };

  // Save Apple configuration using ZenStack hooks
  const saveAppleConfig = async () => {
    const hasStoredKey = !!summaryFor(SsoProviderType.APPLE)?.hasPrivateKey;
    if (
      !appleClientId ||
      !appleTeamId ||
      !appleKeyId ||
      (!applePrivateKey && !hasStoredKey)
    ) {
      toast.error(t("common.dialogs.complete.apple.validation.allRequired"));
      return;
    }

    setIsSavingAppleConfig(true);
    try {
      // A blank private key keeps the stored one.
      const config: Record<string, string> = {
        clientId: appleClientId,
        teamId: appleTeamId,
        keyId: appleKeyId,
      };
      if (applePrivateKey) config.privateKey = applePrivateKey;

      const existingProvider = ssoProviders?.find(
        (p) => p.type === SsoProviderType.APPLE
      );

      if (existingProvider) {
        // Update existing provider and enable it
        await updateProvider({
          where: { id: existingProvider.id },
          data: { config, enabled: true },
        });
      } else {
        // Create new provider
        await createProvider({
          data: {
            name: "Apple Sign In",
            type: SsoProviderType.APPLE,
            enabled: true,
            config,
          },
        });
      }

      toast.success(t("admin.sso.messages.appleConfigSaved"));
      setAppleConfigured(true);
      setIsAppleConfigOpen(false);
      setApplePrivateKey(""); // Clear the private key from memory
      void refetch(); // Refresh SSO providers
    } catch (error) {
      console.error("Failed to save Apple config:", error);
      toast.error(t("admin.sso.messages.appleConfigFailed"));
    } finally {
      setIsSavingAppleConfig(false);
    }
  };

  const handleToggleApple = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, [SsoProviderType.APPLE]: enabled }));
    try {
      const existingApple = ssoProviders?.find(
        (p) => p.type === SsoProviderType.APPLE
      );

      if (enabled && !appleConfigured) {
        toast.warning(t("admin.sso.messages.configureFirst"));
      }

      if (existingApple) {
        await updateProvider({
          where: { id: existingApple.id },
          data: { enabled },
        });
        toast.success(
          enabled
            ? t("admin.sso.messages.appleEnabled")
            : t("admin.sso.messages.appleDisabled")
        );
      } else {
        await createProvider({
          data: {
            name: "Apple Sign In",
            type: SsoProviderType.APPLE,
            enabled,
          },
        });
        toast.success(t("admin.sso.messages.appleCreated"));
      }
      void refetch();
    } catch {
      setToggleState((prev) => ({
        ...prev,
        [SsoProviderType.APPLE]: !enabled,
      }));
      toast.error(t("admin.sso.messages.appleUpdateFailed"));
    }
  };

  // Save Microsoft configuration using ZenStack hooks
  const saveMicrosoftConfig = async () => {
    const hasStoredSecret = !!summaryFor(SsoProviderType.MICROSOFT)
      ?.hasClientSecret;
    if (!microsoftClientId || (!microsoftClientSecret && !hasStoredSecret)) {
      toast.error(t("admin.sso.dialogs.microsoft.validation.bothRequired"));
      return;
    }

    setIsSavingMicrosoftConfig(true);
    try {
      // A blank secret keeps the stored one; a cleared tenant falls back to
      // the default.
      const config: Record<string, string> = {
        clientId: microsoftClientId,
        tenantId: microsoftTenantId,
      };
      if (microsoftClientSecret) config.clientSecret = microsoftClientSecret;

      const existingProvider = ssoProviders?.find(
        (p) => p.type === SsoProviderType.MICROSOFT
      );

      if (existingProvider) {
        await updateProvider({
          where: { id: existingProvider.id },
          data: { config, enabled: true },
        });
      } else {
        await createProvider({
          data: {
            name: "Microsoft SSO",
            type: SsoProviderType.MICROSOFT,
            enabled: true,
            config,
          },
        });
      }

      toast.success(t("admin.sso.messages.microsoftConfigSaved"));
      setMicrosoftConfigured(true);
      setIsMicrosoftConfigOpen(false);
      setMicrosoftClientSecret(""); // Clear the secret from memory
      void refetch();
    } catch (error) {
      console.error("Failed to save Microsoft config:", error);
      toast.error(t("admin.sso.messages.microsoftConfigFailed"));
    } finally {
      setIsSavingMicrosoftConfig(false);
    }
  };

  const handleToggleMicrosoft = async (enabled: boolean) => {
    setToggleState((prev) => ({
      ...prev,
      [SsoProviderType.MICROSOFT]: enabled,
    }));
    try {
      const existingMicrosoft = ssoProviders?.find(
        (p) => p.type === SsoProviderType.MICROSOFT
      );

      if (enabled && !microsoftConfigured) {
        toast.warning(t("admin.sso.messages.configureFirst"));
      }

      if (existingMicrosoft) {
        await updateProvider({
          where: { id: existingMicrosoft.id },
          data: { enabled },
        });
        toast.success(
          enabled
            ? t("admin.sso.messages.microsoftEnabled")
            : t("admin.sso.messages.microsoftDisabled")
        );
      } else {
        await createProvider({
          data: {
            name: "Microsoft SSO",
            type: SsoProviderType.MICROSOFT,
            enabled,
          },
        });
        toast.success(t("admin.sso.messages.microsoftCreated"));
      }
      void refetch();
    } catch {
      setToggleState((prev) => ({
        ...prev,
        [SsoProviderType.MICROSOFT]: !enabled,
      }));
      toast.error(t("admin.sso.messages.microsoftUpdateFailed"));
    }
  };

  const handleToggleMagicLink = async (enabled: boolean) => {
    setToggleState((prev) => ({
      ...prev,
      [SsoProviderType.MAGIC_LINK]: enabled,
    }));
    try {
      const existingMagicLink = ssoProviders?.find(
        (p) => p.type === SsoProviderType.MAGIC_LINK
      );

      if (enabled && !magicLinkConfigured) {
        toast.warning(t("admin.sso.messages.configureFirst"));
      }

      if (existingMagicLink) {
        await updateProvider({
          where: { id: existingMagicLink.id },
          data: { enabled },
        });
        toast.success(
          enabled
            ? t("admin.sso.messages.magicLinkEnabled")
            : t("admin.sso.messages.magicLinkDisabled")
        );
      } else {
        await createProvider({
          data: {
            name: "Magic Link",
            type: SsoProviderType.MAGIC_LINK,
            enabled,
          },
        });
        toast.success(t("admin.sso.messages.magicLinkCreated"));
      }
      void refetch();
    } catch {
      setToggleState((prev) => ({
        ...prev,
        [SsoProviderType.MAGIC_LINK]: !enabled,
      }));
      toast.error(t("admin.sso.messages.magicLinkUpdateFailed"));
    }
  };

  const handleToggleSamlProvider = async (
    providerId: string,
    configured: boolean,
    enabled: boolean
  ) => {
    setToggleState((prev) => ({ ...prev, [providerId]: enabled }));
    try {
      if (enabled && !configured) {
        toast.warning(t("admin.sso.messages.configureFirst"));
      }

      await updateProvider({
        where: { id: providerId },
        data: { enabled },
      });
      toast.success(
        enabled
          ? t("admin.sso.messages.enabled")
          : t("admin.sso.messages.disabled")
      );
      void refetch();
    } catch {
      setToggleState((prev) => ({ ...prev, [providerId]: !enabled }));
      toast.error(t("admin.sso.messages.updateFailed"));
    }
  };

  const deleteSamlProvider = async () => {
    if (!samlProviderToDelete) return;
    setIsDeletingSamlProvider(true);
    try {
      // Deleting the provider cascades to its SamlConfiguration.
      await deleteProvider({ where: { id: samlProviderToDelete.id } });
      toast.success(t("admin.sso.messages.deleted"));
      setSamlProviderToDelete(null);
      void refetch();
    } catch {
      toast.error(t("admin.sso.messages.deleteFailed"));
    } finally {
      setIsDeletingSamlProvider(false);
    }
  };

  const handleToggleAllowOpenRegistration = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, allowOpenRegistration: enabled }));
    try {
      await upsertSettings({
        where: {
          id: registrationSettings?.id ?? "default-registration-settings",
        },
        create: {
          id: "default-registration-settings",
          allowOpenRegistration: enabled,
        },
        update: { allowOpenRegistration: enabled },
      });
      toast.success(
        enabled
          ? t("admin.sso.messages.openRegistrationEnabled")
          : t("admin.sso.messages.openRegistrationDisabled")
      );
      void refetchSettings();
    } catch {
      setToggleState((prev) => ({ ...prev, allowOpenRegistration: !enabled }));
      toast.error(t("admin.sso.messages.openRegistrationUpdateFailed"));
    }
  };

  const handleToggleDomainRestriction = async (enabled: boolean) => {
    try {
      await upsertSettings({
        where: {
          id: registrationSettings?.id ?? "default-registration-settings",
        },
        create: {
          id: "default-registration-settings",
          restrictEmailDomains: enabled,
        },
        update: { restrictEmailDomains: enabled },
      });
      toast.success(
        enabled
          ? t("admin.sso.messages.domainRestrictionEnabled")
          : t("admin.sso.messages.domainRestrictionDisabled")
      );
      void refetchSettings();
    } catch {
      toast.error(t("admin.sso.messages.domainRestrictionUpdateFailed"));
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain) {
      toast.error(t("admin.sso.messages.domainRequired"));
      return;
    }

    // Basic domain validation
    const domainRegex =
      /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?(\.[a-zA-Z]{2,})+$/;
    if (!domainRegex.test(newDomain)) {
      toast.error(t("admin.sso.messages.invalidDomain"));
      return;
    }

    setIsAddingDomain(true);
    try {
      await createDomain({
        data: {
          domain: newDomain.toLowerCase(),
          enabled: true,
          createdBy: session?.user?.id,
        },
      });
      toast.success(t("admin.sso.messages.domainAdded"));
      setNewDomain("");
      void refetchDomains();
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        toast.error(t("admin.sso.messages.domainExists"));
      } else {
        toast.error(t("admin.sso.messages.domainAddFailed"));
      }
    } finally {
      setIsAddingDomain(false);
    }
  };

  const handleToggleDomain = async (domainId: string, enabled: boolean) => {
    try {
      await updateDomain({
        where: { id: domainId },
        data: { enabled },
      });
      toast.success(
        enabled
          ? t("admin.sso.messages.domainEnabled")
          : t("admin.sso.messages.domainDisabled")
      );
      void refetchDomains();
    } catch {
      toast.error(t("admin.sso.messages.domainUpdateFailed"));
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    try {
      await deleteDomain({
        where: { id: domainId },
      });
      toast.success(t("admin.sso.messages.domainDeleted"));
      void refetchDomains();
    } catch {
      toast.error(t("admin.sso.messages.domainDeleteFailed"));
    }
  };

  const handleDefaultAccessChange = async (value: Access) => {
    try {
      await upsertSettings({
        where: {
          id: registrationSettings?.id ?? "default-registration-settings",
        },
        create: { id: "default-registration-settings", defaultAccess: value },
        update: { defaultAccess: value },
      });
      void refetchSettings();
      toast.success(t("admin.sso.messages.defaultAccessUpdated"));
    } catch {
      toast.error(t("admin.sso.messages.defaultAccessUpdateFailed"));
    }
  };

  const handleToggleRequireEmailVerification = async (enabled: boolean) => {
    // Prevent enabling email verification when no email server is configured
    if (enabled && !isEmailServerConfigured) {
      toast.error(t("admin.sso.messages.emailServerNotConfigured"));
      return;
    }

    // If disabling email verification, show confirmation dialog
    if (!enabled && (registrationSettings?.requireEmailVerification ?? true)) {
      setShowEmailVerificationConfirm(true);
      return;
    }

    // If enabling, proceed directly
    try {
      await upsertSettings({
        where: {
          id: registrationSettings?.id ?? "default-registration-settings",
        },
        create: {
          id: "default-registration-settings",
          requireEmailVerification: enabled,
        },
        update: { requireEmailVerification: enabled },
      });
      toast.success(t("admin.sso.messages.emailVerificationEnabled"));
      void refetchSettings();
    } catch {
      toast.error(t("admin.sso.messages.emailVerificationUpdateFailed"));
    }
  };

  const confirmDisableEmailVerification = async () => {
    setIsVerifyingAllUsers(true);
    try {
      // First, verify all existing users
      const response = await fetch("/api/admin/users/verify-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("Failed to verify all users");
      }

      const result = await response.json();

      // Then, update the setting
      await upsertSettings({
        where: {
          id: registrationSettings?.id ?? "default-registration-settings",
        },
        create: {
          id: "default-registration-settings",
          requireEmailVerification: false,
        },
        update: { requireEmailVerification: false },
      });

      toast.success(
        t("admin.sso.messages.emailVerificationDisabledAndVerified", {
          count: result.verifiedCount || 0,
        })
      );
      void refetchSettings();
      setShowEmailVerificationConfirm(false);
    } catch (error) {
      console.error("Error disabling email verification:", error);
      toast.error(t("admin.sso.messages.emailVerificationUpdateFailed"));
    } finally {
      setIsVerifyingAllUsers(false);
    }
  };

  const _googleProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.GOOGLE
  );
  // Sorted by name to match the order the sign-in page renders them in.
  const samlProviders = (ssoProviders ?? [])
    .filter((p) => p.type === SsoProviderType.SAML)
    .sort((a, b) => a.name.localeCompare(b.name));
  const _appleProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.APPLE
  );
  const _microsoftProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.MICROSOFT
  );
  const _magicLinkProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.MAGIC_LINK
  );
  // globalForceSso is now tracked in toggleState

  const signInProviders: SignInProviderRow[] = [
    {
      id: SsoProviderType.GOOGLE,
      name: t("admin.sso.globalSettings.googleOAuth.title"),
      configured: googleConfigured,
      enabled: toggleState[SsoProviderType.GOOGLE] || false,
      onToggle: handleToggleGoogle,
      onConfigure: () => setIsGoogleConfigOpen(true),
    },
    {
      id: SsoProviderType.APPLE,
      name: t("admin.sso.globalSettings.apple.title"),
      configured: appleConfigured,
      enabled: toggleState[SsoProviderType.APPLE] || false,
      onToggle: handleToggleApple,
      onConfigure: () => setIsAppleConfigOpen(true),
    },
    {
      id: SsoProviderType.MICROSOFT,
      name: t("admin.sso.globalSettings.microsoft.title"),
      configured: microsoftConfigured,
      enabled: toggleState[SsoProviderType.MICROSOFT] || false,
      onToggle: handleToggleMicrosoft,
      onConfigure: () => setIsMicrosoftConfigOpen(true),
    },
    // One row per SAML provider: the sign-in page, the SP-initiated login and
    // the IdP-initiated callback all resolve per provider, so admin does too.
    ...samlProviders.map((provider) => {
      const config = provider.samlConfig;
      const configured = !!(config?.entryPoint && config.issuer && config.cert);
      return {
        id: provider.id,
        name: provider.name,
        configured,
        enabled: toggleState[provider.id] ?? provider.enabled,
        onToggle: (enabled: boolean) =>
          handleToggleSamlProvider(provider.id, configured, enabled),
        onConfigure: () => openSamlConfig(provider.id),
        onDelete: () =>
          setSamlProviderToDelete({ id: provider.id, name: provider.name }),
        typeLabel: t("admin.sso.sections.providers.samlBadge"),
      };
    }),
    {
      id: SsoProviderType.MAGIC_LINK,
      name: t("admin.sso.globalSettings.magicLink.title"),
      configured: magicLinkConfigured,
      enabled: toggleState[SsoProviderType.MAGIC_LINK] || false,
      onToggle: handleToggleMagicLink,
      onConfigure: null,
    },
  ];

  const providerColumns: ColumnDef<SignInProviderRow>[] = [
    {
      id: "provider",
      accessorKey: "name",
      header: t("common.fields.provider"),
      enableSorting: false,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 520,
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.typeLabel ? (
            <Badge variant="outline">{row.original.typeLabel}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "configured",
      accessorKey: "configured",
      header: t("admin.sso.status.configured"),
      enableSorting: false,
      size: 140,
      cell: ({ row }) => (
        <Badge variant={row.original.configured ? "default" : "secondary"}>
          {row.original.configured
            ? t("admin.sso.status.configured")
            : t("admin.llm.notConfigured")}
        </Badge>
      ),
    },
    {
      id: "enabled",
      accessorKey: "enabled",
      header: t("common.fields.enabled"),
      enableSorting: false,
      size: 100,
      cell: ({ row }) => (
        <Switch
          aria-label={row.original.name}
          checked={row.original.enabled}
          onCheckedChange={row.original.onToggle}
        />
      ),
    },
    {
      id: "actions",
      header: t("common.actions.actionsLabel"),
      enableSorting: false,
      enableHiding: false,
      meta: { isPinned: "right" },
      size: 180,
      cell: ({ row }) =>
        row.original.onConfigure || row.original.onDelete ? (
          <div className="flex justify-between gap-1">
            {row.original.onConfigure ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={row.original.onConfigure}
                className="h-6 px-2 text-xs"
              >
                <Settings className="h-3 w-3" />
                {t("admin.integrations.table.configure")}
              </Button>
            ) : null}
            {row.original.onDelete ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${t("common.actions.delete")} ${row.original.name}`}
                onClick={row.original.onDelete}
                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                {t("common.actions.delete")}
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="pt-4">
        <PageTitle
          as="h1"
          data-testid="sso-page-title"
          className="flex items-center gap-2 text-primary"
        >
          <span>{t("admin.menu.sso")}</span>
          <HelpPopover helpKey="sso" />
        </PageTitle>
      </div>

      {/* Sign-in Providers Card */}
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{t("admin.sso.sections.providers.title")}</CardTitle>
              <HelpPopover helpKey="ssoProviders" />
            </SectionHeader>
            <Button
              onClick={addSamlProvider}
              disabled={isOpeningSamlConfig}
              aria-label={t("admin.sso.sections.providers.addSaml")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
              data-testid="add-saml-provider-button"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {t("admin.sso.sections.providers.addSaml")}
              </span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={providerColumns}
            data={signInProviders}
            columnVisibility={providerColumnVisibility}
            onColumnVisibilityChange={setProviderColumnVisibility}
          />
        </CardContent>
      </Card>

      {/* Registration Settings Card */}
      <Card>
        <CardHeader>
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{t("admin.sso.registration.title")}</CardTitle>
            <HelpPopover helpKey="ssoRegistration" />
          </SectionHeader>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Allow Open Registration */}
          <div className="flex items-center gap-2">
            <Switch
              id="sso-allow-registration"
              checked={toggleState.allowOpenRegistration ?? true}
              onCheckedChange={handleToggleAllowOpenRegistration}
              className="mt-0.5"
            />
            <div className="flex flex-1 items-center gap-2">
              <Label
                htmlFor="sso-allow-registration"
                className="cursor-pointer"
              >
                {t("admin.sso.registration.allowOpenRegistration.title")}
              </Label>
              <HelpPopover helpKey="ssoAllowRegistration" />
            </div>
          </div>

          {/* Default Access Level Setting */}
          <div className="ps-11 space-y-2">
            <div className="flex items-center gap-2">
              <Label>{t("admin.sso.registration.defaultAccess.title")}</Label>
              <HelpPopover helpKey="ssoDefaultAccess" />
            </div>
            <Select
              value={registrationSettings?.defaultAccess || "NONE"}
              onValueChange={(value) =>
                handleDefaultAccessChange(value as Access)
              }
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="NONE">
                    {t("common.access.none")}
                  </SelectItem>
                  <SelectItem value="USER">
                    {t("common.access.user")}
                  </SelectItem>
                  <SelectItem value="PROJECTADMIN">
                    {t("common.access.projectAdmin")}
                  </SelectItem>
                  <SelectItem value="ADMIN">
                    {t("common.access.admin")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Email Verification Requirement */}
          <div className="flex items-center gap-2">
            <Switch
              id="sso-require-email-verification"
              checked={
                isEmailServerConfigured &&
                (registrationSettings?.requireEmailVerification ?? true)
              }
              onCheckedChange={handleToggleRequireEmailVerification}
              disabled={!isEmailServerConfigured}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="sso-require-email-verification"
                  className="cursor-pointer"
                >
                  {t("admin.sso.registration.requireEmailVerification.title")}
                </Label>
                <HelpPopover helpKey="ssoRequireEmailVerification" />
              </div>
              {!isEmailServerConfigured && (
                <p className="text-sm text-destructive mt-2">
                  {t(
                    "admin.sso.registration.requireEmailVerification.noEmailServerWarning"
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="sso-restrict-domains"
              checked={registrationSettings?.restrictEmailDomains || false}
              onCheckedChange={handleToggleDomainRestriction}
              className="mt-0.5"
            />
            <div className="flex flex-1 items-center gap-2">
              <Label htmlFor="sso-restrict-domains" className="cursor-pointer">
                {t("admin.sso.registration.restrictDomains.title")}
              </Label>
              <HelpPopover helpKey="ssoRestrictDomains" />
            </div>
          </div>

          {registrationSettings?.restrictEmailDomains && (
            <div className="space-y-4">
              <div className="border rounded-lg p-4">
                <Label className="mb-4 block">
                  {t("admin.sso.registration.allowedDomains.title")}
                </Label>

                {/* Add new domain */}
                <div className="flex gap-2 mb-4">
                  <Input
                    placeholder={t("common.placeholders.domainExample")}
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddDomain();
                      }
                    }}
                  />
                  <Button
                    onClick={handleAddDomain}
                    disabled={isAddingDomain || !newDomain}
                    size="sm"
                  >
                    <Plus className="h-4 w-4" />
                    {t("admin.sso.registration.allowedDomains.add")}
                  </Button>
                </div>

                {/* List of allowed domains */}
                {allowedDomains && allowedDomains.length > 0 ? (
                  <div className="space-y-2">
                    {allowedDomains.map((domain) => (
                      <div
                        key={domain.id}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              domain.enabled
                                ? ""
                                : "line-through text-muted-foreground"
                            }
                          >
                            {domain.domain}
                          </span>
                          {!domain.enabled && (
                            <Badge variant="secondary">
                              {t("common.status.disabled")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={domain.enabled}
                            onCheckedChange={(enabled) =>
                              handleToggleDomain(domain.id, enabled)
                            }
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteDomain(domain.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("admin.sso.registration.allowedDomains.empty")}
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Google OAuth Configuration Dialog */}
      <Dialog open={isGoogleConfigOpen} onOpenChange={setIsGoogleConfigOpen}>
        <DialogContent className="sm:max-w-[600]">
          <DialogHeader>
            <DialogTitle>
              {t("admin.sso.dialogs.googleOAuth.title")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.sso.dialogs.googleOAuth.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="clientId">
                {t("admin.integrations.config.clientId")}
              </Label>
              <Input
                id="clientId"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                placeholder={t(
                  "admin.sso.dialogs.googleOAuth.clientIdPlaceholder"
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clientSecret">
                {t("admin.integrations.config.clientSecret")}
              </Label>
              <Input
                id="clientSecret"
                type="password"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder={
                  summaryFor(SsoProviderType.GOOGLE)?.hasClientSecret
                    ? t("admin.integrations.config.leaveBlankToKeep")
                    : t("admin.sso.dialogs.googleOAuth.clientSecretPlaceholder")
                }
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{t("admin.sso.dialogs.googleOAuth.instructions.title")}</p>
              <ol className="list-decimal ms-4 space-y-1">
                <li>{t("admin.sso.dialogs.googleOAuth.instructions.step1")}</li>
                <li>{t("admin.sso.dialogs.googleOAuth.instructions.step2")}</li>
                <li>{t("admin.sso.dialogs.googleOAuth.instructions.step3")}</li>
                <li>{t("admin.sso.dialogs.googleOAuth.instructions.step4")}</li>
                <li>
                  {t("admin.sso.dialogs.googleOAuth.instructions.step5")}{" "}
                  <code className="bg-muted px-1 rounded">
                    {typeof window !== "undefined"
                      ? window.location.origin
                      : ""}
                    {t("admin.sso.dialogs.googleOAuth.redirectUri")}
                  </code>
                </li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsGoogleConfigOpen(false);
                setGoogleClientSecret("");
              }}
              disabled={isSavingGoogleConfig}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveGoogleConfig}
              disabled={
                isSavingGoogleConfig ||
                !googleClientId ||
                (!googleClientSecret &&
                  !summaryFor(SsoProviderType.GOOGLE)?.hasClientSecret)
              }
            >
              {isSavingGoogleConfig
                ? t("common.actions.saving")
                : t("admin.imports.testmo.mappingSaveConfiguration")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apple Configuration Dialog */}
      <Dialog open={isAppleConfigOpen} onOpenChange={setIsAppleConfigOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {t("common.dialogs.complete.apple.title")}
            </DialogTitle>
            <DialogDescription>
              {t("common.dialogs.complete.apple.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="appleClientId">
                {t("common.dialogs.complete.apple.clientId")}
              </Label>
              <Input
                id="appleClientId"
                value={appleClientId}
                onChange={(e) => setAppleClientId(e.target.value)}
                placeholder={t(
                  "common.dialogs.complete.apple.clientIdPlaceholder"
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="appleTeamId">
                {t("common.dialogs.complete.apple.teamId")}
              </Label>
              <Input
                id="appleTeamId"
                value={appleTeamId}
                onChange={(e) => setAppleTeamId(e.target.value)}
                placeholder={t(
                  "common.dialogs.complete.apple.teamIdPlaceholder"
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="appleKeyId">
                {t("common.dialogs.complete.apple.keyId")}
              </Label>
              <Input
                id="appleKeyId"
                value={appleKeyId}
                onChange={(e) => setAppleKeyId(e.target.value)}
                placeholder={t(
                  "common.dialogs.complete.apple.keyIdPlaceholder"
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="applePrivateKey">
                {t("common.dialogs.complete.apple.privateKey")}
              </Label>
              <textarea
                id="applePrivateKey"
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={applePrivateKey}
                onChange={(e) => setApplePrivateKey(e.target.value)}
                placeholder={
                  summaryFor(SsoProviderType.APPLE)?.hasPrivateKey
                    ? t("admin.integrations.config.leaveBlankToKeep")
                    : t("common.dialogs.complete.apple.privateKeyPlaceholder")
                }
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{t("common.dialogs.complete.apple.instructions.title")}</p>
              <ol className="list-decimal ms-4 space-y-1">
                <li>{t("common.dialogs.complete.apple.instructions.step1")}</li>
                <li>{t("common.dialogs.complete.apple.instructions.step2")}</li>
                <li>{t("common.dialogs.complete.apple.instructions.step3")}</li>
                <li>{t("common.dialogs.complete.apple.instructions.step4")}</li>
                <li>
                  {t("common.dialogs.complete.apple.instructions.step5")}{" "}
                  <code className="bg-muted px-1 rounded">
                    {typeof window !== "undefined"
                      ? window.location.origin
                      : ""}
                    {t("common.dialogs.complete.apple.redirectUri")}
                  </code>
                </li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAppleConfigOpen(false);
                setApplePrivateKey("");
              }}
              disabled={isSavingAppleConfig}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveAppleConfig}
              disabled={
                isSavingAppleConfig ||
                !appleClientId ||
                !appleTeamId ||
                !appleKeyId ||
                (!applePrivateKey &&
                  !summaryFor(SsoProviderType.APPLE)?.hasPrivateKey)
              }
            >
              {isSavingAppleConfig
                ? t("common.actions.saving")
                : t("admin.imports.testmo.mappingSaveConfiguration")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Microsoft Configuration Dialog */}
      <Dialog
        open={isMicrosoftConfigOpen}
        onOpenChange={setIsMicrosoftConfigOpen}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t("admin.sso.dialogs.microsoft.title")}</DialogTitle>
            <DialogDescription>
              {t("admin.sso.dialogs.microsoft.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="microsoftClientId">
                {t("admin.integrations.config.clientId")}
              </Label>
              <Input
                id="microsoftClientId"
                value={microsoftClientId}
                onChange={(e) => setMicrosoftClientId(e.target.value)}
                placeholder={t(
                  "admin.sso.dialogs.microsoft.clientIdPlaceholder"
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="microsoftClientSecret">
                {t("admin.integrations.config.clientSecret")}
              </Label>
              <Input
                id="microsoftClientSecret"
                type="password"
                value={microsoftClientSecret}
                onChange={(e) => setMicrosoftClientSecret(e.target.value)}
                placeholder={
                  summaryFor(SsoProviderType.MICROSOFT)?.hasClientSecret
                    ? t("admin.integrations.config.leaveBlankToKeep")
                    : t("admin.sso.dialogs.microsoft.clientSecretPlaceholder")
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="microsoftTenantId">
                {t("admin.sso.dialogs.microsoft.tenantId")}
              </Label>
              <Input
                id="microsoftTenantId"
                value={microsoftTenantId}
                onChange={(e) => setMicrosoftTenantId(e.target.value)}
                placeholder={t(
                  "admin.sso.dialogs.microsoft.tenantIdPlaceholder"
                )}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.sso.dialogs.microsoft.tenantIdHint")}
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{t("admin.sso.dialogs.microsoft.instructions.title")}</p>
              <ol className="list-decimal ms-4 space-y-1">
                <li>{t("admin.sso.dialogs.microsoft.instructions.step1")}</li>
                <li>{t("admin.sso.dialogs.microsoft.instructions.step2")}</li>
                <li>{t("admin.sso.dialogs.microsoft.instructions.step3")}</li>
                <li>{t("admin.sso.dialogs.microsoft.instructions.step4")}</li>
                <li>
                  {t("admin.sso.dialogs.microsoft.instructions.step5")}{" "}
                  <code className="bg-muted px-1 rounded">
                    {typeof window !== "undefined"
                      ? window.location.origin
                      : ""}
                    {t("admin.sso.dialogs.microsoft.redirectUri")}
                  </code>
                </li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsMicrosoftConfigOpen(false);
                setMicrosoftClientSecret("");
              }}
              disabled={isSavingMicrosoftConfig}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveMicrosoftConfig}
              disabled={
                isSavingMicrosoftConfig ||
                !microsoftClientId ||
                (!microsoftClientSecret &&
                  !summaryFor(SsoProviderType.MICROSOFT)?.hasClientSecret)
              }
            >
              {isSavingMicrosoftConfig
                ? t("common.actions.saving")
                : t("admin.imports.testmo.mappingSaveConfiguration")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SAML Provider Delete Confirmation Dialog */}
      <Dialog
        open={!!samlProviderToDelete}
        onOpenChange={(open) => {
          if (!open) setSamlProviderToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {t("common.dialogs.delete.title", {
                item: t("admin.sso.globalSettings.samlProvider.title"),
              })}
            </DialogTitle>
            <DialogDescription>
              {t("common.dialogs.delete.description", {
                name: samlProviderToDelete?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-destructive">
              {t("common.dialogs.delete.warning", {
                item: t("admin.sso.globalSettings.samlProvider.title"),
              })}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSamlProviderToDelete(null)}
              disabled={isDeletingSamlProvider}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={deleteSamlProvider}
              disabled={isDeletingSamlProvider}
              data-testid="confirm-delete-saml-provider"
            >
              {t("common.actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Verification Disable Confirmation Dialog */}
      <Dialog
        open={showEmailVerificationConfirm}
        onOpenChange={setShowEmailVerificationConfirm}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {t("admin.sso.dialogs.disableEmailVerification.title")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.sso.dialogs.disableEmailVerification.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted border border-border rounded-lg p-4">
              <p className="text-sm text-destructive font-semibold mb-2">
                {t("admin.sso.dialogs.disableEmailVerification.warning")}
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>
                  {t(
                    "admin.sso.dialogs.disableEmailVerification.warningPoint1"
                  )}
                </li>
                <li>
                  {t(
                    "admin.sso.dialogs.disableEmailVerification.warningPoint2"
                  )}
                </li>
              </ul>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("admin.sso.dialogs.disableEmailVerification.confirmation")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEmailVerificationConfirm(false)}
              disabled={isVerifyingAllUsers}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDisableEmailVerification}
              disabled={isVerifyingAllUsers}
            >
              {isVerifyingAllUsers
                ? t("admin.sso.dialogs.disableEmailVerification.verifying")
                : t("admin.sso.dialogs.disableEmailVerification.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
