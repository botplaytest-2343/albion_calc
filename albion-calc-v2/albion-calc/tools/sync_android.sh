#!/bin/sh
# Copies the web app into the Android project's assets (run after changing anything in /web).
set -e
cd "$(dirname "$0")/.."
rm -rf android/app/src/main/assets/www
mkdir -p android/app/src/main/assets/www
cp -r web/index.html web/css web/js web/data web/icons web/manifest.webmanifest android/app/src/main/assets/www/
echo "synced web -> android assets"
