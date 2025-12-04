import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import "~/styles/globals.css";

export const metadata: Metadata = {
  title: "TestPlanIt - Modern Test Management Platform",
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
        url: "/tpi_logo_square.png",
        width: 1041,
        height: 1041,
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
    images: ["/tpi_logo_square.png"],
  },
};

const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-noto-sans",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Determine storage mode: "proxy" for multi-tenant/hosted instances without public MinIO, "direct" for self-hosted or public S3
  const isMultiTenant = process.env.MULTI_TENANT_MODE === "true";
  const isHosted = process.env.IS_HOSTED === "true";
  const hasPublicEndpoint = !!process.env.AWS_PUBLIC_ENDPOINT_URL;

  // Use proxy mode when:
  // 1. Multi-tenant mode is enabled (always needs proxy for storage isolation), OR
  // 2. IS_HOSTED is true and no public endpoint is configured
  const storageMode =
    (isMultiTenant || (isHosted && !hasPublicEndpoint)) ? "proxy" : "direct";

  return (
    <html lang="en" className={`${notoSans.variable}`}>
      <head>
        <meta name="storage-mode" content={storageMode} />
        {/* Set global storage mode before any scripts run */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__STORAGE_MODE__ = "${storageMode}";`,
          }}
        />
      </head>
      <body className="text-foreground bg-background underline:text-link w-full">
        {children}
      </body>
    </html>
  );
}
