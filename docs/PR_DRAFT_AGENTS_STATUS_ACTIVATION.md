# PR draft — do not open without Rob's confirmation

Branch: `fix/agents-status-activation-retry` → `shobhit99/SuperIsland:main`
(based on upstream `68cce87`)

## Title

fix(agents-status): retry bridge activation and keep probing while offline

## Body

### Problem

After a Mac restart (app launched as a login item) the Agents Status module
can show "Setup required · Bridge unreachable · run server/install.sh" and
raise a system notification, then stay in that state for hours — even though
the bridge is up (`curl 127.0.0.1:7823/health` → `{"ok":true,...}`).
Opening the Agents tab once clears it, which makes it look like a flaky
connection.

Observed 2026-10-06/07: app launched 17:20:50, bridge pid started 17:20:51,
module stuck until the tab was opened at 08:08 the next day.

### Root cause

Two host behaviours combine:

1. `ExtensionManager.activate` calls `AgentsStatusBridge.waitForListening`
   which blocks for at most 2 s. On a cold post-reboot login the Python
   server is not listening yet, so the extension's `onActivate` fires
   `POST /control/resume` into a closed port, sets `activationFailed` and
   notifies the user to run `install.sh`.
2. In `lowPower` energy mode (and `smart` while compact and not hovered)
   `ExtensionJSRuntime` skips **repeating** timers for modules that are not
   visible (`shouldSuspendRuntimeTimers`). The 800 ms `setInterval` poll that
   would clear the flag therefore never runs until the module is shown.

The same suspension also freezes a later "Bridge offline" state (e.g. after
the server restarts) until the module becomes visible.

### Fix

`Extensions/agents-status/index.js`:

- `activateWithRetry`: retry `/control/resume` with one-shot `setTimeout`
  delays (0.5/1/2/3/5/5/5/5 s ≈ 27 s) before declaring activation failed.
  One-shot timers are never suspended by the host. A generation counter
  makes stale retries bail out after `onDeactivate`.
- `scheduleOfflineProbe`: whenever a poll reports the bridge offline, arm a
  5 s one-shot probe that calls `fetchState()` again; it re-arms only while
  offline and is cleared by `stopPolling()`. Hooks are still re-applied on
  the offline→online transition as before.

`ExtensionHost/AgentsStatusBridge.swift`: log a warning when
`waitForListening` times out, so a slow start is visible in the extension
log instead of looking like a broken install.

### Tests

New Node harness `Extensions/agents-status/test_index.js` loads `index.js`
into a `vm` context with a scripted `SuperIsland` host and manually fired
timers (repeating timers can be left unfired to model the suspended state):

```
node --test Extensions/agents-status/test_index.js
```

- comes online without a warning when the bridge starts a few seconds late
- reports setup failure once, only after retries are exhausted
- recovers from offline through one-shot probes while repeating timers are suspended
- abandons pending retries after `onDeactivate`

### Verification

Release build installed; after relaunch the module is online within the
retry window with the bridge started late (see verification notes in the
PR comment).
