"use client";

import { useState, useEffect } from "react";
import type { NextPage } from "next";
import { signIn } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import {
  useCreateUser,
  useFindManySsoProvider,
  useFindFirstRegistrationSettings,
} from "~/lib/hooks";
import {
  generateEmailVerificationToken,
  resendVerificationEmail,
} from "@/components/EmailVerifications";
import { createUserRegistrationNotification } from "~/app/actions/notifications";
import { notFound } from "next/navigation";
import { isEmailDomainAllowed } from "~/app/actions/auth";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Link } from "~/lib/navigation";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import svgIcon from "~/public/tpi_logo.svg";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
  CardTitle,
} from "@/components/ui/card";
import { LinkIcon, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

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

const Signup: NextPage = () => {
  const { mutateAsync: signup } = useCreateUser();
  const [submissionError, setSubmissionError] = useState("");
  const [sessionCleared, setSessionCleared] = useState(false);
  const router = useRouter();
  const t = useTranslations();
  const tCommon = useTranslations("common");

  // Clear any stale session cookies on page load to prevent 410 errors
  // We use direct cookie manipulation instead of signOut() because signOut()
  // itself makes API calls that can fail with a corrupted session
  useEffect(() => {
    clearSessionCookies();
    setSessionCleared(true);
  }, []);

  // Check if Force SSO is enabled - if so, redirect to 404
  // Wait for session to be cleared before fetching to prevent 410 errors with stale sessions
  const { data: ssoProviders, isLoading: isLoadingSsoProviders } =
    useFindManySsoProvider(
      {
        include: { samlConfig: true },
      },
      {
        enabled: sessionCleared,
      }
    );

  // Fetch registration settings to get the default access level for new users
  const { data: registrationSettings } = useFindFirstRegistrationSettings(
    undefined,
    {
      enabled: sessionCleared,
    }
  );

  const forceSsoEnabled =
    ssoProviders?.some((provider) => provider.forceSso) || false;

  // Track if we're still loading (session clearing or SSO providers)
  const isStillLoading = !sessionCleared || isLoadingSsoProviders;

  // Delayed loading state to prevent loader flash on fast connections
  const [showDelayedLoader, setShowDelayedLoader] = useState(false);
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

  useEffect(() => {
    if (forceSsoEnabled) {
      notFound();
    }
  }, [forceSsoEnabled]);

  const FormSchema = z
    .object({
      name: z.string().min(2, {
        message: t("common.fields.validation.nameRequired"),
      }),
      email: z
        .email()
        .min(1, { message: t("auth.signup.errors.emailRequired") }),
      password: z.string().min(4, t("auth.signup.errors.passwordRequired")),
      confirmPassword: z
        .string()
        .min(4, t("auth.signup.errors.confirmPasswordRequired")),
    })
    .superRefine(({ confirmPassword, password }, ctx) => {
      if (confirmPassword !== password) {
        ctx.issues.push({
          code: "custom",
          message: t("auth.signup.errors.passwordsDoNotMatch"),
          path: ["confirmPassword"],
          input: "",
        });
      }
    });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    // Check email domain restriction
    const isDomainAllowed = await isEmailDomainAllowed(data.email);
    if (!isDomainAllowed) {
      setSubmissionError(t("auth.signup.errors.domainRestricted"));
      return;
    }

    let newUser;
    try {
      newUser = await signup({
        data: {
          name: data.name,
          email: data.email,
          password: data.password,
          emailVerifToken: await generateEmailVerificationToken(),
          // Apply the configured default access level from registration settings
          // Falls back to NONE if no settings exist (matches schema default)
          access: registrationSettings?.defaultAccess || "NONE",
          userPreferences: {
            create: {
              itemsPerPage: "P10",
              dateFormat: "MM_DD_YYYY_DASH",
              timeFormat: "HH_MM_A",
              theme: "Light",
              locale: "en_US",
            },
          },
        },
      });
      await resendVerificationEmail(data.email);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        setSubmissionError(t("common.errors.emailExists"));
      } else {
        setSubmissionError(t("common.errors.unknown"));
      }
      return;
    }

    // Notify system administrators about the new user registration
    if (newUser) {
      try {
        await createUserRegistrationNotification(
          data.name,
          data.email,
          newUser.id,
          "form"
        );
      } catch (error) {
        console.error("Failed to send user registration notifications:", error);
        // Don't fail the signup process if notifications fail
      }
    }

    // signin to create a session
    await signIn("credentials", {
      redirect: false,
      name: data.name,
      email: data.email,
      password: data.password,
    });
    router.push("/");
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
            {t("common.actions.signUp")}
          </CardTitle>
          <CardDescription>{t("auth.signup.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center">
          {isStillLoading && showDelayedLoader ? (
            <div className="w-1/2 space-y-6 flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-muted-foreground text-center">
                {t("common.loading")}
              </p>
            </div>
          ) : isStillLoading ? (
            // Show nothing during the 500ms delay to prevent flash
            <div className="w-1/2 space-y-6 flex flex-col items-center justify-center py-8">
              {/* Invisible placeholder to prevent layout shift */}
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="w-1/2 space-y-6"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.name")}
                        <HelpPopover helpKey="user.name" />
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.email")}
                        <HelpPopover helpKey="user.email" />
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
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.password")}
                        <HelpPopover helpKey="user.password" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} type="password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.confirmPassword")}
                        <HelpPopover helpKey="user.confirmPassword" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} type="password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit">{t("common.actions.signUp")}</Button>
                {submissionError && (
                  <div className="text-destructive">{submissionError}</div>
                )}
                <div>
                  {t("common.or")}{" "}
                  <Link href="/signin" className="group">
                    {t("auth.signup.signIn")}
                    <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Signup;
