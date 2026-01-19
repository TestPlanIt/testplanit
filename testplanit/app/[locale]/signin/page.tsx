"use client";

import { useState, useEffect } from "react";
import type { NextPage } from "next";
import { signIn } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { useFindManySsoProvider } from "~/lib/hooks";
import { SsoProviderType } from "@prisma/client";

import Image from "next/image";
import { Link } from "~/lib/navigation";
import svgIcon from "~/public/tpi_logo.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LinkIcon, Loader2, Shield, Mail } from "lucide-react";
import { HelpPopover } from "@/components/ui/help-popover";
import { siGoogle, siApple } from "simple-icons";

const GoogleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d={siGoogle.path} />
  </svg>
);

const AppleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d={siApple.path} />
  </svg>
);

/**
 * Manually clear NextAuth session cookies via document.cookie
 * This is more reliable than signOut() when the session is corrupted
 * because signOut() itself makes API calls that can fail with 410
 */
function clearSessionCookies() {
  const cookieNames = [
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
    "next-auth.csrf-token",
    "__Host-next-auth.csrf-token",
    "next-auth.callback-url",
    "__Secure-next-auth.callback-url",
  ];

  for (const name of cookieNames) {
    // Clear for all possible paths
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
  }
}

const Signin: NextPage = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submissionError, setSubmissionError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState<string | null>(null);
  const [showDelayedLoader, setShowDelayedLoader] = useState(false);
  const [showMagicLinkInput, setShowMagicLinkInput] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = useState("");
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [sessionCleared, setSessionCleared] = useState(false);
  // 2FA state
  const [show2FAInput, setShow2FAInput] = useState(false);
  const [pendingAuthToken, setPendingAuthToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [is2FALoading, setIs2FALoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const t = useTranslations();
  const tCommon = useTranslations("common");

  // Clear any stale session cookies on page load to prevent 410 errors
  // This must happen before any authenticated API calls are made
  // We use direct cookie manipulation instead of signOut() because signOut()
  // itself makes API calls that can fail with a corrupted session
  useEffect(() => {
    clearSessionCookies();
    setSessionCleared(true);
  }, []);

  // Fetch admin contact email (wait for session to be cleared first)
  useEffect(() => {
    if (!sessionCleared) return;
    fetch("/api/admin-contact")
      .then((res) => res.json())
      .then((data) => setAdminEmail(data.email))
      .catch(() => setAdminEmail(null));
  }, [sessionCleared]);

  // Check for error query parameter
  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "AccessDenied") {
      setSubmissionError(t("auth.errors.accessDenied"));
    } else if (error === "Configuration") {
      setSubmissionError(t("auth.errors.configuration"));
    } else if (error === "Verification") {
      setSubmissionError(t("auth.errors.verification"));
    } else if (error) {
      // Generic error fallback
      setSubmissionError(t("common.errors.invalidCredentials"));
    }
  }, [searchParams, t]);

  // Fetch ALL SSO providers (we need all to check forceSso)
  // Sort by name at the database level to help with SAML providers
  // Wait for session to be cleared before fetching to prevent 410 errors with stale sessions
  const { data: ssoProviders, isLoading: isLoadingSsoProviders } =
    useFindManySsoProvider(
      {
        include: { samlConfig: true },
        orderBy: { name: "asc" },
      },
      {
        enabled: sessionCleared,
      }
    );

  // Filter for configured providers only and sort by priority
  const configuredProviders =
    ssoProviders
      ?.filter((provider) => {
        if (provider.type === SsoProviderType.GOOGLE) {
          // Google OAuth credentials are configured via the admin UI
          return provider.enabled;
        }
        if (provider.type === SsoProviderType.SAML) {
          return provider.enabled && provider.samlConfig;
        }
        if (provider.type === SsoProviderType.APPLE) {
          // Apple Sign In credentials are configured via the admin UI
          return provider.enabled;
        }
        if (provider.type === SsoProviderType.MAGIC_LINK) {
          // Magic Link requires email server configuration
          return provider.enabled;
        }
        return false;
      })
      .sort((a, b) => {
        // Define sort order: Google, Apple, SAML providers, then Magic Link last
        const typeOrder = {
          [SsoProviderType.GOOGLE]: 1,
          [SsoProviderType.APPLE]: 2,
          [SsoProviderType.SAML]: 3,
          [SsoProviderType.MAGIC_LINK]: 4,
        };

        const orderA = typeOrder[a.type] || 999;
        const orderB = typeOrder[b.type] || 999;

        // Sort by type order (name is already sorted by database)
        return orderA - orderB;
      }) || [];

  // Check if force SSO is enabled (same logic as admin page)
  const forceSsoEnabled =
    ssoProviders?.some((provider) => provider.forceSso) || false;

  // Delayed loading state to prevent loader flash
  // Show loader after 500ms if we're still loading SSO providers or waiting for session to clear
  const isStillLoading = !sessionCleared || isLoadingSsoProviders;
  useEffect(() => {
    if (isStillLoading) {
      const timer = setTimeout(() => {
        setShowDelayedLoader(true);
      }, 500);

      return () => {
        clearTimeout(timer);
        setShowDelayedLoader(false);
      };
    } else {
      setShowDelayedLoader(false);
    }
  }, [isStillLoading]);

  const FormSchema = z.object({
    email: z
      .string()
      .email({ message: t("common.errors.emailInvalid") })
      .min(1, { message: t("common.errors.emailRequired") }),
    password: z.string().min(4, t("common.errors.passwordRequired")),
  });

  const MagicLinkFormSchema = z.object({
    email: z.string().email({ message: t("common.errors.emailInvalid") }),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const magicLinkForm = useForm<z.infer<typeof MagicLinkFormSchema>>({
    resolver: zodResolver(MagicLinkFormSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsLoading(true);
    setSubmissionError("");
    // Clear any existing session cookies first to ensure clean state
    clearSessionCookies();

    const result = await signIn("credentials", {
      redirect: false,
      email: data.email,
      password: data.password,
    });

    if (result?.ok) {
      // Get user preferences from session
      const response = await fetch("/api/auth/session");
      const session = await response.json();

      // Set language cookie if user has a locale preference
      if (session?.user?.preferences?.locale) {
        const urlLocale = session.user.preferences.locale.replace("_", "-");
        document.cookie = `NEXT_LOCALE=${urlLocale};path=/;max-age=31536000`;
      }

      // Redirect to callback URL if present, otherwise home
      const callbackUrl = searchParams.get("callbackUrl") || "/";
      router.push(callbackUrl);
    } else if (result?.error?.startsWith("2FA_REQUIRED:")) {
      // Extract pending auth token and show 2FA input
      const token = result.error.replace("2FA_REQUIRED:", "");
      setPendingAuthToken(token);
      setShow2FAInput(true);
      setIsLoading(false);
    } else if (result?.error?.startsWith("2FA_SETUP_REQUIRED:")) {
      // 2FA is required by system but user hasn't set it up - redirect to setup page
      const token = result.error.replace("2FA_SETUP_REQUIRED:", "");
      router.push(`/auth/two-factor-setup?token=${encodeURIComponent(token)}`);
    } else {
      setSubmissionError(t("common.errors.invalidCredentials"));
      setIsLoading(false);
    }
  }

  async function handle2FASubmit() {
    if (!pendingAuthToken || !twoFactorCode) return;

    setIs2FALoading(true);
    setSubmissionError("");

    const result = await signIn("credentials", {
      redirect: false,
      pendingAuthToken,
      twoFactorToken: twoFactorCode,
    });

    if (result?.ok) {
      // Get user preferences from session
      const response = await fetch("/api/auth/session");
      const session = await response.json();

      // Set language cookie if user has a locale preference
      if (session?.user?.preferences?.locale) {
        const urlLocale = session.user.preferences.locale.replace("_", "-");
        document.cookie = `NEXT_LOCALE=${urlLocale};path=/;max-age=31536000`;
      }

      // Redirect to callback URL if present, otherwise home
      const callbackUrl = searchParams.get("callbackUrl") || "/";
      router.push(callbackUrl);
    } else {
      setSubmissionError(
        t("auth.errors.invalid2FACode") || "Invalid verification code"
      );
      setIs2FALoading(false);
    }
  }

  function cancel2FA() {
    setShow2FAInput(false);
    setPendingAuthToken(null);
    setTwoFactorCode("");
    setSubmissionError("");
  }

  async function handleSsoSignIn(provider: any) {
    if (provider.type === SsoProviderType.MAGIC_LINK) {
      // Show Magic Link email input
      setShowMagicLinkInput(true);
      return;
    }

    setIsSsoLoading(provider.id);
    try {
      // Clear any existing session cookies first to ensure clean state
      clearSessionCookies();
      // Small delay to ensure cookies are fully cleared before making API calls
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get callback URL from search params, default to "/"
      const callbackUrl = searchParams.get("callbackUrl") || "/";

      if (provider.type === SsoProviderType.GOOGLE) {
        await signIn("google", { callbackUrl });
      } else if (provider.type === SsoProviderType.APPLE) {
        await signIn("apple", { callbackUrl });
      } else if (provider.type === SsoProviderType.SAML) {
        // Redirect to SAML login endpoint
        window.location.href = `/api/auth/saml/login/${provider.id}`;
      }
    } catch (error) {
      console.error("SSO sign-in error:", error);
      setIsSsoLoading(null);
    }
  }

  async function handleSendMagicLink(
    data: z.infer<typeof MagicLinkFormSchema>
  ) {
    setIsSendingMagicLink(true);
    try {
      // Clear any existing session cookies first to ensure clean state
      clearSessionCookies();
      // Small delay to ensure cookies are fully cleared before making API calls
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get callback URL from search params, default to "/"
      const callbackUrl = searchParams.get("callbackUrl") || "/";

      const result = await signIn("email", {
        email: data.email,
        redirect: false,
        callbackUrl,
      });

      // Always show success message regardless of result
      // This prevents email enumeration attacks
      setMagicLinkSent(true);
      setMagicLinkEmail(data.email);
    } catch (error) {
      console.error("Magic Link error:", error);
      // Still show success message even on error to prevent enumeration
      setMagicLinkSent(true);
      setMagicLinkEmail(data.email);
    } finally {
      setIsSendingMagicLink(false);
    }
  }

  return (
    <div className="flex items-center justify-center">
      <Card className="w-3/4">
        <CardHeader className="w-full flex flex-col items-center justify-center">
          <div className="flex items-center py-5">
            <Image
              alt="TestPlanIt Logo"
              src={svgIcon}
              style={{
                width: "50px",
                height: "auto",
              }}
              priority={true}
            />
            <div className="ml-3 flex flex-col">
              <span className="scroll-m-20 text-4xl font-semibold tracking-tight lg:text-5xl text-[rgb(133,89,233)]">
                {tCommon("branding.name")}
              </span>
              <span className="text-xs text-muted-foreground -mt-1 no-wrap">
                {tCommon("branding.tagline")}
              </span>
            </div>
          </div>
          <CardTitle className="flex py-5 scroll-m-20 tracking-tight lg:text-3xl text-primary">
            {t("common.actions.signIn")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center">
          {/* Show error message prominently at the top */}
          {submissionError && (
            <div className="w-1/2 mb-4 p-3 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive text-center">
                {submissionError}
              </p>
            </div>
          )}
          {(!sessionCleared || isLoadingSsoProviders) && showDelayedLoader ? (
            <div className="w-1/2 space-y-6 flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-muted-foreground text-center">
                {tCommon("loading")}
              </p>
            </div>
          ) : !sessionCleared || isLoadingSsoProviders ? (
            // Show nothing during the 500ms delay
            <div className="w-1/2 space-y-6 flex flex-col items-center justify-center py-8">
              {/* Invisible placeholder to prevent layout shift */}
            </div>
          ) : !forceSsoEnabled ? (
            <Form {...form}>
              <form
                className="w-1/2 space-y-6"
                onSubmit={form.handleSubmit(onSubmit)}
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.email")}
                        <HelpPopover helpKey="user.email" tabIndex={4} />
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("common.placeholders.email")}
                          data-testid="email-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.password")}
                        <HelpPopover helpKey="user.password" tabIndex={5} />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          data-testid="password-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-col items-start justify-center">
                  <Button
                    type="submit"
                    data-testid="signin-button"
                    disabled={isLoading}
                  >
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isLoading ? tCommon("loading") : tCommon("actions.signIn")}
                  </Button>
                </div>

                {/* SSO Options */}
                {configuredProviders.length > 0 && (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          {t("common.or")}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 min-w-fit">
                      {configuredProviders.map((provider) => (
                        <Button
                          key={provider.id}
                          type="button"
                          variant="outline"
                          className="w-full shrink-0"
                          onClick={() => handleSsoSignIn(provider)}
                          disabled={isSsoLoading === provider.id}
                        >
                          {isSsoLoading === provider.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : provider.type === SsoProviderType.GOOGLE ? (
                            <GoogleIcon className="h-4 w-4" />
                          ) : provider.type === SsoProviderType.APPLE ? (
                            <AppleIcon className="h-4 w-4" />
                          ) : provider.type === SsoProviderType.MAGIC_LINK ? (
                            <Mail className="h-4 w-4" />
                          ) : (
                            <Shield className="h-4 w-4" />
                          )}
                          {isSsoLoading === provider.id
                            ? tCommon("loading")
                            : provider.type === SsoProviderType.GOOGLE
                              ? t("auth.signin.sso.googleOAuth")
                              : provider.type === SsoProviderType.APPLE
                                ? t("auth.signin.sso.apple")
                                : provider.type === SsoProviderType.MAGIC_LINK
                                  ? t("auth.signin.sso.magicLink")
                                  : t("auth.signin.sso.samlProvider", {
                                      name: provider.name,
                                    })}
                        </Button>
                      ))}
                    </div>
                  </>
                )}

                <div className="text-center text-sm">
                  {t("common.or")}{" "}
                  <Link href="/signup" className="group underline">
                    {t("auth.signin.createAccount")}
                    <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                </div>
              </form>
            </Form>
          ) : (
            <div className="w-1/2 space-y-6">
              {configuredProviders.length > 0 && (
                <div className="space-y-2">
                  {configuredProviders.map((provider) => (
                    <Button
                      key={provider.id}
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => handleSsoSignIn(provider)}
                      disabled={isSsoLoading === provider.id}
                    >
                      {isSsoLoading === provider.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : provider.type === SsoProviderType.GOOGLE ? (
                        <GoogleIcon className="h-4 w-4" />
                      ) : provider.type === SsoProviderType.APPLE ? (
                        <AppleIcon className="h-4 w-4" />
                      ) : provider.type === SsoProviderType.MAGIC_LINK ? (
                        <Mail className="h-4 w-4" />
                      ) : (
                        <Shield className="h-4 w-4" />
                      )}
                      {isSsoLoading === provider.id
                        ? tCommon("loading")
                        : provider.type === SsoProviderType.GOOGLE
                          ? t("auth.signin.sso.googleOAuth")
                          : provider.type === SsoProviderType.APPLE
                            ? t("auth.signin.sso.apple")
                            : provider.type === SsoProviderType.MAGIC_LINK
                              ? t("auth.signin.sso.magicLink")
                              : t("auth.signin.sso.samlProvider", {
                                  name: provider.name,
                                })}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Trouble signing in message */}
          {sessionCleared && !isLoadingSsoProviders && (
            <div className="w-full mt-6 text-center text-sm text-muted-foreground">
              {t("auth.signin.troubleSigningIn")}{" "}
              {adminEmail ? (
                <a
                  href={`mailto:${adminEmail}`}
                  className="underline hover:text-primary"
                >
                  {t("auth.signin.contactAdmin")}
                </a>
              ) : (
                <span>{t("auth.signin.contactAdmin")}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Magic Link Email Input Dialog */}
      <Dialog
        open={showMagicLinkInput}
        onOpenChange={(open) => {
          setShowMagicLinkInput(open);
          if (!open) {
            magicLinkForm.reset();
            setMagicLinkEmail("");
            setMagicLinkSent(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t("auth.signin.sso.magicLink")}</DialogTitle>
            <DialogDescription>
              {t("auth.signin.magicLink.description")}
            </DialogDescription>
          </DialogHeader>

          {!magicLinkSent ? (
            <Form {...magicLinkForm}>
              <form
                onSubmit={magicLinkForm.handleSubmit(handleSendMagicLink)}
                className="space-y-4"
              >
                <FormField
                  control={magicLinkForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.fields.email")}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder={t(
                            "auth.signin.magicLink.emailPlaceholder"
                          )}
                          disabled={isSendingMagicLink}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowMagicLinkInput(false);
                      magicLinkForm.reset();
                    }}
                    disabled={isSendingMagicLink}
                  >
                    {t("auth.signin.magicLink.backToSignIn")}
                  </Button>
                  <Button type="submit" disabled={isSendingMagicLink}>
                    {isSendingMagicLink ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("auth.signin.magicLink.sending")}
                      </>
                    ) : (
                      t("auth.signin.magicLink.sendLink")
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          ) : (
            <>
              <div className="py-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <Mail className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">
                  {t("auth.signin.magicLink.checkEmail")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("auth.signin.magicLink.success", {
                    email: magicLinkEmail,
                  })}
                </p>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setShowMagicLinkInput(false);
                    magicLinkForm.reset();
                    setMagicLinkEmail("");
                    setMagicLinkSent(false);
                  }}
                  className="w-full"
                >
                  {t("common.actions.close")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 2FA Verification Dialog */}
      <Dialog open={show2FAInput} onOpenChange={(open) => !open && cancel2FA()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t("auth.signin.twoFactor.title")}
            </DialogTitle>
            <DialogDescription>
              {t("auth.signin.twoFactor.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {submissionError && (
              <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
                <p className="text-sm text-destructive text-center">
                  {submissionError}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {useBackupCode
                  ? t("auth.twoFactorVerify.backupCodeLabel")
                  : t("auth.twoFactorSetup.verifyLabel")}
              </label>
              {useBackupCode ? (
                <Input
                  type="text"
                  placeholder="XXXXXXXX"
                  value={twoFactorCode}
                  onChange={(e) =>
                    setTwoFactorCode(e.target.value.toUpperCase().slice(0, 8))
                  }
                  className="text-center text-lg tracking-widest font-mono"
                  autoComplete="one-time-code"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && twoFactorCode.length === 8) {
                      handle2FASubmit();
                    }
                  }}
                />
              ) : (
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={twoFactorCode}
                    onChange={(value) => setTwoFactorCode(value)}
                    onComplete={() => handle2FASubmit()}
                    autoFocus
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setUseBackupCode(!useBackupCode);
                  setTwoFactorCode("");
                }}
                className="text-xs text-primary hover:underline w-full text-center"
              >
                {useBackupCode
                  ? t("auth.twoFactorVerify.useAuthenticator")
                  : t("auth.twoFactorVerify.useBackupCode")}
              </button>
            </div>
          </div>

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={cancel2FA}
              disabled={is2FALoading}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={handle2FASubmit}
              disabled={
                is2FALoading || twoFactorCode.length < (useBackupCode ? 8 : 6)
              }
            >
              {is2FALoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tCommon("loading")}
                </>
              ) : (
                tCommon("actions.verify")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Signin;
