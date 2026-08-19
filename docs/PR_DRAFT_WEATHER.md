# PR draft 1 — do not open without Rob's confirmation

Branch: `fix/weather-location` → `shobhit99/SuperIsland:main`

## Title

Fix CLLocationManager delegate assertion breaking the Weather module

## Body

### Problem

The Weather module can stay permanently empty even when Location Services
are enabled and the app is `AuthorizedAlways`.

Reproduction (macOS 26.5.1, SuperIsland 1.0.10, Weather enabled and placed
in the HOME layout):

1. Launch SuperIsland with location permission granted.
2. Watch the Core Location log:

```
log stream --style compact \
  --predicate 'process == "SuperIsland" AND (eventMessage CONTAINS[c] "location")' --info
```

3. The log shows:

```
CLLocationManager _cmd: requestLocation
Delegate must respond to locationManager:didUpdateLocations:
```

and the Weather module never receives data, while a manual Open-Meteo
request from the same machine succeeds.

### Root cause

`PermissionsManager.ensureLocationManager()` (Utilities/Permissions.swift)
installs an authorization callback that calls `requestLocation()` on the
permission helper's own `CLLocationManager`:

```swift
locationDelegate.onAuthorizationChange = { [weak self] status in
    guard let self else { return }
    if self.isAuthorizedLocationStatus(status) {
        self.locationManager?.requestLocation()
    }
}
```

That manager's delegate (`LocationDelegate`) implements only
`locationManagerDidChangeAuthorization`. Core Location requires the
delegate of any manager used for `requestLocation()` to implement
`locationManager(_:didUpdateLocations:)` (and expects
`didFailWithError`); without them it raises the assertion above and
location delivery breaks — so `WeatherManager`, which owns its own,
correctly wired `CLLocationManager`, never gets a fix either. The callback
fires as soon as the manager is created with an already-authorized status
(e.g. when the Settings window calls `checkLocation()`), so the break is
easy to hit.

### Change

- Remove the `requestLocation()` call from the permission callback.
  `PermissionsManager` only checks and requests authorization; the actual
  location is `WeatherManager`'s job, and its delegate already receives the
  same `locationManagerDidChangeAuthorization` and starts updating once
  access is granted — no second location pipeline is introduced.
- Implement `didUpdateLocations`/`didFailWithError` on the helper delegate
  defensively so any future code path routed through this manager cannot
  re-trigger the assertion.
- Accept `.authorizedWhenInUse` in `WeatherManager`'s authorization
  switches (parity with `PermissionsManager.isAuthorizedLocationStatus`).
- Log weather HTTP failures instead of dropping them silently.

### Tests

- `PermissionsLocationDelegateTests` asserts the delegate responds to all
  three delegate selectors (regression guard for the assertion) and that
  the authorization callback forwards the manager status.
- Manual: with this change the log shows authorization →
  `startUpdatingLocation` → `didUpdateLocations` → Open-Meteo fetch, no
  assertion, and the Weather module renders data.
