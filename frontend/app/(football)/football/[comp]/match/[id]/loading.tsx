// Floodlight P6: the canonical /football/<comp>/match/<id> URL wraps the legacy
// match centre (see page.tsx), so it reuses the same skeleton. The page loads
// the prediction, the live summary and the competition together, then likely
// scorers and the forecast history together -- two parallel rounds, the
// highest cold-start risk of the football surfaces. (./layout.tsx resolves the
// first two before this boundary streams, to make a foreign id a real 404;
// the page's identical calls reuse them, so the skeleton covers the rest.)
export { default } from "@/app/match/[id]/loading";
