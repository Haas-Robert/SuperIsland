# Rob's local SuperIsland build

Personal fork build with two fixes not yet merged upstream. This document is
the single source of truth for reproducing, testing, and maintaining the
build. No secrets belong in this file — never paste tokens, keychain dumps,
or Authorization headers here.

- Fork: https://github.com/symbiodev/SuperIsland (`origin`)
- Upstream: https://github.com/shobhit99/SuperIsland (`upstream`)
- Baseline: upstream/main commit `5619541` ("fix: prevent main-thread freeze
  from leaked RunLoop timers (#89)"), 2 commits after tag `1.0.10`.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Mirrors `upstream/main`, never carries local commits |
| `fix/weather-location` | Weather fix only (PR 1 candidate) |
| `fix/claude-ai-usage` | Claude usage fix only (PR 2 candidate) |
| `rob/local-build` | Both fixes merged + local-build identity changes |

## Fix 1: Weather showed nothing (Core Location assertion)

**Symptom.** Weather module empty despite Location Services enabled and
`AuthorizedAlways`. Log showed:

```
CLLocationManager _cmd: requestLocation
Delegate must respond to locationManager:didUpdateLocations:
```

**Root cause.** `PermissionsManager.ensureLocationManager()`
(SuperIsland/Utilities/Permissions.swift) installed an authorization callback
that called `requestLocation()` on its own helper `CLLocationManager`. That
manager's delegate implemented only `locationManagerDidChangeAuthorization`,
not `didUpdateLocations`/`didFailWithError`. Core Location rejects
`requestLocation()` in that case with the assertion above and location
delivery breaks, so `WeatherManager` (which has its own, correctly wired
`CLLocationManager`) never received a fix.

**Fix** (`fix/weather-location`, commit `16c9cba`):

- removed the invalid `requestLocation()` from the permission callback —
  PermissionsManager only checks/requests authorization; WeatherManager's own
  delegate receives the same authorization change and starts updates,
- the helper delegate (`PermissionsLocationDelegate`) now implements
  `didUpdateLocations`/`didFailWithError` defensively,
- `WeatherManager` accepts `.authorizedWhenInUse` in addition to
  `.authorizedAlways`,
- weather HTTP failures are now logged instead of dropped silently,
- regression tests in `SuperIslandTests/PermissionsLocationDelegateTests.swift`.

**Verified.** Debug build 2026-08-19: authorization → `startUpdatingLocation`
→ `didUpdateLocations` → Open-Meteo fetch, no assertion in the Core Location
log stream.

## Fix 2: Claude AI Usage showed `--`

**Symptom.** The ai-usage extension showed Codex correctly but Claude was
always unavailable, despite a valid Claude Max login and
`aiUsage.claude.keychainAccessState = allowed`.

**Root causes** (all three verified 2026-08-19):

1. **Wrong User-Agent.** The provider sent `User-Agent: SuperIsland/1.0` to
   `https://api.anthropic.com/api/oauth/usage`. That endpoint throttles
   unknown agents into a much stricter rate-limit bucket: with the same
   token, the generic agent got repeated `429` with tens-of-minutes
   `Retry-After`, while `claude-code/2.1.220` got `200` immediately.
2. **Silent errors + ignored Retry-After.** `fetchJSON` collapsed every
   non-2xx into `nil`; the 5-minute refresh kept re-hitting the throttled
   endpoint, keeping it throttled indefinitely, and the UI could only show
   "unavailable".
3. **Stale token cache.** The access token was cached for the process
   lifetime with no `expiresAt` check. Claude Code rotates the token (the
   keychain copy observed expiring within hours); after rotation the
   provider kept sending a dead token → `401`.

**Fix** (`fix/claude-ai-usage`, commit `6301400`):

- new `ExtensionHost/ClaudeUsageFetcher.swift`:
  - HTTP layer returning `HTTPJSONResult` (status, headers, JSON, error),
  - detected `claude-code/<version>` User-Agent
    (`ClaudeCodeVersionDetector`: npm package.json locations first, then CLI
    binaries at well-known paths, 3 s bounded; falls back to a last-known
    version constant),
  - `429` → parse `Retry-After` (seconds or HTTP-date, default 15 min,
    cap 6 h), store `nextAllowedFetchAt`, and send no request until it
    passes,
  - last successful payload is kept and served marked `stale`
    (`source: oauth-api-stale`) during rate limits/outages,
  - `401/403` → invalidate the process token cache and retry exactly once
    with a re-read keychain token; token past `expiresAt` is never sent,
  - distinct failure states for the renderer: `rate-limited`, `auth-error`,
    `no-token`, `token-expired`, `server-error`, `network-error`,
    `parse-error`,
  - logs status/Retry-After only — never tokens.
- `AIUsageProvider` keeps its source order (local summary → OAuth →
  stats-cache → unavailable) and existing keychain-prompt protection; the
  Codex path is untouched.
- renderer (`Extensions/ai-usage/index.js`) labels the new sources.
- 20 unit tests in `SuperIslandTests/ClaudeUsageFetcherTests.swift`.

**Verified.** Debug build 2026-08-19: `claude usage source=oauth-api
status=200` in app log; values matched the Claude UI. One render loop (15 s)
does not create network requests — the native 300 s cache TTL governs.

## Local build identity (rob/local-build only)

`project.yml` overrides:

```
PRODUCT_NAME: SuperIsland Rob
PRODUCT_BUNDLE_IDENTIFIER: com.workview.SuperIsland.rob
```

Why: the official app's AutoUpdater downloads the release DMG and replaces
the app bundle at its own path after the user confirms the update dialog.
With a different app name the updater cannot find "SuperIsland Rob.app"
inside the official DMG and fails safely — the custom build can never be
overwritten by an official update. The update dialog still appears when
upstream releases a new version; treat it as a reminder to sync the fork
(see below), not as an install button.

Consequences of the separate bundle ID (one-time, expected):

- macOS asks again for Location (and any other TCC permission you use),
- the keychain asks once to allow access to `Claude Code-credentials` —
  click "Always Allow" so it does not re-prompt,
- settings/UserDefaults start fresh (module layout, onboarding), the domain
  is `com.workview.SuperIsland.rob`.

## Local addition: IP geolocation fallback for Weather (rob/local-build only)

Macs have no GPS — Core Location works purely from Wi-Fi AP triangulation.
On an iPhone personal hotspot (mobile AP, no neighbors in Apple's database)
locationd cannot compute any position for any app, so Weather would stay
empty even with the delegate fix. `WeatherManager` therefore falls back to
coarse IP-based coordinates (`https://get.geojs.io/v1/ip/geo.json`, HTTPS,
no API key) when:

- Core Location reports an error, or
- no fix arrives within 15 s of starting updates, or
- location permission is denied/restricted.

Rules: a real Core Location fix always wins and immediately replaces IP
data (bypassing the 5-minute debounce once); the IP lookup itself is
debounced to once per 5 minutes; the location name is prefixed with `~`
(e.g. "~Praha") to mark the estimate; coordinates are never logged. On a
hotspot the IP position is the carrier's egress point — city-level at best.

This is intentionally NOT part of the upstream `fix/weather-location`
branch (behavior change beyond the bug fix). Expect a small conflict in
`WeatherManager.swift` when rebasing `rob/local-build` if upstream touches
the same file.

## Building

```
xcodegen generate
xcodebuild build -project SuperIsland.xcodeproj -scheme SuperIsland \
  -configuration Release -destination "platform=macOS,arch=arm64"
```

or the repo script (builds Release, bundles node, signs with any local
Apple Development cert, produces `build/SuperIsland.dmg` — on this branch
the app inside is `SuperIsland Rob.app`):

```
./scripts/build-dmg.sh
```

Install by dragging `SuperIsland Rob.app` to `/Applications`. It coexists
with the official `/Applications/SuperIsland.app`; never run both at once
(two notch overlays). Quit one before starting the other.

Tests:

```
xcodebuild test -project SuperIsland.xcodeproj -scheme SuperIsland \
  -destination "platform=macOS,arch=arm64"
```

## Syncing with upstream releases

```
git fetch upstream --tags
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout fix/weather-location && git rebase main
git checkout fix/claude-ai-usage && git rebase main
git checkout rob/local-build && git rebase main
xcodegen generate && ./scripts/build-dmg.sh
```

If upstream fixes one of these issues itself: verify their implementation
against the reproduction in this document, drop the corresponding local
branch/merge from `rob/local-build`, and update the table below.

| Fix | Upstream status | Local commit | Still needed |
| --- | --- | --- | --- |
| Weather CL delegate | PR #97 open (2026-08-19) | `16c9cba` | yes |
| Claude usage rate limits | PR #98 open (2026-08-19) | `6301400` | yes |
| Full-expanded tab strip + adaptive island width | PR #99 open (2026-08-19) | `5b02ef6` | yes |
| Island collapse loop at top screen edge | PR #100 open (2026-08-19) | `3940d6f` | yes |

Local-only additions (never for upstream): IP geolocation Weather fallback
(`0d8a5da`), product identity (`SuperIsland Rob`).

## Known limitations

- The build is signed with a personal Apple Development certificate (or
  unsigned if none is present) — Gatekeeper may require right-click → Open
  on first launch; TCC permissions need the cert to register.
- Claude usage depends on an undocumented endpoint; field names
  (`five_hour`, `seven_day*`, `utilization`, `resets_at`) may change.
- Claude token refresh is not implemented (by design): when the keychain
  token expires, the module shows "token expired" until Claude Code runs
  and rotates it.
