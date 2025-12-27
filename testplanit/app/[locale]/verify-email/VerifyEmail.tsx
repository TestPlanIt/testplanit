"use client";

import { useEffect, Suspense } from "react";
import { useRouter } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { verifyEmail } from "~/lib/verifyEmail";

import Image from "next/image";
import svgIcon from "~/public/tpi_logo.svg";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { resendVerificationEmail } from "@/components/EmailVerifications";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { HelpPopover } from "@/components/ui/help-popover";

const VerifyEmail = () => {
  const t = useTranslations("auth.verifyEmail");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { data: session } = useSession();

  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");
  const emailParam = searchParams.get("email");

  const FormSchema = z.object({
    token: z.string().min(1, {
      message: tCommon("errors.tokenRequired"),
    }),
    email: z.email().min(1, { message: tCommon("errors.emailRequired") }),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      token: tokenParam || "",
      email: emailParam || "",
    },
  });

  const {
    watch,
    handleSubmit,
    formState: { errors },
  } = form;

  const email = watch("email");

  useEffect(() => {
    if (tokenParam && emailParam) {
      onSubmit({ token: tokenParam, email: emailParam });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tokenParam, emailParam]);

  if (session?.user.emailVerified) {
    router.push("/signin");
    return null;
  }

  async function onResend(email: string) {
    if (email) {
      const result = await resendVerificationEmail(email);
      if (result) {
        toast.success(t("toast.resendSuccess.title"), {
          description: t("toast.resendSuccess.description"),
          position: "bottom-right",
        });
      } else {
        toast.success(t("toast.resendSuccess.title"), {
          description: t("toast.resendSuccess.description"),
          position: "top-center",
        });
      }
    } else {
      toast.error(t("toast.resendError.title"), {
        description: t("toast.resendError.description"),
        position: "top-center",
      });
    }
  }

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    try {
      const result = await verifyEmail(data.email, data.token);
      if (typeof result === "object" && "id" in result) {
        await toast.success(tGlobal("auth.verifyEmail.success"), {
          description: t("toast.verifySuccess.description"),
          position: "top-center",
        });
        router.push("/");
      } else {
        await toast.error(tGlobal("auth.verifyEmail.error"), {
          description: t("toast.verifyError.description"),
          position: "top-center",
        });
      }
    } catch (error) {
      await toast.error(tGlobal("auth.verifyEmail.error"), {
        description: t("toast.verifyError.description"),
        position: "top-center",
      });
    }
  }

  async function onSignout() {
    await signOut({ redirect: true, callbackUrl: "/signin" });
    router.push("/signin");
  }

  return (
    <div className="flex items-center justify-center">
      <Suspense fallback={<div>{t("loading")}</div>}>
        <Card className="w-3/4">
          <CardHeader className="w-full flex flex-col items-center justify-center">
            {}
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
            <CardTitle
              data-testid="verify-email-page-title"
              className="flex py-5 scroll-m-20 tracking-tight lg:text-3xl text-primary"
            >
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center">
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
                        {tCommon("fields.email")}
                        <HelpPopover helpKey="user.email" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tCommon("placeholders.email")}
                          className="resize-none"
                          maxLength={256}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="token"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.token")}
                        <HelpPopover helpKey="user.token" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit">{tCommon("actions.verify")}</Button>
                <div className="flex gap-2 items-baseline">
                  <Button type="button" onClick={onSignout}>
                    {tCommon("actions.signOut")}
                  </Button>
                  <div>
                    {tCommon("or")}
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => onResend(email)}
                    >
                      {tCommon("actions.resend")}
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </Suspense>
    </div>
  );
};

export default VerifyEmail;
