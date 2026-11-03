import { redirect } from "next/navigation";
import { isCompetitionId } from "@/lib/sports";

type TipsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** /tips duplicated /play (the same league picker) and, as an unscoped route,
 *  wore World Cup chrome. It now sends visitors to /play: a temporary 307
 *  while the Play surfaces settle (plan §6.5 makes it permanent later).
 *  `?league=x` becomes `?competition=x` -- the param /play reads -- and any
 *  other params (utm_*) ride along. /tips/share/** is a separate route and
 *  is untouched. No loading.tsx here, so redirect() is a real 307. */
export default async function TipsRedirect({ searchParams }: TipsPageProps) {
  const params = (await searchParams) ?? {};
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const target = new URLSearchParams();
  const competition = first(params.competition) ?? first(params.league);
  if (competition && isCompetitionId(competition)) target.set("competition", competition);
  for (const [key, value] of Object.entries(params)) {
    if (key === "league" || key === "competition" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) target.append(key, v);
  }
  const qs = target.toString();
  redirect(qs ? `/play?${qs}` : "/play");
}
