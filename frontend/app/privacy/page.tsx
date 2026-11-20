import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { PageHead, Prose } from "@/components/ui";

export const metadata = {
  title: `Privacy — ${APP_NAME}`,
  description: `What ${APP_NAME} collects, why, and how to remove it.`,
};

export default function PrivacyPage() {
  return (
    <article>
      <PageHead
        eyebrow="FinalWhistle"
        title="Privacy"
        sub="What the site keeps about you, in plain words. Last updated 20 November 2026."
      />
      <Prose>
        <h2>Without an account</h2>
        <p>
          Nothing personal. The picks you make are kept against a random device code stored in your browser,
          not against your name. The site sees anonymous, aggregated usage figures (page views and feature
          events through Vercel Analytics) with no cookies, no cross-site tracking and no advertising
          identifiers.
        </p>

        <h2>With an account</h2>
        <p>
          Your email address, a display name if you set one, and a securely hashed password (argon2; it can
          never be read back). Your picks are stored against your account so they follow you across devices.
          If you join a leaderboard, your display name and score are public.
        </p>

        <h2>What it never does</h2>
        <ul>
          <li>Sell or share personal data with third parties.</li>
          <li>Use advertising networks, ad identifiers or cross-app tracking.</li>
          <li>Collect your precise location.</li>
          <li>Read your contacts, photos or anything else on your device.</li>
        </ul>

        <h2>Security</h2>
        <p>
          Sessions use HttpOnly cookies, so no sign-in tokens sit in scripts or local storage. To slow down
          break-in attempts, a one-way hash of the requesting IP is kept for failed sign-ins; the raw IP is
          never stored. At sign-up a coarse country and city, taken from the hosting provider&apos;s request
          headers, is recorded for abuse prevention and overall figures only. Error reports carry technical
          detail, not your picks or identity.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>You can play without an account for as long as you like.</li>
          <li>Clearing this site&apos;s data in your browser removes the picks kept on your device.</li>
          <li>
            To delete your account, choose Delete account in the account menu (it asks for your password), or
            email us from the account&apos;s address and we will remove it.
          </li>
        </ul>

        <h2>Contact</h2>
        <p>
          Questions or deletion requests:{" "}
          <a href="mailto:javohirazizov48@gmail.com">javohirazizov48@gmail.com</a>. See also the{" "}
          <Link href="/terms">terms</Link>.
        </p>
      </Prose>
    </article>
  );
}
