import { Header } from "@/components/Header";
import { ReviewGateMutationListener } from "@/components/reviews/ReviewGateMutationListener";
import { RunGenerationProgressMount } from "@/components/runs/RunGenerationProgressToast";
import { UpgradeNotificationChecker } from "@/components/UpgradeNotificationChecker";
import { DirectionProvider } from "@radix-ui/react-direction";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Noto_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import Script from "next/script";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { NextStepOnboarding } from "~/components/onboarding/NextStepOnboarding";
import { getLocaleDirection } from "~/i18n/direction";
import { locales, type Locale } from "~/i18n/navigation";
import "~/styles/globals.css";
import "~/styles/tiptap-mentions.css";
import Providers from "../providers";

export async function generateMetadata(): Promise<Metadata> {
  // The locale is a root param, so reading it here keeps metadata prefetchable
  // (unlike `params`, which counts as per-link URL data).
  const locale = (await rootParams.locale()) as Locale;
  if (!locales.includes(locale)) return {};
  const t = await getTranslations({ locale });
  const appName = t("common.pageTitles.appName");
  const dashboard = t("common.pageTitles.dashboard");
  return {
    title: {
      template: `%s | ${appName}`,
      default: `${dashboard} | ${appName}`,
    },
    description:
      "Streamline your software testing with TestPlanIt's powerful test case management, execution tracking, and comprehensive reporting tools.",
    icons: {
      icon: "/tpi_logo.svg",
      apple: "/tpi_logo_square.png",
    },
    metadataBase: new URL(
      process.env.NEXTAUTH_URL || "https://app.testplanit.com"
    ),
    openGraph: {
      title: "TestPlanIt - Modern Test Management Platform",
      description:
        "Streamline your software testing with TestPlanIt's powerful test case management, execution tracking, and comprehensive reporting tools.",
      siteName: "TestPlanIt",
      images: [
        {
          url: "/tpi_logo_og.png",
          width: 1200,
          height: 630,
          alt: "TestPlanIt Logo",
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "TestPlanIt - Modern Test Management Platform",
      description:
        "Streamline your software testing with TestPlanIt's powerful test case management, execution tracking, and comprehensive reporting tools.",
      images: ["/tpi_logo_og.png"],
    },
  };
}

// Force dynamic rendering to reduce memory usage during Docker builds: this
// prevents Next.js from statically generating all pages at build time. Must
// be removed if cacheComponents is ever enabled (segment configs are
// incompatible with it; enumerate locales via generateStaticParams instead).
export const dynamic = "force-dynamic";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-noto-sans",
});

export default async function RootLayout(props: { children: React.ReactNode }) {
  const locale = (await rootParams.locale()) as Locale;
  if (!locales.includes(locale)) notFound();
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const dir = getLocaleDirection(locale);

  // Determine storage mode: "proxy" for multi-tenant/hosted instances without public MinIO, "direct" for self-hosted or public S3
  const isMultiTenant = process.env.MULTI_TENANT_MODE === "true";
  const isHosted = process.env.IS_HOSTED === "true";
  const hasPublicEndpoint = !!process.env.AWS_PUBLIC_ENDPOINT_URL;

  // Use proxy mode when:
  // 1. Multi-tenant mode is enabled (always needs proxy for storage isolation), OR
  // 2. IS_HOSTED is true and no public endpoint is configured
  const storageMode =
    isMultiTenant || (isHosted && !hasPublicEndpoint) ? "proxy" : "direct";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${notoSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="storage-mode" content={storageMode} />
        <Script
          id="storage-mode"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.__STORAGE_MODE__ = "${storageMode}";`,
          }}
        />
      </head>
      {/* `flow-root` establishes a block formatting context so descendant top
          margins (e.g. the app shell's `m-4`) don't collapse out through the
          body. That keeps `document.body.getBoundingClientRect().top` at 0, which
          the onboarding tour's spotlight positioning relies on to align with its
          target elements. */}
      <body className="flow-root text-foreground bg-background underline:text-link w-full">
        <Providers>
          <NextIntlClientProvider messages={messages} locale={locale}>
            <DirectionProvider dir={dir}>
              {/* The onboarding tours read useSearchParams/usePathname, which
                  suspend during the page-load prerender. The overlay portals to
                  <body> and targets elements by selector, so it runs as a
                  childless sibling behind its own boundary — never gating the
                  app. Do NOT wrap chrome + page in one boundary: under
                  partialPrefetching a same-route router.replace (table URL
                  syncs) can swap a covering boundary to its fallback mid-flight,
                  unmounting the whole app and dropping dialog state. */}
              <Suspense fallback={null}>
                <NextStepOnboarding />
              </Suspense>
              <UpgradeNotificationChecker />
              <ReviewGateMutationListener />
              <div className="m-4">
                <div>
                  <Suspense fallback={<div className="h-14" />}>
                    <Header />
                  </Suspense>
                </div>
                {props.children}
                <Toaster richColors className="!z-[9999]" />
                <RunGenerationProgressMount />
              </div>
            </DirectionProvider>
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
