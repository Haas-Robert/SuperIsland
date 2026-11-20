# PR draft — not yet opened (2026-11-20)

Branch: `fix/ai-usage-keychain-state` → `shobhit99/SuperIsland:main`
(based on upstream `68cce87`, single commit `8e12c3a`)

## Title

fix(ai-usage): don't mistake a failed background keychain read for a denial; keep last Codex data when the API is down

## Body

### Problem 1 — Claude: "Claude Code sign-in not found" forever

The module can get stuck on "Claude Code sign-in not found" (or `--`)
although Claude Code is signed in, and nothing short of editing
`UserDefaults` brings the keychain "allow access" dialog back.

Observed 2026-11-20 on macOS 26/27: `aiUsage.claude.keychainAccessState`
was `denied` with `keychainAccessDeniedAt` advancing every 5-minute poll,
while `keychainPromptedAt` was never set — i.e. the app recorded a user
refusal although no dialog had ever been shown.

### Root cause 1

`AIUsageProvider.loadClaudeTokenFromKeychain(allowUserInteraction: false)`
reads the item with `SecKeychainSetUserInteractionAllowed(false)`. When the
item's ACL or partition list no longer covers the app (Claude Code rewrites
the item on every token refresh; the partition list of the observed item
was back to `apple-tool:` only), that read fails with
`errSecAuthFailed` (-25293) — not `errSecInteractionNotAllowed`.
`updateClaudeKeychainAccessState` mapped `errSecAuthFailed` /
`errSecUserCanceled` to the sticky `.denied` state regardless of whether
the attempt was interactive, so one lost grant silenced the dialog for good.

### Fix 1

- `claudeKeychainAccessState(after:interactive:)` is a pure classification:
  success → `.allowed`; `errSecAuthFailed`/`errSecUserCanceled` → `.denied`
  only when the attempt was interactive, otherwise "proves nothing";
  everything else leaves the state untouched.
- A stored `.denied` without any prompt on record (`keychainPromptedAt` or
  the legacy `keychainPrompted` flag) is treated as `.unknown`, which heals
  installs that already carry the bogus flag without a defaults edit.
- Failed reads are logged with their OSStatus and interactivity.

The sticky denial itself (asked for in the #98 review) is preserved: a
user who dismisses the dialog is still never asked again.

### Problem 2 — Codex: one failed poll wipes the numbers

A single failed request to the Codex usage endpoint (offline, slow
network beyond the 3 s timeout, 5xx) replaced both windows with "No data"
under an "Auth token" source until the next successful refresh. With the
module hidden and the poll suspended (lowPower), that is the state the user
finds when they open the tab, and `fetchJSON` swallowed the reason.

### Fix 2

- `codexFallbackPayload(lastGood:hasAuth:updatedAt:)`: the last successful
  OAuth payload is served again with `stale: true`,
  `source: "oauth-api-stale"` and a `statusLabel` naming the fetch time —
  the same contract the Claude fetcher already uses, and the renderer
  already labels `oauth-api-stale`.
- `fetchJSON` logs host, status and error on failure and logs timeouts.

### Tests

- `AIUsageProviderKeychainStateTests` (9): status classification per
  interactivity, prompt-record rule for stored denials.
- `AIUsageProviderCodexFallbackTests` (5): stale fallback, placeholder
  without cached data, label text.

`xcodebuild test -scheme SuperIsland -destination "platform=macOS,arch=arm64"`
→ 72 tests, 0 failures.

### Manual verification

Reproduce the denial: with a build that has the item granted, run
`security add-generic-password -U -s "Claude Code-credentials" -a "$USER" -w '{...}'`
from a shell (what Claude Code does on refresh) and watch the next poll —
before the fix `keychainAccessState` flips to `denied` and the dialog
never returns; after the fix the state stays, the OSStatus is logged and
the one-per-day interactive retry shows the dialog again.
