import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { APP_NAME, SITE_URL } from "@/lib/constants";
import { Wordmark } from "@/components/Logo";
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

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
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
  themeColor: "#0a1410",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tournament = await getTournament();
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable}`}
      // The theme boot script below adds .theme-daylight before React hydrates,
      // which would otherwise log a className mismatch on every Daylight load.
      suppressHydrationWarning
    >
      <head>
        {/* Theme boot. MUST stay inline, synchronous, and first in <head>: it
            runs before the first paint, so a reader who chose Daylight never
            sees a flash of the dark canvas. React cannot do this job — by the
            time it hydrates, the wrong theme has already been painted.
            Deliberately dependency-free and tiny; the key and class name are
            duplicated from lib/theme.ts (THEME_KEY / LIGHT_CLASS) because this
            executes before any module loads. Dark is the default: absent or
            unreadable storage falls through to it untouched. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("fw_theme")==="light"){' +
              'document.documentElement.classList.add("theme-daylight");' +
              'var m=document.querySelector(\'meta[name="theme-color"]\');' +
              'if(m)m.setAttribute("content","#f2f6ef");}}catch(e){}',
          }}
        />
        {/* Warm the flag CDN connection: the country chooser fires ~48 flag
            requests at once on first paint, so the early TLS handshake cuts
            transient drops. */}
        <link rel="preconnect" href="https://flagcdn.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://flagcdn.com" />
      </head>
      <body className="min-h-[100dvh] font-sans antialiased">
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
              <a href="#main" className="skip-link glass rounded-lg px-4 py-2 text-sm font-semibold">
                Skip to content
              </a>
              <div className="app-top sticky top-0 z-50 bg-background">
                <SiteNav />
                <OfflineBanner />
              </div>
              {/* Outside the sticky bar so the one-line, dismissible disclaimer
                  scrolls away with the page (the footer carries the full
                  compliance copy). Below the bar, not above it: .app-top owns
                  the standalone-PWA safe-area inset, so anything above it would
                  sit under the iPhone status bar in the native shell. */}
              <HideOnEmbed>
                <DisclaimerBanner />
              </HideOnEmbed>
              <main
                id="main"
                className="mx-auto max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+72px)] pt-8 sm:px-5 lg:pb-8"
              >
                {children}
              </main>
              {/* Bottom padding clears the fixed mobile tab bar + the iPhone home
                  indicator (safe-area inset is 0 on desktop/non-notched devices).
                  Released at lg, not sm: BottomNav is lg:hidden, so anything that
                  drops this padding at sm tucks the last ~72px of the page under
                  the tab bar for every 640-1023px viewport. */}
              <HideOnEmbed>
                <footer className="mx-auto mt-16 max-w-6xl px-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-10 text-center text-xs text-muted lg:pb-10">
                  <Wordmark className="font-bold" />{" "}
                  · Explainable sports predictions · For analytics and entertainment
                  only. Not betting advice.
                  <span className="mt-1.5 block">
                    <Link href="/methodology" className="underline-offset-2 hover:text-foreground hover:underline">
                      Methodology
                    </Link>{" "}
                    ·{" "}
                    <Link href="/privacy" className="underline-offset-2 hover:text-foreground hover:underline">
                      Privacy
                    </Link>{" "}
                    ·{" "}
                    <Link href="/terms" className="underline-offset-2 hover:text-foreground hover:underline">
                      Terms &amp; support
                    </Link>
                  </span>
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
