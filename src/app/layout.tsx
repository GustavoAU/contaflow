import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { esES } from "@clerk/localizations";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { headers } from "next/headers";
import { PWARegistration } from "@/components/pwa/PWARegistration";
import { PWAInstallBanner } from "@/components/pwa/PWAInstallBanner";
import { PageTransitionProvider } from "@/components/layout/PageTransitionProvider";
import { PageTransitionBar } from "@/components/layout/PageTransitionBar";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ContaFlow",
  description: "Sistema contable profesional venezolano",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ContaFlow",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#18181b",
  width: "device-width",
  initialScale: 1,
};

const clerkAppearance = {
  variables: {
    colorPrimary: "#3b82f6",
    colorText: "#18181b",
    colorTextSecondary: "#71717a",
    colorBackground: "#ffffff",
    colorInputBackground: "#fafafa",
    colorInputText: "#18181b",
    colorDanger: "#ef4444",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-geist-sans)",
    fontSize: "14px",
  },
  elements: {
    card: "shadow-2xl border border-zinc-200/80",
    formButtonPrimary: "!bg-blue-500 hover:!bg-blue-600 !shadow-none !text-white",
    footerActionLink: "!text-blue-500 hover:!text-blue-600",
    identityPreviewEditButton: "!text-blue-500",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Nonce injected by middleware — passed to ClerkProvider so Clerk stamps it on its inline scripts.
  const nonce = (await headers()).get("x-nonce") ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localization = esES as any;

  return (
    <ClerkProvider nonce={nonce} afterSignOutUrl="/sign-in" localization={localization} appearance={clerkAppearance}>
      <html lang={locale}>
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
          <ThemeProvider>
            <PageTransitionProvider>
              <PageTransitionBar />
              <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
            </PageTransitionProvider>
          </ThemeProvider>
          <PWARegistration />
          <PWAInstallBanner />
        </body>
      </html>
    </ClerkProvider>
  );
}
