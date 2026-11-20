import type { CapacitorConfig } from "@capacitor/cli";

/** FinalWhistle native shell (App Store / Play Store).
 *
 *  Remote-shell mode (decision in docs/NATIVE-SHELL.md): the webview loads the
 *  deployed Vercel origin, so it shares the PWA's first-party origin — the
 *  fw_session cookie, /backend-api proxy, service worker and offline page all
 *  behave exactly like the installed PWA. No separate native auth transport. */
const config: CapacitorConfig = {
  appId: "com.finalwhistle.app",
  appName: "FinalWhistle",
  webDir: "public", // required by the CLI; unused while server.url is set
  server: {
    url: "https://fifa-wc26-prediction.vercel.app",
    allowNavigation: ["fifa-wc26-prediction.vercel.app"],
  },
  ios: {
    contentInset: "automatic",
    // Direction G canvas (#ffffff): the web app's --background, the manifest
    // and the browser theme-color. The WebView shows this before the page
    // paints (launch) and behind overscroll and the safe areas, so any other
    // value is a visible seam. The site has one light theme, so the shell
    // always paints white.
    backgroundColor: "#ffffff",
  },
  android: {
    backgroundColor: "#ffffff",
  },
};

export default config;
