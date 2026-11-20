import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { PageHead, Prose } from "@/components/ui";

export const metadata = {
  title: `Terms — ${APP_NAME}`,
  description: `${APP_NAME} terms of use and support contact.`,
};

export default function TermsPage() {
  return (
    <article>
      <PageHead eyebrow="FinalWhistle" title="Terms" sub="The short version. Last updated 20 November 2026." />
      <Prose>
        <ul>
          <li>
            {APP_NAME} is for analytics and entertainment only. Probabilities are model outputs, not promises.
          </li>
          <li>Nothing here is betting advice. There is no wagering, no real-money play and no prizes.</li>
          <li>It is free to use, with or without an account.</li>
          <li>
            Leaderboard display names are public. Keep them civil; offensive names, or entries that game the
            scoring, may be removed.
          </li>
          <li>
            Do not abuse the service: no scraping at scale, no attacks on the API, no attempts to reach other
            people&apos;s accounts.
          </li>
        </ul>

        <h2>Accounts</h2>
        <p>
          An account keeps your picks across devices and puts your name on the leaderboard. Keep your password
          safe. If you are locked out, use &ldquo;Forgot password?&rdquo; in the sign-in dialog for a reset
          link by email, or contact support. You can delete your account at any time (see{" "}
          <Link href="/privacy">privacy</Link>).
        </p>

        <h2>No guarantees</h2>
        <p>
          The service is provided as is. Fixtures, scores and model outputs can lag or be wrong, and the
          service may change or pause. {APP_NAME} is not affiliated with or endorsed by FIFA, any league or any
          club.
        </p>

        <h2>Support</h2>
        <p>
          Bugs, questions and account help:{" "}
          <a href="mailto:javohirazizov48@gmail.com">javohirazizov48@gmail.com</a>.
        </p>
      </Prose>
    </article>
  );
}
