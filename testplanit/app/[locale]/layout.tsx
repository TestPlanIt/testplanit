import { Header } from "@/components/Header";
import { RunGenerationProgressMount } from "@/components/runs/RunGenerationProgressToast";
import { UpgradeNotificationChecker } from "@/components/UpgradeNotificationChecker";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Toaster } from "sonner";
import { NextStepOnboarding } from "~/components/onboarding/NextStepOnboarding";
import { locales } from "~/i18n/navigation";
import "~/styles/globals.css";
import "~/styles/tiptap-mentions.css";
import Providers from "../providers";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: import("~/i18n/navigation").Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!locales.includes(locale as any)) return {};
  const t = await getTranslations({ locale });
  const appName = t("common.pageTitles.appName");
  const dashboard = t("common.pageTitles.dashboard");
  return {
    title: {
      template: `%s | ${appName}`,
      default: `${dashboard} | ${appName}`,
    },
  };
}

// Force dynamic rendering to reduce memory usage during Docker builds
// This prevents Next.js from attempting to statically generate pages at build time
export const dynamic = "force-dynamic";
export const dynamicParams = true;

export default async function RootLayout(props: any) {
  const headerList = await headers();
  const locale = (headerList.get("x-next-intl-locale") || "en-US") as
    | "en-US"
    | "es-ES";
  if (!locales.includes(locale as any)) notFound();
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return (
    <Providers>
      <NextIntlClientProvider messages={messages} locale={locale}>
        <NextStepOnboarding>
          <UpgradeNotificationChecker />
          <div className="m-4">
            <div>
              <Header />
            </div>
            {props.children}
            <Toaster richColors className="!z-[9999]" />
            <RunGenerationProgressMount />
          </div>
        </NextStepOnboarding>
      </NextIntlClientProvider>
    </Providers>
  );
}
