## Summary

- audits the complete supported Daylight surface at 375×844 and 1280×800;
- replaces measured theme-hostile ink/opacity usages with semantic tokens while
  preserving every original Floodlight literal;
- makes the root crash boundary honour the stored Daylight preference;
- adds a conservative gradient-aware contrast audit, forced-state coverage,
  exact-token tests, and a raw-hex guard.

## Verification

The production-mode Daylight audit covered 35 route patterns × 2 viewports = 70/70
checks. It found zero unavailable routes, navigation failures, error boundaries,
redirect failures, or measured declared-stop contrast failures. Loading, empty,
error, and disabled FeatureHero states passed 8/8 representative checks.

The audit deliberately does not call continuously interpolated gradients an
automatic pass from endpoint colours alone. It records 6,214 deduplicated Daylight
exemptions: 6,213 continuous-gradient text records requiring rendered-pixel evidence
and one mobile-nav label over an image. All 70 route-viewport screenshots and all
eight state screenshots were reviewed; no legibility, overflow, clipping, or
unintended-surface defect was found. The exact exemption ledger is retained in the
untracked audit evidence.

## Colour and contrast register

For every semantic split below, the Floodlight value is the original shipped value.
Its before/after contrast is therefore exactly unchanged for every rendered pair;
this is proven by the browser computed-style comparison described below. Daylight
ratios are against the actual tested canvas, card stops, tinted washes, action fill,
or invariant pitch stops, not an assumed page background.

| Token / use | Floodlight before = after | Daylight before → after | Daylight contrast before → after |
|---|---|---|---:|
| `--crash-muted` | `#6b7c71` | `#6b7c71` → `#59685f` | 4.138 → 5.501 on `#f6f8f3` |
| `--pitch-copy` | `#a9c7b4` | `#a9c7b4` → `#a9c7b4` (explicit invariant) | 7.304–9.863 → 7.304–9.863 on pitch stops |
| `--feature-chart-ink` | `#8b95a7` | `#8b95a7` → `#657185` | 2.799–3.020 → 4.576–4.936 on canvas/card |
| `--amber-ink` | `38 94% 58%` | `43 82% 33%` → `43 82% 29%` | 3.867 measured → 4.775 on the actual host wash |
| `--action-ink` | `156 33% 6%` | background `96 23% 96%` → `150 38% 9%` | 1.639 → 9.623 on win |
| `--draw-ink` | `38 94% 58%` | draw `41 78% 51%` → `43 82% 29%` | 1.998 → 5.042 on canvas |
| `--loss-ink` | `351 90% 64%` | loss `350 84% 62%` → `350 84% 45%` | 3.278 → 4.979 on canvas |
| `--lime-deep-ink` | `0 0% 0%` | black → `96 23% 96%` | 3.254 → 5.983 on deep lime |
| `--origin-disclaimer` | `0 0% 100% / 0.4` | white/40 → `140 8% 38%` | 1.031 → 5.415 on canvas |
| `--disabled-opacity` | `0.6` | `0.6` → `1` | primary ~3.20–3.25 → 9.571; secondary ~4.39 → 15.740–16.968 |
| `--disabled-opacity-40` | `0.4` | `0.4` → `1` | picker 1.738–1.747 → 5.242–5.455; reset 2.461–2.494 → 15.732–17.012 |
| `--gold-ink` | `42 62% 48%` | `42 62% 48%` → `42 72% 27%` | 2.431–2.628 → 6.061–6.554 on card stops |
| `--muted-solid` | `129 10% 62% / 0.7` | muted/70 → opaque `140 8% 38%` | 2.941–3.072 → 5.401–5.841 on card stops |
| `--loss-wash-ink` | `351 90% 64%` | loss `350 84% 62%` → `350 84% 41%` | 2.633–2.939 → 4.643–5.182 on direct/nested washes |
| `--gold-wash-ink` | `38 94% 58%` | amber `43 82% 33%` → `43 82% 27%` | 3.602–3.862 → 4.971–5.329 on washes |
| `--accent-nrl-ink` | `174 60% 40%` | `174 60% 40%` → `174 60% 28%` | 2.544–2.733 → 4.702–5.052 on NRL washes |
| `--pitch-accent-ink` | `84 78% 55%` | lime-deep `108 56% 27%` → `84 78% 55%` | 2.064–2.787 → 8.751–11.816 on pitch stops |
| `--pitch-loss-ink` | `351 90% 64%` | loss `350 84% 62%` → `351 90% 69%` | 3.768–5.088 → 4.613–6.229 on pitch stops |
| `--pitch-foreground-ink` | `120 14% 96%` | foreground `150 38% 9%` → `120 14% 96%` | 1.057–1.277 → 12.263–16.559 on pitch stops |
| `--pitch-muted-ink` | `129 10% 62%` | muted `140 8% 38%` → `129 10% 62%` | 2.281–3.080 → 5.266–7.110 on pitch stops |
| `--pitch-subtle-ink` | `0 0% 100% / 0.45` | white/45 → white/70 | 3.948–4.481 → 7.324–9.174 on pitch stops |
| `--pitch-chip` + pitch muted | `144 19% 10% / 0.7` | light surface-2/70 + Daylight muted → invariant dark chip + pitch muted | 2.632–2.848 → 6.309–6.848 |

The crash primary pair (`#0f2117` on `#f6f8f3`, 15.709:1) and button pair
(`#123723` on `#8fd633`, 7.413:1) were already safe and did not change.

## Criterion 3: Floodlight proof

This was proven by computed-style diff, not visual inspection. The preserved
pre-change baseline is:

```text
dark-before.json SHA-256:
23ea923813770a21ecb72643a92618bd973034c5644132d6ee225231f6787d37
```

The after audit captured the same sampled P0 surfaces and returned:

```text
darkDiffs: []
darkStyleDiffs: 0
```

The upgraded resolver separately reports 310 pre-existing Floodlight declared-stop
contrast failures (P0 78, P1 202, P2 30) over unchanged computed styles, plus 6,042
continuous-gradient exemptions. This PR does not claim Floodlight contrast is clean;
it claims—and proves—that Floodlight did not change.

## Tests

- `npm run typecheck` — pass
- `npm run lint` — pass with the documented baseline warning
- `npm test -- --runInBand` — 145/145 suites, 943/943 tests passed
- production build: 35/35 static pages
- Daylight production audit: 70/70 checks, zero measured failures
- forced states: 8/8 checks
- Floodlight style comparison: zero changed properties

Known non-failing baseline output remains: one existing hook-dependency warning in
`LiveMatchProvider.tsx:106`, Next lint/multiple-lockfile notices, and existing React
`act(...)` warnings in unrelated async tests.
