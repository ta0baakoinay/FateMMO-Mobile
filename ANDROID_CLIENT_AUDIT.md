# ANDROID_CLIENT_AUDIT.md

Audit date: 2026-09-04
Auditor: lead Android/RO client engineer (automated inspection)
Status of this document: **Milestone 1 (Audit) — complete**

---

## 0. TL;DR / most important findings

| # | Finding | Impact |
|---|---------|--------|
| 1 | **No client source code exists in the workspace.** Only compiled binaries: `FateMMO.exe` (Windows) and `RagnaFinest_v623.apk` (Android). | We cannot "build the client from source". Any plan that says "compile the supplied client" is impossible as written. |
| 2 | `RagnaFinest_v623.apk` is a **closed-source, commercial "RO Workshop" native engine**, packed/obfuscated, with anti-emulator + anti-tamper code and a telemetry/licensing beacon to `http://37.27.134.42/...`. It is built for a **different** server ("RagnaFinest"), not this one. | It is not a usable base. Repacking it = cracking a commercial product; it will also fail its own integrity/anti-tamper checks and cannot be re-signed cleanly. |
| 3 | `FateMMO.exe` is a **Windows DirectX client** built from a C++20 codebase (`C:\repositories\RagnarokClient\RagnarokClient\Release V142 C++20\Ragexe.pdb`). Source not provided. | Not portable to Android without its source + a multi-month DirectX→OpenGL ES port. |
| 4 | The **rAthena server source IS complete and buildable** (Linux/Windows). `PACKETVER 20250716`, packet obfuscation ON (default keys), web auth-token API ON. | Server side is in good shape. The client must match packetver 2025-07-16 and use rAthena default obfuscation keys. |
| 5 | `Fate.grf` is a **standard unencrypted GRF v0x200**, ~135,900 files, 1.7 GB. Readable by any standard GRF library. | Good — resources are usable directly by an open client (e.g. roBrowser) or an extraction pipeline. |
| 6 | **No Android/Java build environment is installed** (no JDK, no Android SDK/NDK, no Gradle, no adb, no Node). `winget` and `.NET 8 SDK` are available. | A toolchain must be installed before any APK can be produced. Needs user approval + network + ~several GB disk. |
| 7 | No `clientinfo.xml` in the server pack. It lives client-side (inside `Fate.grf` as `data/clientinfo.xml`, or external to the exe). Not yet extracted. | Follow-up task. |

**Bottom line:** The three supplied artifacts belong to three *different* clients. There is no "the source" to turn into "the APK". A working Android client that connects to this server has to be **assembled from an open-source RO client** (realistically **roBrowserLegacy**) using `Fate.grf` for resources, or obtained officially from a commercial vendor. See `ANDROID_CLIENT_STATUS.md` for the decision that is blocking implementation.

---

## 1. Complete workspace structure

```
c:\Users\This\Desktop\Android Project\
├── RagnaFinest_v623.apk         5,075,882 bytes   Android APK (see §3)
├── Client\
│   └── FateMMO.zip           1,232,564,075 bytes   Windows client bundle (see §4)
│       ├── DATA.ini                    52 bytes
│       ├── Fate.grf         1,697,312,630 bytes    GRF resource archive (see §5)
│       └── FateMMO.exe         16,147,456 bytes    Windows RO client executable (see §4)
└── Server\
    └── Fate MMO Source Code.zip  155,646,464 bytes rAthena server source (see §6)
        └── (3,206 entries — standard rAthena tree: conf/, src/, db/, npc/,
             sql-files/, 3rdparty/, tools/, prebuilt web-server/char-server/
             map-server binaries)
```

There is **no `.git`** anywhere; nothing is under version control.

---

## 2. Build environment status

| Tool | Present? | Notes |
|------|----------|-------|
| JDK / `java` / `javac` | ❌ | Required for any APK build / `apksigner` / `apktool`. |
| Android SDK / `adb` / `aapt2` | ❌ | `ANDROID_HOME` / `ANDROID_SDK_ROOT` unset. |
| Android NDK / CMake / Ninja | ❌ | Needed only for native (.so) builds. |
| Gradle | ❌ | `kotlin-tooling-metadata.json` in the APK shows it was built with Gradle 8.10.2 / AGP-era, Kotlin 1.8.22, Java 17. |
| `apktool` | ❌ | |
| Node.js / npm | ❌ | Needed for the roBrowser route. |
| Python | ❌ | Only the Windows Store stub alias. |
| .NET SDK | ✅ 8.0.19 | Usable for binary/zip/strings analysis (used for this audit). |
| `winget` | ✅ 1.29.290 | Can install JDK, Android cmdline-tools, Node, etc. (needs approval + network). |
| Chocolatey | ❌ | |

**Platform:** Windows 11 Pro (26200), PowerShell 5.1.

---

## 3. `RagnaFinest_v623.apk` — existing APK analysis

**Extraction note:** the APK does not fully unzip on a case-insensitive filesystem (obfuscated resources `res/0n.xml` vs `res/0N.xml` collide) — a hallmark of R8 resource shrinking/obfuscation.

### 3.1 Identity
| Property | Value |
|----------|-------|
| Package | `com.roworkshop.andro.finest` |
| Application class | `com.roworkshop.androloader.MainApplication` |
| Launcher activity | `com.roworkshop.andro.v2015.c_main_activity` |
| Vendor | **RO Workshop** (`roworkshop` — commercial Android RO client engine) |
| Emulated client generation | `andro.v2015` (2015-era packet/UI base) |
| Build | Gradle 8.10.2, Kotlin 1.8.22, Java 17, `buildPlugin: KotlinAndroidPluginWrapper` |
| Permissions | `INTERNET`, `DUMP`, `READ_EXTERNAL_STORAGE` (maxSdk), `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`, `requestLegacyExternalStorage`, `largeHeap`, `usesCleartextTraffic=true` |
| Features | `android.hardware.touchscreen.multitouch` (required), `glEsVersion` (OpenGL ES game renderer) |

### 3.2 Code layout
- **`classes.dex` is a 2,108-byte stub.** It contains only `com/roworkshop/androloader/MainApplication` and `com/roworkshop/ro/mylib`. **All real logic is native.**
- Native libraries (per ABI: `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`):
  | lib | size (arm64) | role (inferred) |
  |-----|--------------|-----------------|
  | `libmylib.so` | 457,632 | packed RO client engine (≈0 readable strings → protected/packed) |
  | `libnatives.so` | 358,464 | native bridge / anti-tamper; contains `http://37.27.134.42/processing/proc.php?key=` beacon |
  | `libluajava.so` | 235,264 | Lua⇄Java bridge (runs RO `.lub` scripts) |
  | `libluajava50.so` | 210,696 | Lua 5.0 variant |
  | `libtoolChecker.so` | 5,512 | emulator/root/hook detector |
- `AndroidManifest` `<queries>` enumerates dozens of **auto-clicker, emulator (BlueStacks, MEmu, Nox, MuMu, LDPlayer, Genymotion, VMOS), and cloud-gaming packages** → active anti-cheat / anti-emulator.

### 3.3 Bundled assets (5 MB APK — **no game data**)
- RO Lua tables: `jobname.lub`, `jobinheritlist.lub`, `jobskilltab.lub`, `npcidentity.lub`, `skillid.lub`, `stateiconimginfo.lub`, `stateiconinfo_f.lub`
- Text tables: `EMSG.txt`, `MSI.txt` (client message strings), `NameColors.txt`
- `image/splashscreen.png` (1.8 MB), `menu_icon/*` (touch HUD icons: chatroom, emotion, friend)
- **No GRF, no sprites, no maps, no BGM, no `clientinfo`.** → the engine **downloads game resources at first run** from a patch endpoint baked into the packed `libmylib.so` (not visible without unpacking).
- Java deps present via `META-INF`: androidx appcompat/recyclerview/viewpager2/cardview, kotlinx-coroutines, Apache HttpClient 5 (`org/apache/hc`), commons-validator, publicsuffix list → HTTP patcher + list/table UI.

### 3.4 Assessment
- **Source availability:** none (binary only, packed, obfuscated).
- **Built from the supplied source?** No — there is no source, and this engine is unrelated to `FateMMO.exe`.
- **Server match?** No. Different server ("RagnaFinest" / RO Workshop hosted), 2015 packet base vs this server's `PACKETVER 20250716`.
- **Reusable as a base?** **No.** Repacking requires defeating the packer, the `libtoolChecker`/`libnatives` integrity checks, and re-signing — i.e. cracking a commercial product. Not a supported, legal, or reliable path.
- **Value as reference:** confirms a *native* Android RO engine is feasible and shows the expected asset set (lub tables, message txt, touch HUD icons). Nothing more.

---

## 4. `FateMMO.exe` + `DATA.ini` — Windows client analysis

### 4.1 `DATA.ini`
```
[Data]
0=Fate.grf
1=palettes.grf     <- NOT supplied
2=hd.grf           <- NOT supplied
3=data.grf         <- NOT supplied
```
Only `Fate.grf` is present. The other three are expected to be standard kRO archives the user did not include (may or may not be needed depending on whether `Fate.grf` is fully self-contained).

### 4.2 `FateMMO.exe`
| Property | Value |
|----------|-------|
| Type | Windows PE, 16.1 MB, DirectX (`Cannot init d3d OR grf file has problem.`) |
| Origin | Built from C++20 source — PDB: `C:\repositories\RagnarokClient\RagnarokClient\Release V142 C++20\Ragexe.pdb` (a community C++ "RagnarokClient" re-implementation, **source not supplied**) |
| Manifest name | `Ragexe` |
| Auth | rAthena **web auth-token** flow: `%s?AID=%d&AuthToken=%s`, symbols `AVlcCSAuthToken`, `CNProtectGameGuardMgr` (GameGuard manager present, likely stubbed) |
| Reads | `data.grf`, `event.grf`, `clientinfo`, `langtype` |
| Renderer | Direct3D |

### 4.3 Assessment
- **Not Android-portable** without its source. Even with source: DirectX renderer, Win32 window/input, Windows sockets → substantial port (rendering backend, input, filesystem, audio, threading), months of work, out of scope for a "smallest working version".
- Useful as: the **reference for packet version, clientinfo, and GRF layout** the server expects. `Fate.grf` is its data and is fully reusable.

---

## 5. `Fate.grf` — resource archive analysis

Header bytes (offset 0):
```
"Master of Magic\0"  + key 00..0e (unencrypted)
file-table offset = 0x6510BE30  (~1.70 GB — matches file size)
seed = 0
filecount field = 0x000210FF  (=> ~135,935 entries)
version = 0x00000200           (GRF v2.0 — standard modern format, zlib per-file)
```

| Property | Value |
|----------|-------|
| Format | GRF v0x200, **not encrypted**, standard zlib entries |
| Entries | ~135,900 |
| Size | 1,697,312,630 bytes (1.58 GiB) |
| Compatibility | Readable by **any** standard GRF implementation: roBrowserLegacy loader, GRF Editor, `libgrf`, Tokei's grf tools, etc. |
| `clientinfo.xml` | Not yet extracted — expected at `data\clientinfo.xml` inside this GRF. **Follow-up.** |

### 5.1 Handling decision (preliminary)
- **Do NOT embed in an APK.** 1.6 GiB dwarfs any reasonable APK and Play limits; even for sideload it is wasteful and slow.
- **Preferred:** keep `Fate.grf` intact and serve/stream it (roBrowser reads GRF over HTTP with range requests) **or** run a one-time **extraction pipeline** into a flat `data/` tree stored in app-specific external storage on first run.
- Final decision deferred until the client architecture is chosen (see status doc).

---

## 6. `Fate MMO Source Code.zip` — server analysis

Standard **rAthena** source tree (3,206 files). Not a fork with heavy source edits visible in the customization hooks:

| File | Content |
|------|---------|
| `src/custom/defines_pre.hpp` | `#define PACKETVER 20250716` |
| `src/custom/defines_post.hpp` | empty |
| `src/config/packets.hpp` | default `PACKETVER 20250604`; **`PACKET_OBFUSCATION` enabled** (PACKETVER ≥ 2011-08-17); obfuscation keys **not** overridden → rAthena **default keys** in `src/config/secure/*` |
| `conf/login_athena.conf` | `login_port: 6900`; `new_account: yes`; `use_web_auth_token: yes`; `client_hash_check: off` |
| `conf/char_athena.conf` | `char_port: 6121`; `server_name: rAthena`; `pincode_enabled: no`; renewal start points (`iz_int...`) + `start_point_pre` |
| `conf/map_athena.conf` | `map_port: 5121`; `use_grf: no` (mapcache-based) |
| `conf/inter_athena.conf` | MySQL `admin/admin`, DBs `ragnarok_main` / `ragnarok_web` / `ragnarok_logs` |
| `conf/subnet_athena.conf` | `subnet: 255.0.0.0:127.0.0.1:127.0.0.1` and a stray `255.255.255.255:167.104.101.102:...` (likely leftover placeholder) |
| `conf/grf-files.txt` | all entries commented (server uses mapcache, not GRF) |
| prebuilt binaries | `web-server`, `char-server`, `map-server` present (Linux ELF, ~7–17 MB) — pack was last built on Linux |

### 6.0 CORRECTION (post-audit, 2026-09-04)
`src/config/renewal.hpp` line 8 has **`#define PRERE` active** → this server
builds **pre-renewal**, not renewal. `./configure` was run (a `config.status`
file is present). Renewal-looking `start_point`s in `char_athena.conf` are the
non-`_pre` variants that pre-renewal ignores. Client must be configured
`renewal: false`.

### 6.1 Client compatibility requirements derived from the server
- Client **packet version must be 2025-07-16** (or close, and known to rAthena's packet tables).
- Client must apply rAthena's **default packet-obfuscation keys** (or the server's obfuscation must be disabled in `packets.hpp` — a documented one-line change).
- Client must perform the **HTTP web-auth-token** step (`use_web_auth_token: yes`) — served by the rAthena **char/web API**. A client that doesn't (older roBrowser, 2015 clients) needs `use_web_auth_token: no`.
- Renewal mechanics (start points/items indicate a renewal build).
- Login/char/map ports: **6900 / 6121 / 5121**.
- **Public server IP/hostname: not in the pack** — must be provided by the user (currently only loopback + a placeholder).

---

## 7. Architecture determination (per master-prompt §5)

**The workspace contains three unrelated clients and one server:**

1. `FateMMO.exe` — Windows/Direct3D client from an unshared C++20 "RagnarokClient" source, matched to the rAthena server (packetver 2025, auth-token). *Binary only.*
2. `RagnaFinest_v623.apk` — closed commercial **RO Workshop** native Android engine (2015 base), matched to a **different** server, packed + anti-tamper + anti-emulator. *Binary only.*
3. rAthena server — full source, `PACKETVER 20250716`, renewal, obfuscation on, auth-token on.

There is **no Android client source, and no shared lineage** between the APK and the exe. Therefore none of the master-prompt possibilities "build the supplied Android project" / "port the supplied client" / "reuse the existing engine" are actionable with what is here.

### Feasible routes to "playable RO on Android → this server"

| Route | Uses supplied materials | Legal / open | Buildable by us | Effort | Notes |
|-------|------------------------|--------------|-----------------|--------|-------|
| **A. roBrowserLegacy + WebSocket proxy + Android WebView/TWA wrapper** | ✅ `Fate.grf`, ✅ server | ✅ (GPL/MIT) | ✅ (needs Node + JDK/SDK install) | **Medium** | Only route that turns the *provided* assets into an Android client we can actually build. Needs a host for the client bundle + `wsproxy`. Packetver 2025 may need packet-map tweaks; may set `use_web_auth_token: no`. Perf on phones = moderate. |
| B. License the RO Workshop / other commercial Android client for this server | ❌ | ✅ (paid) | ❌ (vendor-built) | Low (procurement) | Not something engineered here. |
| C. Repack/re-point `RagnaFinest_v623.apk` | partial | ❌ (circumvents a commercial protected product) | ❌ (packer + anti-tamper + re-sign) | High + fragile | Not recommended. Will not pass its own integrity checks. |
| D. Obtain the `RagnarokClient` C++20 source and port Direct3D→GLES to Android | ✅ | ✅ if source is licensed so | ❌ today (no source) | Very high (months) | Real native client, but far beyond a first working build and blocked on missing source. |

**Recommended:** **Route A (roBrowserLegacy)** unless the user tells us they have rights to route B/C or can supply the `RagnarokClient` source for route D.

---

## 8. Required changes / work items (for Route A — provisional)

1. Install toolchain: JDK 17, Android SDK (cmdline-tools + platform 34/35 + build-tools), Node.js LTS. (Android Studio optional.)
2. Stand up **roBrowserLegacy** (client web app) configured for this server: `PACKETVER` 2025-07-16 mapping, remote-client pointing at `Fate.grf` (served with HTTP range support) or an extracted `data/` tree.
3. Stand up a **TCP⇄WebSocket proxy** (`@rob-browser/wsproxy` / roBrowser `wsproxy`) in front of login 6900 / char 6121 / map 5121.
4. Server-side, minimal, reversible, documented:
   - Set the public **IP/host** (login/char/map advertised addresses).
   - Decide `use_web_auth_token` (likely `no` for roBrowser) — one line, reversible.
   - Confirm/disable **packet obfuscation** to match roBrowser's capability — one line in `src/config/packets.hpp`, reversible, requires server rebuild.
   - Ensure `clientinfo`-equivalent config in roBrowser matches server name/ports.
5. Centralised client config file (server host, ports, packetver, grf path) — no scattered IPs.
6. Android wrapper: a minimal WebView/TWA app (Kotlin, single activity, `usesCleartextTraffic` for LAN test, fullscreen/immersive, keep-screen-on, back-key handling, file/asset bridge if resources are bundled).
7. Extract `data/clientinfo.xml` + relevant `data/lua files/` from `Fate.grf` to confirm server name/version and job/skill tables.
8. Package debug APK; document exact commands; test flow login→char→map on device/emulator.

---

## 9. Important unknowns / follow-ups

1. **Which route** (A/B/C/D) — needs a user decision (see `ANDROID_CLIENT_STATUS.md` §Blocker).
2. Does the user operate the "RagnaFinest" server / hold any RO Workshop license? (Determines whether route C is even discussable.)
3. Is the `RagnarokClient` C++20 client **source** available to the user? (Unlocks route D.)
4. Public **hostname/IP** of the live server, and is it reachable from a test device?
5. Is a **WebView-based** client acceptable, or is a **native** client a hard requirement?
6. `data/clientinfo.xml` contents inside `Fate.grf` (not yet extracted).
7. Whether `Fate.grf` is self-contained or needs `data.grf` / `palettes.grf` / `hd.grf`.
8. Is the server **renewal** (compile flag in `src/config/renewal.hpp` — not yet read)?
9. rAthena default obfuscation key values (in `src/config/secure/` — not yet read) and whether the existing `FateMMO.exe` matches them (it presumably does).
10. Target Android versions / devices the user cares about.
