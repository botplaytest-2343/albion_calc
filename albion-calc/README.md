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

## What's new (v2)
- Refining: "Craft previous tiers yourself" with a start tier and a stage-by-stage cost breakdown; stone blocks offer the enchanted-rock recipes (.1 = 2 blocks, .2 = 4, .3 = 8) plus a "Cheapest" recipe picker.
- Cooking: cost fish sauce from chopped fish + seaweed (buy the chops or chop a fish yourself).
- Alchemy: cost arcane extracts from animal remains, bought or made by breaking artifacts, including step-down routes (T7 -> 2xT5 -> 4xT3) with a route-cost table.
- Black Market Flipper: tier 3, most/least profitable ordering, page tabs (50 or 100 per tab), and a Craft scan that finds items you can craft cheaper than the Black Market pays.
- Everything starts blank: no pre-filled cities, fees, toggles or recipes, and nothing is restored from earlier sessions (`PERSIST` in `web/js/core.js`; set it to `true` to remember settings again).
- Planner and all tools: fluid font size that follows screen size and orientation; item names no longer break letter by letter on phones.

## GitHub APK build
Push the whole folder (`.github/`, `android/`, `web/`) to a repo and run the "Build Android APK" workflow; the APK is in the run's Artifacts. The workflow no longer needs `tools/`.

## Data
`tools/build_data.py` builds recipes from `tools/items.txt` + `tools/items.json` (ao-bin-dumps); `tools/build_journals.py` builds journal data; `tools/build_extras.py` builds fish sauce / animal remains / arcane extract data.

## Known limits
- Crafting fame is an estimate (exact values are not in the game files); a calibration multiplier is provided.
- Mount capacity: Transport Mammoth (25,735 kg) or custom.
- Tests: `python3 tests/e2e.py` (needs playwright; uses a mocked API).
