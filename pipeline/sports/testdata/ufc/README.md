# UFC test fixtures

Recorded from ESPN's public JSON feeds on 2026-11-25, trimmed to three bouts per
event and with link, image and media fields removed. Layout matches what
`RecordedUfcProvider` reads: `raw/events/<event_id>.json`,
`raw/bouts/<event_id>_<bout_id>.json` (keys `status`, `odds`,
`competitors.<fighter_id>.statistics` and, for decisions, `.linescores`),
`raw/athletes/<fighter_id>.json`. Numeric stat values are floats in the feed.

## Event 600061665 — UFC Fight Night: Procházka vs. Stirling (finished, 21 Nov 2026)

All three bouts are on the main card (`cardSegment.name` `main`), scheduled 2026-11-21T18:00Z.

| Bout id | No. | Weight class | Rounds | Fighter a (order 1) | Fighter b (order 2) | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 401922277 | 1 | Light Heavyweight | 5 | 3156612 Jiří Procházka | 5216713 Navajo Stirling | b won, KO/TKO (Punch), round 2, 4:58 |
| 401927850 | 2 | Featherweight | 3 | 3031559 Aljamain Sterling | 5145681 Kevin Vallejos | b won, Decision - Unanimous, round 3, 5:00 |
| 401922278 | 3 | Lightweight | 3 | 3109135 Dan Hooker | 3045737 Brian Ortega | a won, Decision - Unanimous, round 3, 5:00 |

Stats and odds worth asserting on:

- 401922277: a knockdowns 0, total strikes 26 of 48, significant 23 landed, control 18 s;
  b knockdowns 1, total strikes 51 of 98. Odds DraftKings: a +180, b -218. No judges.
- 401927850: judges a 27, 28, 27; b 30, 29, 30. Odds DraftKings: a +105, b -125.
- 401922278: judges a 30, 30, 30; b 27, 27, 27. Odds DraftKings: a -205, b +170.

Jiří Procházka's profile (`raw/athletes/3156612.json`): born 1992-10-14, height 75.0 in,
reach 80.0 in, stance Orthodox.

## Event 600062700 — UFC Fight Night: Adesanya vs Magomedov (upcoming, 5 Dec 2026)

No bout files: nothing has happened yet.

| Bout id | No. | Segment | Scheduled | Weight class | Rounds | Fighter a | Fighter b |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 401933595 | 1 | `main` (Main Card) | 2026-12-05T18:00Z | Middleweight | 5 | 4285679 Israel Adesanya | 4421784 Shara Magomedov |
| 401933606 | 12 | `prelims1` (Prelims) | 2026-12-05T15:00Z | Bantamweight | 3 | 4905308 Abdul Hussein | 5236383 Hecher Sosa |
| 401936473 | 14 | `prelims1` (Prelims) | 2026-12-05T15:00Z | Lightweight | 3 | 4689965 Mateusz Rębecki | 5110006 Elves Brener |
