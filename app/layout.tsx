import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { getLocale } from "@/lib/i18n/get-locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = dictionaries[locale];
  return {
    // Production domain: relative canonical and Open Graph URLs resolve
    // against it. NEXT_PUBLIC_SITE_URL overrides it (e.g. a staging domain).
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://register.niaraglobal.com"),
    title: t.meta.title,
    description: t.meta.description,
    // Tab icons: transparent mark, dark for light tab bars and light for dark ones.
    // Source: public/icons (see public/icons/README.md).
    icons: {
      icon: [
        { url: "/icons/icon-dark-mark-16.png", sizes: "16x16", type: "image/png", media: "(prefers-color-scheme: light)" },
        { url: "/icons/icon-dark-mark-32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: light)" },
        { url: "/icons/icon-light-mark-16.png", sizes: "16x16", type: "image/png", media: "(prefers-color-scheme: dark)" },
        { url: "/icons/icon-light-mark-32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: dark)" },
      ],
      apple: [{ url: "/icons/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      type: "website",
      siteName: t.meta.title,
      title: t.meta.title,
      description: t.meta.description,
      locale: locale === "pt" ? "pt_BR" : "en_US",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html lang={locale === "pt" ? "pt-BR" : "en"}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <SiteHeader locale={locale} />
        <main>{children}</main>
      </body>
    </html>
  );
}
