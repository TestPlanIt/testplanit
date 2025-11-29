import { Noto_Sans } from "next/font/google";
import "~/styles/globals.css";
import "~/styles/tiptap-mentions.css";
import Providers from "../providers";
import { Header } from "@/components/Header";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from "next-intl";
import { headers } from "next/headers";
import { NextStepOnboarding } from "~/components/onboarding/NextStepOnboarding";
import { UpgradeNotificationChecker } from "@/components/UpgradeNotificationChecker";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-sans",
});

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
            <Toaster richColors toastOptions={{ className: "!z-[9999]" }} />
          </div>
        </NextStepOnboarding>
      </NextIntlClientProvider>
    </Providers>
  );
}
