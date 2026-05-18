import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { headers } from "next/headers";
import { PWARegistration } from "@/components/pwa/PWARegistration";
import { PageTransitionProvider } from "@/components/layout/PageTransitionProvider";
import { PageTransitionBar } from "@/components/layout/PageTransitionBar";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Nonce injected by middleware — passed to ClerkProvider so Clerk stamps it on its inline scripts.
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    <ClerkProvider nonce={nonce} afterSignOutUrl="/sign-in">
      <html lang={locale}>
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
          <PageTransitionProvider>
            <PageTransitionBar />
            <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
          </PageTransitionProvider>
          <PWARegistration />
        </body>
      </html>
    </ClerkProvider>
  );
}
