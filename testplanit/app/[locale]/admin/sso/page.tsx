"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription, DialogFooter, DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Access, SsoProviderType } from "@prisma/client";
import {
  Edit, KeyRound, Mail, Plus, Settings, Shield, ShieldUser, X
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useCreateAllowedEmailDomain, useCreateSsoProvider, useDeleteAllowedEmailDomain,
  useFindFirstRegistrationSettings, useFindManyAllowedEmailDomain, useFindManySsoProvider, useUpdateAllowedEmailDomain, useUpdateSsoProvider, useUpsertRegistrationSettings
} from "~/lib/hooks";

export default function SSOAdminPage() {
  const { data: session } = useSession();
  const t = useTranslations();

  const { data: ssoProviders, refetch } = useFindManySsoProvider({
    include: { samlConfig: true },
  });
  const { mutateAsync: createProvider } = useCreateSsoProvider();
  const { mutateAsync: updateProvider } = useUpdateSsoProvider();

  // Domain restriction hooks
  const { data: allowedDomains, refetch: refetchDomains } =
    useFindManyAllowedEmailDomain({
      orderBy: { domain: "asc" },
    });
  const { mutateAsync: createDomain } = useCreateAllowedEmailDomain();
  const { mutateAsync: updateDomain } = useUpdateAllowedEmailDomain();
  const { mutateAsync: deleteDomain } = useDeleteAllowedEmailDomain();

  // Registration settings hooks
  const { data: registrationSettings, refetch: refetchSettings } =
    useFindFirstRegistrationSettings();
  const { mutateAsync: upsertSettings } = useUpsertRegistrationSettings();

  // Google OAuth configuration state
  const [isGoogleConfigOpen, setIsGoogleConfigOpen] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [isSavingGoogleConfig, setIsSavingGoogleConfig] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);

  // SAML configuration state
  const [isSamlConfigOpen, setIsSamlConfigOpen] = useState(false);
  const [samlEntryPoint, setSamlEntryPoint] = useState("");
  const [samlIssuer, setSamlIssuer] = useState("");
  const [samlCert, setSamlCert] = useState("");
  const [samlCallbackUrl, setSamlCallbackUrl] = useState("");
  const [samlLogoutUrl, setSamlLogoutUrl] = useState("");
  const [isSavingSamlConfig, setIsSavingSamlConfig] = useState(false);
  const [samlConfigured, setSamlConfigured] = useState(false);

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

  // Optimistic toggle state — updates immediately on click, syncs with server data
  const [toggleState, setToggleState] = useState<Record<string, boolean>>({});

  // Email server configuration status
  const [isEmailServerConfigured, setIsEmailServerConfigured] = useState(true);

  // Email verification confirmation dialog state
  const [showEmailVerificationConfirm, setShowEmailVerificationConfirm] =
    useState(false);
  const [isVerifyingAllUsers, setIsVerifyingAllUsers] = useState(false);

  // Check if Google OAuth is configured based on SSO providers data
  useEffect(() => {
    const googleProvider = ssoProviders?.find(
      (p) => p.type === SsoProviderType.GOOGLE
    );

    if (googleProvider?.config) {
      const config = googleProvider.config as any;
      setGoogleConfigured(!!(config.clientId && config.clientSecret));
      if (config.clientId) {
        setGoogleClientId(config.clientId);
      }
    } else {
      setGoogleConfigured(false);
    }
  }, [ssoProviders]);

  // Check if SAML is configured based on SSO providers data
  useEffect(() => {
    const samlProvider = ssoProviders?.find(
      (p) => p.type === SsoProviderType.SAML
    );

    if (samlProvider?.samlConfig) {
      const config = samlProvider.samlConfig;
      setSamlConfigured(!!(config.entryPoint && config.issuer && config.cert));
      setSamlEntryPoint(config.entryPoint || "");
      setSamlIssuer(config.issuer || "");
      setSamlCert(config.cert || "");
      setSamlCallbackUrl(config.callbackUrl || "");
      setSamlLogoutUrl(config.logoutUrl || "");
    } else {
      setSamlConfigured(false);
    }
  }, [ssoProviders]);

  // Check if Apple Sign In is configured based on SSO providers data
  useEffect(() => {
    const appleProvider = ssoProviders?.find(
      (p) => p.type === SsoProviderType.APPLE
    );

    if (appleProvider?.config) {
      const config = appleProvider.config as any;
      // Check if actual configuration values exist
      if (config.clientId && config.teamId && config.keyId) {
        setAppleClientId(config.clientId);
        setAppleTeamId(config.teamId);
        setAppleKeyId(config.keyId);
        setApplePrivateKey(config.privateKey || "");
        setAppleConfigured(true);
      } else {
        setAppleConfigured(false);
      }
    } else {
      setAppleConfigured(false);
    }
  }, [ssoProviders]);

  // Check if Microsoft SSO is configured based on SSO providers data
  useEffect(() => {
    const microsoftProvider = ssoProviders?.find(
      (p) => p.type === SsoProviderType.MICROSOFT
    );

    if (microsoftProvider?.config) {
      const config = microsoftProvider.config as any;
      setMicrosoftConfigured(!!(config.clientId && config.clientSecret));
      if (config.clientId) {
        setMicrosoftClientId(config.clientId);
      }
      if (config.tenantId) {
        setMicrosoftTenantId(config.tenantId);
      }
    } else {
      setMicrosoftConfigured(false);
    }
  }, [ssoProviders]);

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

    checkMagicLinkConfig();
  }, []);

  // Sync optimistic toggle state with server data
  useEffect(() => {
    if (ssoProviders) {
      const serverState: Record<string, boolean> = {};
      for (const p of ssoProviders) {
        serverState[p.type] = p.enabled;
      }
      serverState.forceSso =
        ssoProviders.some((p) => p.forceSso) || false;
      setToggleState((prev) => ({ ...prev, ...serverState }));
    }
  }, [ssoProviders]);

  useEffect(() => {
    if (registrationSettings) {
      setToggleState((prev) => ({
        ...prev,
        force2FANonSSO: registrationSettings.force2FANonSSO || false,
        force2FAAllLogins: registrationSettings.force2FAAllLogins || false,
      }));
    }
  }, [registrationSettings]);

  // Save Google OAuth configuration using ZenStack hooks
  const saveGoogleConfig = async () => {
    if (!googleClientId || !googleClientSecret) {
      toast.error(t("admin.sso.dialogs.googleOAuth.validation.bothRequired"));
      return;
    }

    setIsSavingGoogleConfig(true);
    try {
      const config = {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      };

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
      refetch(); // Refresh SSO providers
    } catch (error) {
      console.error("Failed to save Google OAuth config:", error);
      toast.error(t("admin.sso.messages.googleConfigFailed"));
    } finally {
      setIsSavingGoogleConfig(false);
    }
  };

  // Save SAML configuration using ZenStack hooks
  const saveSamlConfig = async () => {
    if (!samlEntryPoint || !samlIssuer || !samlCert || !samlCallbackUrl) {
      toast.error(t("admin.sso.dialogs.saml.validation.allRequired"));
      return;
    }

    setIsSavingSamlConfig(true);
    try {
      const samlConfig = {
        entryPoint: samlEntryPoint,
        issuer: samlIssuer,
        cert: samlCert,
        callbackUrl: samlCallbackUrl,
        logoutUrl: samlLogoutUrl || undefined,
        attributeMapping: {},
        autoProvisionUsers: false,
        defaultAccess: "USER" as const,
      };

      const existingProvider = ssoProviders?.find(
        (p) => p.type === SsoProviderType.SAML
      );

      if (existingProvider) {
        // Update existing provider and enable it
        await updateProvider({
          where: { id: existingProvider.id },
          data: {
            enabled: true,
            samlConfig: { upsert: { create: samlConfig, update: samlConfig } },
          },
        });
      } else {
        // Create new provider
        await createProvider({
          data: {
            name: "SAML Provider",
            type: SsoProviderType.SAML,
            enabled: true,
            samlConfig: { create: samlConfig },
          },
        });
      }

      toast.success(t("admin.sso.messages.samlConfigSaved"));
      setSamlConfigured(true);
      setIsSamlConfigOpen(false);
      refetch(); // Refresh SSO providers
    } catch (error) {
      console.error("Failed to save SAML config:", error);
      toast.error(t("admin.sso.messages.googleConfigFailed"));
    } finally {
      setIsSavingSamlConfig(false);
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
      refetch();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, [SsoProviderType.GOOGLE]: !enabled }));
      toast.error(t("admin.sso.messages.googleUpdateFailed"));
    }
  };

  // Save Apple configuration using ZenStack hooks
  const saveAppleConfig = async () => {
    if (!appleClientId || !appleTeamId || !appleKeyId || !applePrivateKey) {
      toast.error(t("common.dialogs.complete.apple.validation.allRequired"));
      return;
    }

    setIsSavingAppleConfig(true);
    try {
      const config = {
        clientId: appleClientId,
        teamId: appleTeamId,
        keyId: appleKeyId,
        privateKey: applePrivateKey,
      };

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
      refetch(); // Refresh SSO providers
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
      refetch();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, [SsoProviderType.APPLE]: !enabled }));
      toast.error(t("admin.sso.messages.appleUpdateFailed"));
    }
  };

  // Save Microsoft configuration using ZenStack hooks
  const saveMicrosoftConfig = async () => {
    if (!microsoftClientId || !microsoftClientSecret) {
      toast.error(t("admin.sso.dialogs.microsoft.validation.bothRequired"));
      return;
    }

    setIsSavingMicrosoftConfig(true);
    try {
      const config: Record<string, string> = {
        clientId: microsoftClientId,
        clientSecret: microsoftClientSecret,
      };
      if (microsoftTenantId) {
        config.tenantId = microsoftTenantId;
      }

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
      refetch();
    } catch (error) {
      console.error("Failed to save Microsoft config:", error);
      toast.error(t("admin.sso.messages.microsoftConfigFailed"));
    } finally {
      setIsSavingMicrosoftConfig(false);
    }
  };

  const handleToggleMicrosoft = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, [SsoProviderType.MICROSOFT]: enabled }));
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
      refetch();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, [SsoProviderType.MICROSOFT]: !enabled }));
      toast.error(t("admin.sso.messages.microsoftUpdateFailed"));
    }
  };

  const handleToggleMagicLink = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, [SsoProviderType.MAGIC_LINK]: enabled }));
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
      refetch();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, [SsoProviderType.MAGIC_LINK]: !enabled }));
      toast.error(t("admin.sso.messages.magicLinkUpdateFailed"));
    }
  };

  const handleToggleSAML = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, [SsoProviderType.SAML]: enabled }));
    try {
      const existingSaml = ssoProviders?.find(
        (p) => p.type === SsoProviderType.SAML
      );

      if (enabled && !samlConfigured) {
        toast.warning(t("admin.sso.messages.configureFirst"));
      }

      if (existingSaml) {
        await updateProvider({
          where: { id: existingSaml.id },
          data: { enabled },
        });
        toast.success(
          enabled
            ? t("admin.sso.messages.enabled")
            : t("admin.sso.messages.disabled")
        );
      } else {
        await createProvider({
          data: {
            name: "SAML Provider",
            type: SsoProviderType.SAML,
            enabled,
          },
        });
        toast.success(
          enabled
            ? t("admin.sso.messages.samlCreated")
            : t("admin.sso.messages.samlCreated")
        );
      }
      refetch();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, [SsoProviderType.SAML]: !enabled }));
      toast.error(t("admin.sso.messages.updateFailed"));
    }
  };

  const handleToggleForceSso = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, forceSso: enabled }));
    try {
      const updates =
        ssoProviders?.map((provider) =>
          updateProvider({
            where: { id: provider.id },
            data: { forceSso: enabled },
          })
        ) || [];

      await Promise.all(updates);
      toast.success(
        enabled
          ? t("admin.sso.messages.forceSsoEnabled")
          : t("admin.sso.messages.forceSsoDisabled")
      );
      refetch();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, forceSso: !enabled }));
      toast.error(t("admin.sso.messages.forceSsoUpdateFailed"));
    }
  };

  const handleToggleForce2FANonSSO = async (enabled: boolean) => {
    setToggleState((prev) => ({ ...prev, force2FANonSSO: enabled }));
    try {
      await upsertSettings({
        where: {
          id: registrationSettings?.id ?? "default-registration-settings",
        },
        create: {
          id: "default-registration-settings",
          force2FANonSSO: enabled,
        },
        update: { force2FANonSSO: enabled },
      });
      toast.success(
        enabled
          ? t("admin.sso.messages.force2FANonSSOEnabled")
          : t("admin.sso.messages.force2FANonSSODisabled")
      );
      refetchSettings();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, force2FANonSSO: !enabled }));
      toast.error(t("admin.sso.messages.force2FAUpdateFailed"));
    }
  };

  const handleToggleForce2FAAllLogins = async (enabled: boolean) => {
    setToggleState((prev) => ({
      ...prev,
      force2FAAllLogins: enabled,
      ...(enabled ? { force2FANonSSO: true } : {}),
    }));
    try {
      const updates: { force2FAAllLogins: boolean; force2FANonSSO?: boolean } =
        {
          force2FAAllLogins: enabled,
        };
      if (enabled) {
        updates.force2FANonSSO = true;
      }

      await upsertSettings({
        where: {
          id: registrationSettings?.id ?? "default-registration-settings",
        },
        create: { id: "default-registration-settings", ...updates },
        update: updates,
      });
      toast.success(
        enabled
          ? t("admin.sso.messages.force2FAAllLoginsEnabled")
          : t("admin.sso.messages.force2FAAllLoginsDisabled")
      );
      refetchSettings();
    } catch (error) {
      setToggleState((prev) => ({ ...prev, force2FAAllLogins: !enabled }));
      toast.error(t("admin.sso.messages.force2FAUpdateFailed"));
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
      refetchSettings();
    } catch (error) {
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
      refetchDomains();
    } catch (error: any) {
      if (error.info?.code === "P2002") {
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
      refetchDomains();
    } catch (error) {
      toast.error(t("admin.sso.messages.domainUpdateFailed"));
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    try {
      await deleteDomain({
        where: { id: domainId },
      });
      toast.success(t("admin.sso.messages.domainDeleted"));
      refetchDomains();
    } catch (error) {
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
      refetchSettings();
      toast.success(t("admin.sso.messages.defaultAccessUpdated"));
    } catch (error) {
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
      refetchSettings();
    } catch (error) {
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
      refetchSettings();
      setShowEmailVerificationConfirm(false);
    } catch (error) {
      console.error("Error disabling email verification:", error);
      toast.error(t("admin.sso.messages.emailVerificationUpdateFailed"));
    } finally {
      setIsVerifyingAllUsers(false);
    }
  };

  const googleProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.GOOGLE
  );
  const samlProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.SAML
  );
  const appleProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.APPLE
  );
  const microsoftProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.MICROSOFT
  );
  const magicLinkProvider = ssoProviders?.find(
    (p) => p.type === SsoProviderType.MAGIC_LINK
  );
  // globalForceSso is now tracked in toggleState

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="pt-4">
        <h1
          data-testid="sso-page-title"
          className="flex items-center text-primary text-2xl md:text-4xl font-bold"
        >
          <ShieldUser className="inline mr-2 h-8 w-8" />
          <span>{t("admin.menu.sso")}</span>
        </h1>
        <p
          data-testid="sso-page-description"
          className="text-muted-foreground mt-1"
        >
          {t("admin.sso.description")}
        </p>
      </div>

      {/* Sign-in Providers Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <KeyRound className="inline mr-2 h-6 w-6" />
            <span>{t("admin.sso.sections.providers.title")}</span>
          </CardTitle>
          <CardDescription>
            {t("admin.sso.sections.providers.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.googleOAuth.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.globalSettings.googleOAuth.description")}
              </p>
              {googleConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="default">
                    {t("admin.sso.status.configured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsGoogleConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Edit className="h-3 w-3" />
                    {t("admin.integrations.editIntegration")}
                  </Button>
                </div>
              )}
              {!googleConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary">
                    {t("admin.llm.notConfigured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsGoogleConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Settings className="h-3 w-3" />
                    {t("admin.sso.status.setup")}
                  </Button>
                </div>
              )}
            </div>
            <Switch
              checked={toggleState[SsoProviderType.GOOGLE] || false}
              onCheckedChange={handleToggleGoogle}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.apple.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.globalSettings.apple.description")}
              </p>
              {appleConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="default">
                    {t("admin.sso.status.configured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAppleConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Edit className="h-3 w-3" />
                    {t("admin.integrations.table.configure")}
                  </Button>
                </div>
              )}
              {!appleConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary">
                    {t("admin.llm.notConfigured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAppleConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Settings className="h-3 w-3" />
                    {t("admin.sso.status.setup")}
                  </Button>
                </div>
              )}
            </div>
            <Switch
              checked={toggleState[SsoProviderType.APPLE] || false}
              onCheckedChange={handleToggleApple}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.microsoft.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.globalSettings.microsoft.description")}
              </p>
              {microsoftConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="default">
                    {t("admin.sso.status.configured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMicrosoftConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Edit className="h-3 w-3" />
                    {t("admin.integrations.table.configure")}
                  </Button>
                </div>
              )}
              {!microsoftConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary">
                    {t("admin.llm.notConfigured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMicrosoftConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Settings className="h-3 w-3" />
                    {t("admin.sso.status.setup")}
                  </Button>
                </div>
              )}
            </div>
            <Switch
              checked={toggleState[SsoProviderType.MICROSOFT] || false}
              onCheckedChange={handleToggleMicrosoft}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.samlProvider.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.globalSettings.samlProvider.description")}
              </p>
              {samlConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="default">
                    {t("admin.sso.status.configured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsSamlConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Edit className="h-3 w-3" />
                    {t("admin.integrations.table.configure")}
                  </Button>
                </div>
              )}
              {!samlConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary">
                    {t("admin.llm.notConfigured")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsSamlConfigOpen(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <Settings className="h-3 w-3" />
                    {t("admin.sso.status.setup")}
                  </Button>
                </div>
              )}
            </div>
            <Switch
              checked={toggleState[SsoProviderType.SAML] || false}
              onCheckedChange={handleToggleSAML}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.magicLink.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.globalSettings.magicLink.description")}
              </p>
              {magicLinkConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="default">
                    {t("admin.sso.status.configured")}
                  </Badge>
                </div>
              )}
              {!magicLinkConfigured && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary">
                    {t("admin.llm.notConfigured")}
                  </Badge>
                </div>
              )}
            </div>
            <Switch
              checked={toggleState[SsoProviderType.MAGIC_LINK] || false}
              onCheckedChange={handleToggleMagicLink}
            />
          </div>
        </CardContent>
      </Card>

      {/* Security Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Shield className="inline mr-2 h-6 w-6" />
            <span>{t("admin.sso.sections.security.title")}</span>
          </CardTitle>
          <CardDescription>
            {t("admin.sso.sections.security.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.forceSso.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.globalSettings.forceSso.description")}
              </p>
            </div>
            <Switch
              checked={toggleState.forceSso || false}
              onCheckedChange={handleToggleForceSso}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.twoFactor.forceNonSSO.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t(
                  "admin.sso.globalSettings.twoFactor.forceNonSSO.description"
                )}
              </p>
            </div>
            <Switch
              checked={toggleState.force2FANonSSO || false}
              onCheckedChange={handleToggleForce2FANonSSO}
              disabled={toggleState.force2FAAllLogins || false}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">
                {t("admin.sso.globalSettings.twoFactor.forceAllLogins.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t(
                  "admin.sso.globalSettings.twoFactor.forceAllLogins.description"
                )}
              </p>
            </div>
            <Switch
              checked={toggleState.force2FAAllLogins || false}
              onCheckedChange={handleToggleForce2FAAllLogins}
            />
          </div>
        </CardContent>
      </Card>

      {/* Registration Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Mail className="inline mr-2 h-6 w-6" />
            <span>{t("admin.sso.registration.title")}</span>
          </CardTitle>
          <CardDescription>
            {t("admin.sso.registration.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default Access Level Setting */}
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <Label className="text-base font-medium">
                {t("admin.sso.registration.defaultAccess.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.registration.defaultAccess.description")}
              </p>
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
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label className="text-base font-medium">
                {t("admin.sso.registration.requireEmailVerification.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t(
                  "admin.sso.registration.requireEmailVerification.description"
                )}
              </p>
              {!isEmailServerConfigured && (
                <p className="text-sm text-destructive mt-2">
                  {t(
                    "admin.sso.registration.requireEmailVerification.noEmailServerWarning"
                  )}
                </p>
              )}
            </div>
            <Switch
              checked={
                isEmailServerConfigured &&
                (registrationSettings?.requireEmailVerification ?? true)
              }
              onCheckedChange={handleToggleRequireEmailVerification}
              disabled={!isEmailServerConfigured}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">
                {t("admin.sso.registration.restrictDomains.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("admin.sso.registration.restrictDomains.description")}
              </p>
            </div>
            <Switch
              checked={registrationSettings?.restrictEmailDomains || false}
              onCheckedChange={handleToggleDomainRestriction}
            />
          </div>

          {registrationSettings?.restrictEmailDomains && (
            <div className="space-y-4">
              <div className="border rounded-lg p-4">
                <Label className="text-base font-medium mb-4 block">
                  {t("admin.sso.registration.allowedDomains.title")}
                </Label>

                {/* Add new domain */}
                <div className="flex gap-2 mb-4">
                  <Input
                    placeholder={t(
                      "admin.sso.registration.allowedDomains.placeholder"
                    )}
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddDomain();
                      }
                    }}
                  />
                  <Button
                    onClick={handleAddDomain}
                    disabled={isAddingDomain || !newDomain}
                    size="sm"
                  >
                    <Plus className="h-4 w-4 mr-1" />
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
                placeholder={t(
                  "admin.sso.dialogs.googleOAuth.clientSecretPlaceholder"
                )}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{t("admin.sso.dialogs.googleOAuth.instructions.title")}</p>
              <ol className="list-decimal ml-4 space-y-1">
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
                isSavingGoogleConfig || !googleClientId || !googleClientSecret
              }
            >
              {isSavingGoogleConfig
                ? t("common.actions.saving")
                : t("admin.imports.testmo.mappingSaveConfiguration")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SAML Configuration Dialog */}
      <Dialog open={isSamlConfigOpen} onOpenChange={setIsSamlConfigOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t("admin.sso.samlConfiguration.title")}</DialogTitle>
            <DialogDescription>
              {t("admin.sso.dialogs.saml.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="entryPoint">
                {t("admin.sso.dialogs.saml.entryPoint")}
              </Label>
              <Input
                id="entryPoint"
                value={samlEntryPoint}
                onChange={(e) => setSamlEntryPoint(e.target.value)}
                placeholder={t("admin.sso.dialogs.saml.entryPointPlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="issuer">
                {t("admin.sso.dialogs.saml.issuer")}
              </Label>
              <Input
                id="issuer"
                value={samlIssuer}
                onChange={(e) => setSamlIssuer(e.target.value)}
                placeholder={t("admin.sso.dialogs.saml.issuerPlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cert">
                {t("admin.sso.samlConfiguration.samlSettings.certificate")}
              </Label>
              <Input
                id="cert"
                value={samlCert}
                onChange={(e) => setSamlCert(e.target.value)}
                placeholder={t("admin.sso.dialogs.saml.certPlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="callbackUrl">
                {t("admin.sso.dialogs.saml.callbackUrl")}
              </Label>
              <Input
                id="callbackUrl"
                value={samlCallbackUrl}
                onChange={(e) => setSamlCallbackUrl(e.target.value)}
                placeholder={
                  typeof window !== "undefined"
                    ? `${window.location.origin}${t("admin.sso.dialogs.saml.redirectUri")}`
                    : t("admin.sso.dialogs.saml.redirectUri")
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="logoutUrl">
                {t("admin.sso.dialogs.saml.logoutUrl")}
              </Label>
              <Input
                id="logoutUrl"
                value={samlLogoutUrl}
                onChange={(e) => setSamlLogoutUrl(e.target.value)}
                placeholder={t("admin.sso.dialogs.saml.logoutUrlPlaceholder")}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{t("admin.sso.dialogs.saml.instructions.title")}</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>{t("admin.sso.dialogs.saml.instructions.step1")}</li>
                <li>{t("admin.sso.dialogs.saml.instructions.step2")}</li>
                <li>{t("admin.sso.dialogs.saml.instructions.step3")}</li>
                <li>
                  {t("admin.sso.dialogs.saml.instructions.step4")}{" "}
                  <code className="bg-muted px-1 rounded">
                    {typeof window !== "undefined"
                      ? window.location.origin
                      : ""}
                    {t("admin.sso.dialogs.saml.redirectUri")}
                  </code>
                </li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsSamlConfigOpen(false);
                setSamlCert("");
              }}
              disabled={isSavingSamlConfig}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveSamlConfig}
              disabled={
                isSavingSamlConfig ||
                !samlEntryPoint ||
                !samlIssuer ||
                !samlCert ||
                !samlCallbackUrl
              }
            >
              {isSavingSamlConfig
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
                placeholder={t(
                  "common.dialogs.complete.apple.privateKeyPlaceholder"
                )}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{t("common.dialogs.complete.apple.instructions.title")}</p>
              <ol className="list-decimal ml-4 space-y-1">
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
                !applePrivateKey
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
                placeholder={t(
                  "admin.sso.dialogs.microsoft.clientSecretPlaceholder"
                )}
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
              <ol className="list-decimal ml-4 space-y-1">
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
                !microsoftClientSecret
              }
            >
              {isSavingMicrosoftConfig
                ? t("common.actions.saving")
                : t("admin.imports.testmo.mappingSaveConfiguration")}
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
