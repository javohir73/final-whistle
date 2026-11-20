import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { PageHead, Prose } from "@/components/ui";

export const metadata = {
  title: `How the model works — ${APP_NAME}`,
  description: "A simple, explainable model that publishes its calls before kick-off and grades them in public.",
};

export default function AboutPage() {
  return (
    <article>
      <PageHead
        eyebrow="FinalWhistle"
        title="How the model works"
        sub="A simple, explainable model that publishes its calls before kick-off and grades them in public."
      />
      <Prose>
        <h2>What it does</h2>
        <p>
          Every team has an Elo rating, a running score that rises with wins and falls with losses, by more
          when the opponent is stronger. For each match the model turns the gap between the two ratings and
          the recent head-to-head record into three chances: a home win, a draw and an away win. It also
          names the single most likely score.
        </p>
        <p>
          For a tournament, the groups and the knockout rounds are played out thousands of times to give
          each team&apos;s chance of going through.
        </p>

        <h2>How far to trust it</h2>
        <p>
          Each call carries a confidence label. Low means no result is a clear favourite. Back-tested on the
          2014, 2018 and 2022 World Cups, a stated 60% chance happened about 60% of the time.
        </p>

        <h2>What it leaves out</h2>
        <ul>
          <li>It rates teams, not players. Form and injuries of individual players are not factored in.</li>
          <li>Upsets happen and no model sees them coming reliably.</li>
          <li>It uses free, open data only: past results, rankings and the official fixtures.</li>
        </ul>

        <h2>Not betting advice</h2>
        <p>
          Predictions are probabilities, not promises. They are for analytics and entertainment only and are
          not betting advice. If you choose to gamble, do so responsibly, within the law where you live and
          only if you are of legal age (18+ or 21+).
        </p>

        <p className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/record">The football record</Link>
          <Link href="/nrl/record">The NRL record for 2026</Link>
          <Link href="/methodology">Methodology</Link>
        </p>
      </Prose>
    </article>
  );
}
