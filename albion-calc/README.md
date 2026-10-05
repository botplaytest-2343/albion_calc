# Albion Calc

Five calculators for Albion Online using Albion Online Data Project (AODP) prices: Black Market Flipper, Crafting Planner, Refining, Cooking, Alchemy.

## Web app
Open `web/index.html` in a browser (or host the `web/` folder anywhere static; it is also an installable PWA).
Pick your server (Americas / Asia / Europe) top-right. Every price box is editable; "Fetch latest/average prices" fills them from AODP. Shortcuts: A = fetch latest, S = fetch average, X = reset.

## Android app
`android/` is an Android Studio project that bundles the same web app in a WebView (all maths on-device).
- Android Studio: open `android/`, Run. Or `gradle -p android assembleDebug`.
- No tooling: push this folder to GitHub; `.github/workflows/build-apk.yml` builds an APK artifact.
- Quickest: host `web/` and use Chrome > "Add to Home screen".
After changing `web/`, run `sh tools/sync_android.sh`.

## Data
`tools/build_data.py` builds recipes from `tools/items.txt` + `tools/items.json` (ao-bin-dumps); `tools/build_journals.py` builds journal data.

## Known limits
- Crafting fame is an estimate (exact values are not in the game files); a calibration multiplier is provided.
- Mount capacity: Transport Mammoth (25,735 kg) or custom.
- Tests: `python3 tests/e2e.py` (needs playwright; uses a mocked API).
