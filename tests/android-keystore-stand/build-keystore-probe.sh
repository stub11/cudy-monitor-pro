#!/bin/sh
set -eu

sdk=${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK with platform 36 and build-tools 35.0.0}
out=${1:?Pass the absolute output directory}
case "$out" in /*) ;; *) printf '%s\n' 'Use an absolute output directory' >&2; exit 1 ;; esac
mkdir -p "$out"
work=$(mktemp -d "$out/.probe-XXXXXX")
trap 'rm -rf "$work"' EXIT
tools="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-36/android.jar"
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

mkdir "$work/classes"
java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -classpath "$platform" \
  -d "$work/classes" "$source_dir/KeystoreProbe.java"
"$tools/d8" --min-api 26 --lib "$platform" --output "$work" \
  "$work/classes/dev/cm/monitor/cloudstand/KeystoreProbe.class"
"$tools/aapt2" link -I "$platform" --manifest "$source_dir/KeystoreProbeManifest.xml" -o "$work/packed.apk"
(cd "$work" && "$tools/aapt" add packed.apk classes.dex)
"$tools/zipalign" -p 4 "$work/packed.apk" "$work/aligned.apk"

keytool -genkeypair -keystore "$work/probe.p12" -storetype PKCS12 -storepass standalone-test \
  -alias probe -keyalg EC -dname 'CN=Aurora local instrumentation test' -validity 30 >/dev/null
"$tools/apksigner" sign --ks "$work/probe.p12" --ks-pass pass:standalone-test \
  --out "$work/aurora-keystore-probe.apk" "$work/aligned.apk"
"$tools/apksigner" verify "$work/aurora-keystore-probe.apk"
mv "$work/aurora-keystore-probe.apk" "$out/aurora-keystore-probe.apk"
