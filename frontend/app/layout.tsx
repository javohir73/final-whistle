import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";
import { APP_NAME, BILLING_ENABLED, SITE_URL } from "@/lib/constants";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { HideOnEmbed } from "@/components/HideOnEmbed";
import { SiteNav } from "@/components/SiteNav";
import { BottomNav } from "@/components/BottomNav";
import { InstallAppPrompt } from "@/components/InstallAppPrompt";
import { ActivityPing } from "@/components/ActivityPing";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SentryInit } from "@/components/SentryInit";
import { AuthProvider } from "@/components/AuthProvider";
import { CompetitionProvider, TournamentProvider } from "@/components/TournamentProvider";
import { getTournament } from "@/lib/tournament";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsightsMount } from "@/components/SpeedInsightsMount";

// Direction G: Instrument Sans everywhere. One font file, exposed under both
// legacy variables so `font-display` and `font-sans` keep working.
const instrument = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  // No getTournament() call: this metadata is competition-neutral now (see
  // below), so the fetch it used to need is one less request on every page.
  return {
    metadataBase: new URL(SITE_URL),
    // Competition-NEUTRAL, deliberately. This is the site-wide fallback every
    // page without its own metadata inherits, and it used to be built from the
    // active tournament — so whichever competition the pipeline happened to be
    // pointed at described the whole site. That is how /football/epl/standings
    // ended up titled "Premier League standings" with a La Liga description.
    // Per-competition pages state their own competition; this one must not
    // guess on their behalf.
    title: `${APP_NAME} — Sports predictions, clearly explained`,
    description:
      "Explainable football and NRL predictions from FinalWhistle's in-house model, " +
      "published with their uncertainty. For analytics and entertainment only.",
    applicationName: APP_NAME,
    twitter: { card: "summary_large_image" },
    appleWebApp: {
      capable: true,
      title: APP_NAME,
      statusBarStyle: "default",
    },
    other: { "mobile-web-app-capable": "yes" },
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/apple-icon-180.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const FOOTER_LINKS = [
  { href: "/about", label: "How the model works" },
  { href: "/methodology", label: "Methodology" },
  ...(BILLING_ENABLED ? [{ href: "/premium", label: "Premium" }] : []),
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tournament = await getTournament();
  return (
    <html
      lang="en"
      className={instrument.variable}
    >
      <head>
        {/* Warm the flag CDN connection: the country chooser fires ~48 flag
            requests at once on first paint, so the early TLS handshake cuts
            transient drops. */}
        <link rel="preconnect" href="https://flagcdn.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://flagcdn.com" />
      </head>
      <body className="min-h-[100dvh] bg-ground font-sans text-ink antialiased">
        <ServiceWorker />
        <SentryInit />
        <TournamentProvider tournament={tournament}>
          {/* Current competition for the shell (URL -> fw_comp cookie -> geo
              -> EPL). No `initial` on purpose: reading cookies() here would
              make every route dynamic and switch off ISR site-wide (/, /nrl,
              /methodology are prerendered). middleware.ts writes the cookie
              and the nav reads it after hydration; competition routes take
              their scope from the URL, so SSR and client always agree. */}
          <CompetitionProvider>
            <AuthProvider>
              <a
                href="#main"
                className="skip-link inline-flex min-h-[44px] items-center rounded-full bg-brand px-5 font-semibold text-white no-underline"
              >
                Skip to content
              </a>
              <div className="app-top sticky top-0 z-50 bg-ground">
                <SiteNav />
                <OfflineBanner />
              </div>
              {/* Outside the sticky bar so the one-line, dismissible disclaimer
                  scrolls away with the page (the footer carries the full
                  compliance line). Below the bar, not above it: .app-top owns
                  the standalone-PWA safe-area inset, so anything above it would
                  sit under the iPhone status bar in the native shell. */}
              <HideOnEmbed>
                <DisclaimerBanner />
              </HideOnEmbed>
              {/* ONE container for header, main and footer (.fw-wrap: 1,360px,
                  40px gutters, 16px under 900px). Pages put their content
                  straight in (32px top padding is already here); a page with a
                  rail uses components/ui/PageLayout.
                  Bottom padding clears the fixed phone tab bar + the iPhone home
                  indicator below lg, where BottomNav shows. */}
              <main
                id="main"
                tabIndex={-1}
                className="fw-wrap pb-[calc(env(safe-area-inset-bottom)+88px)] pt-8 focus:outline-none lg:pb-0"
              >
                {children}
              </main>
              <HideOnEmbed>
                <footer className="fw-wrap pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-10">
                  <div className="flex flex-wrap justify-between gap-x-6 gap-y-3 mt-16 border-t border-line pt-7 text-notes text-muted">
                    <span>
                      FinalWhistle. Predictions with their uncertainty, for analytics and
                      entertainment only. Not betting advice.
                    </span>
                    {/* Phone: each link is a 44px-tall target (rows touch, no
                        extra gap); from lg the links sit on one calm line. */}
                    <nav aria-label="Footer" className="-my-2.5 flex flex-wrap gap-x-6 lg:my-0 lg:gap-y-2">
                      {FOOTER_LINKS.map((l) => (
                        <Link
                          key={l.href}
                          href={l.href}
                          className="inline-flex min-h-[44px] items-center no-underline underline-offset-[3px] hover:text-ink hover:underline lg:min-h-0"
                        >
                          {l.label}
                        </Link>
                      ))}
                    </nav>
                  </div>
                </footer>
              </HideOnEmbed>
              <BottomNav />
              <InstallAppPrompt />
              <ActivityPing />
            </AuthProvider>
          </CompetitionProvider>
        </TournamentProvider>
        <Analytics />
        <SpeedInsightsMount />
      </body>
    </html>
  );
}
