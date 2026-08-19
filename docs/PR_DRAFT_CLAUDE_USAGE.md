# PR draft 2 — do not open without Rob's confirmation

Branch: `fix/claude-ai-usage` → `shobhit99/SuperIsland:main`

## Title

Handle Claude OAuth usage rate limits and expose provider errors

## Body

### Problem

The ai-usage extension shows Codex correctly but Claude is permanently
`--`, even with a valid Claude Max login and keychain access already
granted (`aiUsage.claude.keychainAccessState = allowed`).

Observed on macOS 26.5.1, SuperIsland 1.0.10, Claude Code 2.1.220:

- direct requests to `https://api.anthropic.com/api/oauth/usage` with the
  user's valid token and the app's current `User-Agent: SuperIsland/1.0`
  returned `429` with `Retry-After` in the tens of minutes, repeatedly —
  while the Claude UI showed only ~2–8 % utilization, so the subscription
  quota was clearly not exhausted;
- the same request with `User-Agent: claude-code/2.1.220` returned `200`
  with the expected `five_hour`/`seven_day` windows.

### Root causes

1. **User-Agent.** The usage endpoint throttles unknown agents into a much
   stricter rate-limit bucket. The generic `SuperIsland/1.0` string lands
   there; the Claude Code agent string does not. (Community monitors hit
   the same wall — e.g. Claude-Code-Usage-Monitor issue #202.)
2. **Silent errors, ignored `Retry-After`.** `fetchJSON` collapses every
   non-2xx response into `nil`: no status, no headers, no log. The
   5-minute refresh keeps re-hitting the throttled endpoint — shorter than
   the server-requested pause — so the client can stay throttled
   indefinitely, and the UI can only say "unavailable".
3. **Stale token cache.** The Claude access token is cached for the
   process lifetime with no expiry check. Claude Code rotates it (the
   keychain payload carries `expiresAt`, observed within hours); after
   rotation the provider keeps sending a dead token and gets `401` until
   the app restarts.

### Change

New `ExtensionHost/ClaudeUsageFetcher.swift`, used by `AIUsageProvider`
for the Claude OAuth source only (Codex fetching is untouched):

- HTTP layer returns an `HTTPJSONResult` (status code, headers, JSON,
  transport error) instead of `[String: Any]?`.
- Requests send `claude-code/<version>` where the version is detected from
  the installed CLI (npm package manifests first, then well-known binary
  paths with a bounded `--version` call; GUI apps do not inherit the
  interactive shell PATH). Result cached per process, with a last-known
  fallback version.
- `429`: `Retry-After` is parsed (delta-seconds and HTTP-date), stored as
  `nextAllowedFetchAt`, and no request is issued before it elapses
  (default 15 min when the header is missing, capped at 6 h).
- The last successful payload is retained and served marked stale
  (`source: oauth-api-stale`) while the endpoint is rate limited or
  unreachable, instead of dropping to `--`.
- `401/403`: the process token cache is invalidated and the request is
  retried exactly once with a freshly re-read keychain token, so a token
  rotated by Claude Code is picked up without restarting. A token past its
  `expiresAt` is never sent.
- Distinct failure states are surfaced to the renderer (`rate-limited`,
  `auth-error`, `no-token`, `token-expired`, `server-error`,
  `network-error`, `parse-error`) and labeled in
  `Extensions/ai-usage/index.js`.
- Logs contain status codes and Retry-After only — never tokens or
  Authorization headers.

The provider's source order (local summary → OAuth → stats cache →
unavailable), the 300 s snapshot cache, and the existing protection
against repeated keychain prompts are unchanged.

### Tests

`SuperIslandTests/ClaudeUsageFetcherTests.swift` (20 tests): success
parsing for `five_hour` and each `seven_day*` variant,
utilization→remaining conversion, request headers, missing/invalid JSON,
401 retry-once with rotated token, 401/403 without rotation, 429 with
numeric and HTTP-date `Retry-After` (including "no request before
`nextAllowedFetchAt`"), default backoff, timeout, 5xx, stale payload
retention, expired-token handling, and a token-never-logged guard.

Manual: with this change the module shows Claude session/weekly
percentages matching the Claude UI (`claude usage source=oauth-api
status=200` in the log), and a 15 s render loop causes no extra network
requests.
