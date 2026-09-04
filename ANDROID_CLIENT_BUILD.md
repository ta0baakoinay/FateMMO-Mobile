# ANDROID_CLIENT_BUILD.md

How to build the Fate MMO Android client (Route A — roBrowserLegacy in a WebView).

---

## 1. Architecture (what actually got built)

```
 ┌─────────────────────────── APK (com.fatemmo.client) ───────────────────────────┐
 │  MainActivity (Kotlin)  →  full-screen WebView                                   │
 │      loads  http://appassets.androidplatform.net/assets/web/index.html          │
 │      (served from APK assets by androidx.webkit WebViewAssetLoader)              │
 │                                                                                 │
 │  assets/web/  =  roBrowserLegacy production build (Online.js, ThreadEventHandler │
 │                  .js, PathFindingWorker.js, index.html, Config.js)              │
 │  assets/web/Config.local.js  =  GENERATED at build time from                     │
 │                  webview-app/client.env.properties                              │
 └─────────────────────────────────────────────────────────────────────────────────┘
                    │ ws://51.79.147.208:5999/        │ http://51.79.147.208:8000/
                    ▼                                  ▼
            wsProxy (TCP bridge)                Remote Client (GRF asset HTTP)
                    │                                  reads  Fate.grf
                    ▼
        rAthena  login 6900 / char 6121 / map 5121   (obfuscation OFF, PACKETVER matched)
```

Nothing from `RagnaFinest_v623.apk` or `FateMMO.exe` is used. The only supplied
material reused is **`Fate.grf`** (by the Remote Client) and the **rAthena
server**.

## 2. Environment (installed on this machine 2026-09-04)

| Tool | Version | Location |
|------|---------|----------|
| JDK | Microsoft OpenJDK 17.0.20.1 | `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot` |
| Android SDK | platform-tools, `platforms;android-35`, `build-tools;35.0.0` (+34.0.0 pulled by AGP), `emulator`, `system-images;android-34;google_apis;x86_64` | `C:\Android\sdk` |
| Gradle | 8.9 | `C:\Gradle\gradle-8.9` |
| Android Gradle Plugin | 8.7.3 (from Google maven, fetched on first build) | — |
| Kotlin | 1.9.24 | — |
| Node.js | 24.19.0 / npm 11.17 | `C:\Program Files\nodejs` |
| Git | 2.55 | `C:\Program Files\Git` |

`AndroidClient/env.ps1` sets `JAVA_HOME` / `ANDROID_HOME` / `PATH` for a shell —
dot-source it before building: `. .\env.ps1`

SDK component versions are also pinned in
`AndroidClient/webview-app/gradle/wrapper/gradle-wrapper.properties` (Gradle) and
`app/build.gradle.kts` (`compileSdk 35`, `minSdk 24`, `targetSdk 35`).

## 3. Build the web bundle (only when roBrowser is updated)

```powershell
. "AndroidClient\env.ps1"
cd AndroidClient\vendor\roBrowserLegacy
npm install
node .\applications\tools\builder-web.mjs -O -H --m     # -> dist/Web/*  (minified)
Copy-Item dist\Web\* ..\..\webview-app\app\src\main\assets\web\ -Force
```
(`icon.png` in that folder is a 1×1 placeholder referenced by `index.html`.)

## 4. Build the APK

```powershell
. "AndroidClient\env.ps1"
cd AndroidClient\webview-app
.\gradlew.bat :app:assembleDebug          # debug  -> app\build\outputs\apk\debug\app-debug.apk
.\gradlew.bat :app:assembleRelease        # release (UNSIGNED) -> ...\release\app-release-unsigned.apk
```
Build task `generateRoBrowserConfig` regenerates `assets/web/Config.local.js`
from `client.env.properties` on every build — that file is the **only** place
server IP / ports / packetver / renewal are configured.

Current debug output is copied to
`AndroidClient/artifacts/FateMMO-client-debug.apk`.

## 5. Signing the release APK (you must do this — no keys are committed)

```powershell
& "$env:JAVA_HOME\bin\keytool" -genkeypair -v -keystore fatemmo-release.jks `
    -keyalg RSA -keysize 2048 -validity 10000 -alias fatemmo
# then:
& "C:\Android\sdk\build-tools\35.0.0\apksigner" sign `
    --ks fatemmo-release.jks --out FateMMO-release.apk `
    app\build\outputs\apk\release\app-release-unsigned.apk
& "C:\Android\sdk\build-tools\35.0.0\apksigner" verify --verbose FateMMO-release.apk
```
Keep `fatemmo-release.jks` + its passwords out of version control and backed up
(losing it means you can never update the app on the same identity).
To wire it into Gradle, add a `signingConfigs { create("release") { ... } }`
block reading from `~/.gradle/gradle.properties` (never from a tracked file).

## 6. Install / test

```powershell
. "AndroidClient\env.ps1"
adb install -r AndroidClient\artifacts\FateMMO-client-debug.apk
adb shell am start -n com.fatemmo.client.debug/com.fatemmo.client.MainActivity
adb logcat -s FateMMO:V chromium:V AndroidRuntime:E
```
`FateMMO` tag logs: target URL, load progress, every JS `console.*` line from
roBrowser, and main-frame load errors.

## 7. Re-pointing to a different server later

1. Edit `AndroidClient/webview-app/client.env.properties`.
2. `.\gradlew.bat :app:assembleDebug`
3. On the server, update wsProxy's `-a` allow-list to the new `ip:port`s.

See `AndroidClient/server-bundle/README.md` for the server side.
