# AndroidClient — Fate MMO Android client (Route A: roBrowserLegacy + WebView)

```
AndroidClient/
├── webview-app/            ← the Android Studio / Gradle project (the APK)
│   ├── client.env.properties   ← EDIT THIS: server IP, ports, packetver, renewal
│   ├── app/                     ← Kotlin WebView shell + build.gradle.kts
│   └── gradlew[.bat]            ← build with:  gradlew :app:assembleDebug
├── server-bundle/         ← deploy on 51.79.147.208 (wsProxy + Remote Client + rAthena patch)
│   └── README.md               ← server setup runbook  ← START HERE for the backend
├── artifacts/
│   ├── FateMMO-client-debug.apk ← built & emulator-verified 2026-09-04
│   └── emulator-launch.png      ← proof-of-launch screenshot
├── vendor/                ← upstream checkouts (roBrowserLegacy, wsProxy, RemoteClients)
└── env.ps1               ← dot-source to get JDK/SDK/Gradle on PATH
```

## Build
```powershell
. .\env.ps1
cd webview-app
.\gradlew.bat :app:assembleDebug
```
Output: `webview-app/app/build/outputs/apk/debug/app-debug.apk`.
See `../ANDROID_CLIENT_BUILD.md` for the full toolchain + signing notes.

## Status
`../ANDROID_CLIENT_STATUS.md`. Client side builds and launches (verified). Server
side (`server-bundle/`) must be deployed before login works.

## Licensing
roBrowserLegacy, wsProxy and the Remote Clients are GNU GPL v3. The `webview-app/`
wrapper is your own code. `RagnaFinest_v623.apk` and `FateMMO.exe` are NOT used here.
