import { Header } from "@/components/Header";
import { UpgradeNotificationChecker } from "@/components/UpgradeNotificationChecker";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";

import { headers } from "next/headers";
import { Toaster } from "sonner";
import { NextStepOnboarding } from "~/components/onboarding/NextStepOnboarding";
import "~/styles/globals.css";
import "~/styles/tiptap-mentions.css";
import Providers from "../providers";

export const metadata: Metadata = {
  title: {
    template: "%s | TestPlanIt",
    default: "Dashboard | TestPlanIt",
  },
};

// Force dynamic rendering to reduce memory usage during Docker builds
// This prevents Next.js from attempting to statically generate pages at build time
export const dynamic = "force-dynamic";
export const dynamicParams = true;

export default async function RootLayout(props: any) {
  const headerList = await headers();
  const locale = (headerList.get("x-next-intl-locale") || "en-US") as
    | "en-US"
    | "es-ES";
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
          </div>
        </NextStepOnboarding>
      </NextIntlClientProvider>
    </Providers>
  );
}
