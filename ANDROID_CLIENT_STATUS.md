# ANDROID_CLIENT_STATUS.md

_Last updated: 2026-09-04_

## Current architecture — Route A (roBrowserLegacy in a WebView)

```
APK  com.fatemmo.client
  └ MainActivity (Kotlin) → full-screen WebView
      → http://appassets.androidplatform.net/assets/web/index.html   (bundled in APK)
      → assets/web/ = roBrowserLegacy production build
      → assets/web/Config.local.js  generated at build time from  webview-app/client.env.properties
              │ ws://167.104.101.102:5999/          │ http://167.104.101.102:8000/
              ▼ wsProxy (on PROXY host)             ▼ Remote Client / 4 GRFs (on PROXY host)
              ▼ proxy 167.104.101.102 ─forwards─▶ MOBILE rAthena instance on main box
                (packetver 20180620, obfuscation OFF, same DB as the 20250716 main instance)
```
Main IP `51.79.147.208` is never exposed; everything client-facing is the proxy
`167.104.101.102`. Nothing from `RagnaFinest_v623.apk` or `FateMMO.exe` is reused —
only the GRFs (`Fate.grf` + `palettes.grf` + `hd.grf` + `data.grf`) and rAthena.

### Why a second rAthena instance
Main server is **PACKETVER 20250716** + packet obfuscation ON. roBrowserLegacy
only has packet tables to ~2021-2022 and no obfuscation support, so it must
connect to a separate instance built at **20180620** with obfuscation off,
sharing the same MySQL DB (accounts/chars shared). Full steps:
`AndroidClient/server-bundle/README.md §1`.

## This IS a standalone APK (not a browser)
`FateMMO-client-debug.apk` is a normal Android application: own launcher icon
("Fate MMO"), own process, opens fullscreen straight into the game — no browser
app, no address bar, no Chrome UI. The RO engine (roBrowserLegacy, WebGL) runs
inside the app's embedded WebView component, which is an internal rendering
surface, not "a browser" the user sees. Verified installing + launching as a
standalone app on the Android 14 emulator (`artifacts/emulator-launch.png`).
A fully-native (C/C++ `.so`) engine is not possible here — no native RO client
source was provided and the RagnaFinest engine is closed/packed.

## Current milestone  (server stack deployed + verified 2026-09-04)
- M1 Audit — **DONE**
- M2 Build project → APK — **DONE (VERIFIED)**
- M3 Launch — **DONE (VERIFIED, Android 14 emulator)**
- M4 Resource loading — **DONE (VERIFIED)** — RO login screen + character-select
  screen render from the 4 GRFs streamed by the Remote Client on the server.
- M5 Server connection — **DONE (VERIFIED)** — real traffic: APK → wsProxy(5999) →
  socat → mobile login-server(7900) → **auth OK (account auto-created)** → mobile
  char-server(7121) → char list received. wsProxy logs show the client IP
  connecting to 7900 then 7121.
- M6 Enter game — **PARTIAL** — character-select screen reached; character *creation*
  and map entry were not driven through the emulator (2 fps software GL + soft-keyboard
  covering the login window made scripted taps/typing unreliable). Map-server(7122) is
  up, connected to char, serving all 1242 maps. Best finished on a real device.
- M7–M8 — not started (real-device gameplay pass)
- M9 Debug APK — **DONE**; Release APK builds unsigned (signing = user's step).

Screenshots: `AndroidClient/artifacts/live-test-2.png` (login screen),
`live-test-5.png` (character-select). Full deployed topology:
`AndroidClient/server-bundle/DEPLOYED.md`.

## Completed work (this session)
1. Installed toolchain: JDK 17, Android SDK (platform 35, build-tools 35, platform-tools,
   emulator, `system-images;android-34;google_apis;x86_64`), Gradle 8.9, Node 24, Git.
2. Cloned + built **roBrowserLegacy** (`npm run build -O -H --m`) → `dist/Web/`.
3. Authored the Android app `AndroidClient/webview-app/` (Kotlin WebView shell,
   AGP 8.7.3 / Gradle 8.9, minSdk 24 / targetSdk 35, `arm64-v8a`+all ABIs — no native code).
4. Single-source-of-truth config `webview-app/client.env.properties` → Gradle task
   `generateRoBrowserConfig` writes `assets/web/Config.local.js`.
5. **Built `app-debug.apk`** → `AndroidClient/artifacts/FateMMO-client-debug.apk` (4.8 MB).
6. **Verified on emulator**: install OK, launch OK, no crash, WebView loads bundled
   roBrowser, `Renderer using WebGL 2 context`, config values injected correctly
   (`server=51.79.147.208, wsproxy=ws://51.79.147.208:5999/`), client attempts
   `http://51.79.147.208:8000/...` fetches (cleartext networking works; fails with
   ERR_CONNECTION_REFUSED only because the server side is down). Screenshot:
   `AndroidClient/artifacts/emulator-launch.png`.
7. Wrote server deployment kit `AndroidClient/server-bundle/` (docker-compose for
   wsProxy + PHP Remote Client, `DATA.INI`, wsProxy allow-list, rAthena patch + conf edits).

## Current blocker
**Server-side deployment — the user's to do.** See
`AndroidClient/server-bundle/README.md`. Summary:
1. Build a **second rAthena instance** for mobile: `PACKETVER 20180620`,
   `//#define PACKET_OBFUSCATION`, `--enable-prere`, pointed at the same MySQL DB;
   proxy forwards `167.104.101.102:{6900,6121,5121}` to it. (Main 2026 instance
   untouched → `FateMMO.exe` keeps working.)
2. On the **proxy host** deploy wsProxy (:5999) + PHP Remote Client (:8000) fed the
   4 GRFs; `docker compose up -d --build`.
3. Mobile-instance conf: `char_ip`/`map_ip` = `167.104.101.102`,
   `use_web_auth_token: no`, subnet line already correct; open proxy firewall
   5999/8000 + the 6900/6121/5121 forwards.

## Last successful build
`app-debug.apk` — 2026-09-04, via `AndroidClient/webview-app/gradlew.bat :app:assembleDebug`.

## Exact build command
```
. "C:\Users\This\Desktop\Android Project\AndroidClient\env.ps1"
cd "C:\Users\This\Desktop\Android Project\AndroidClient\webview-app"
.\gradlew.bat :app:assembleDebug
```

## APK output location
`AndroidClient/webview-app/app/build/outputs/apk/debug/app-debug.apk`
(published copy: `AndroidClient/artifacts/FateMMO-client-debug.apk`)

## Android requirements
minSdk 24 (Android 7.0), targetSdk 35, all ABIs (no native code), WebView with
WebGL2 (any modern Chromium WebView), INTERNET permission. Cleartext enabled for
private-server testing.

## Known issues
- Server side not deployed → client cannot pass the roBrowser preloader yet.
- PACKETVER / PC-client compatibility decision outstanding.
- `Fate.grf` GRF filename encoding assumed CP949 — verify with `php doctor.php --deep`
  in the Remote Client; switch to UTF-8 if korean-named textures 404.
- `DATA.ini` lists `palettes.grf`/`hd.grf`/`data.grf` which were not supplied — the
  bundled `server-bundle/remote-client/DATA.INI` lists only `Fate.grf`.
- Release APK is unsigned (by design — no keystore is created or committed).
- Emulator run used software GL (swiftshader); real-device GPU perf untested.
- Touch controls = whatever roBrowserLegacy provides natively (it has mobile input);
  no custom HUD added yet.

## Server recon (2026-09-04, via SSH)
**Main `51.79.147.208`** — Debian 13, 2 vCPU / 3.7 GB RAM / **no swap** / 32 GB free.
rAthena at `/home/debian/FateRO/` run as bare `./login-server`/`./char-server`/`./map-server`
(pids alive), ports 6900/6121/5121 + web-server 8888, all `0.0.0.0`. MariaDB 11.8 on
127.0.0.1:3306. Apache on :80. gcc 14 / cmake 3.31 / git present → can build rAthena.
**No Docker. No Node. No PHP-cli confirmed.** **No GRF files anywhere on the box.**

**Proxy `167.104.101.102`** — Debian 13, **1 vCPU / 1.9 GB RAM / no swap / 8.3 GB free**
(too small to host GRFs). Forwarding = custom `/opt/ragnarok-proxy/proxy.py`
(systemd `ragnarok-proxy.service`, config `/opt/ragnarok-proxy/config.json`) — a
Python TCP proxy that forwards **only** login/char/map (6900/6121/5121) to the main
IP, with per-IP rate-limiting + nftables bans + a Discord alert webhook. `socat`
installed; no docker/node/php.

### Revised deployment (fits what's actually there)
- **wsProxy + PHP Remote Client run on the MAIN box** (disk+RAM+webserver already there),
  bound to 5999 / 8000, firewalled to accept only the proxy IP.
- **Proxy**: two tiny `socat` systemd units forward `167.104.101.102:5999→main:5999`
  and `:8000→main:8000` (leave the custom `proxy.py` untouched).
- **Mobile rAthena**: 2nd checkout under `/home/debian/FateRO-mobile`, `PACKETVER
  20180620`, obfuscation off, **its own ports** (7900/7121/7122 to avoid clashing
  with the live 6900/6121/5121) sharing the same MariaDB; proxy forwards those.
  Build needs a temporary 2 GB swapfile on main (reversible) + `-j1`.
- **GRFs**: not on any server. `Fate.grf` (1.7 GB) is only in `Client/FateMMO.zip`
  here; `palettes.grf`/`hd.grf`/`data.grf` are nowhere accessible. **BLOCKER —
  need the user to put the GRFs on the main server or give a download URL.**

### Security notes for the user
- Same password on both hosts, now sent in plaintext this session → rotate it.
- `config.json` on the proxy holds a live Discord webhook + a monitoring API token
  (visible to anyone who can read that file).

## Next action
**User:** deploy `AndroidClient/server-bundle/` on 51.79.147.208 and pick the
PACKETVER option. Then install `FateMMO-client-debug.apk` on a device and run
`adb logcat -s FateMMO chromium` while reaching the login screen. Report back the
log and we continue at M5→M6 (login → char select → enter map).
