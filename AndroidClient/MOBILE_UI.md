# Mobile UI + chat-bug pass (2026-09-04)

## Architecture reality (audit result)

"The existing project" = a Kotlin **WebView shell** + **roBrowserLegacy** (JS/WebGL RO
client). There is no native Android game engine, no native input/HUD. So every
gameplay-UI change is a change to **roBrowserLegacy's own JS**, rebuilt into
`Online.js` and re-bundled into the APK.

Good news from the audit: roBrowserLegacy **already ships**
`src/UI/Components/MobileUI/` (joystick + skill buttons + attack/pickup/talk-NPC +
touch-targeting + auto-target/-follow HUD) and a separate `src/UI/Components/JoystickUI/`
(physical-gamepad support). The mobile layer was just **not being switched on**, and
its joystick was **not multi-touch safe**. This pass enables + hardens it; it is not
a from-scratch rebuild.

`ragnafinest.apk` = the closed, packed **RO Workshop** native engine. Its mobile UX
is baked into proprietary `.so` code — usable only as a *behavioural* reference, not
a source of code or assets. So "1:1 with RagnaFinest" is an iterative target, not a
one-pass deliverable.

---

## A. NPC_Titles.txt in public chat — ROOT CAUSE (fixed)

**Trigger (server, legitimate feature):** `npc/custom/NPC_Titles.txt` is an rAthena
script that puts a floating label over ~50 town NPCs. It loops
`showscript .@bubble_text$[.@i], .@gid;` then `sleep(1000)` — forever. Each
`showscript` emits packet **`ZC_SHOWSCRIPT` (0x08b3)** to nearby clients (~50/sec).

**Bug (client):** `src/Engine/MapEngine/Entity.js` hooked **both**
`PACKET.ZC.NOTIFY_CHAT` (real local/public chat) **and** `PACKET.ZC.SHOWSCRIPT`
(floating text over an entity) to the **same handler `onEntityTalk`**, which
unconditionally runs:
```js
ChatBox.addText(pkt.msg, ChatBox.TYPE.PUBLIC, ChatBox.FILTER.PUBLIC_CHAT, null, false);
```
So every floating-label refresh was written into the public chat log → the "spam".

**Fix (root cause, not a filter):** split the handlers.
`SHOWSCRIPT` now has its own `onEntityShowScript()` that only calls
`entity.dialog.set(msg)` (the head bubble) and **never** touches the ChatBox.
`NOTIFY_CHAT` keeps its existing behaviour. The server script is unchanged — its
labels now render as intended (floating text over the NPCs), not as chat.

---

## B. Files changed

| File | Change |
|------|--------|
| `vendor/roBrowserLegacy/src/Engine/MapEngine/Entity.js` | New `onEntityShowScript(pkt)` — sets the entity head-bubble only. `Network.hookPacket(PACKET.ZC.SHOWSCRIPT, …)` re-pointed from `onEntityTalk` → `onEntityShowScript`. |
| `vendor/roBrowserLegacy/src/Core/Mobile.js` | Added `forceMobileControls()` — sets `Session.isTouchDevice = true` immediately when `ROConfig.mobileUI === true` **or** the platform reports touch, instead of only on the first `touchstart`. |
| `vendor/roBrowserLegacy/src/UI/Components/MobileUI/MobileUI.js` | Joystick rewritten for **multi-touch**: locks to the exact pointer (`touch.identifier` / `'mouse'`) that started on it and ignores all other pointers (left thumb = move, right thumb = skills, no cross-talk); accepts touch anywhere in `#joystickContainer`, not just the small thumb; handles `touchcancel`; analog magnitude re-normalised beyond a 12 px dead zone; re-reads base size on each grab (resolution/rotation safe). |
| `webview-app/app/build.gradle.kts` | Generated `Config.local.js` now includes `mobileUI: true`. |
| **server** `~/FateRO-mobile/conf/packet_athena.conf` | `stall_time: 60 → 300` (client isn't dropped during a slow first-map asset stream). |
| **server** `fatemmo-remoteclient.service` | `CACHE_ENABLED`, `INDEX_CACHE_ENABLED` (114 MB persistent GRF index), `WARM_CACHE`, `MEMORY_LIMIT=3072M`. Plus partial pre-extraction of ~35 common maps' `.gat/.gnd/.rsw` to `~/remote-client/data/`. |

Nothing else in roBrowser was touched — GRF loading, rendering, packets, login,
char-select, game logic all unchanged.

## C. Movement (virtual joystick)

roBrowser MobileUI joystick, now force-enabled + multi-touch-hardened:
touch anywhere in the bottom-left joystick zone grabs it; thumb follows the finger
clamped to the base radius; **direction** = stick angle rotated by the current camera
facing; **analog** = magnitude past a 12 px dead zone renormalised 0→1; while held, a
`CZ_REQUEST_MOVE(2)` toward a tile ~3 cells out in that direction is sent every
100 ms (skips resend if the target tile is unchanged and validates walkability);
release / `touchcancel` snaps the thumb home and stops. The joystick ignores every
touch except the one that grabbed it, so skill taps with the other thumb don't move
the stick.

## D. Skills (current state — drag-to-cast still TODO)

Enabled now: MobileUI skill grid (F1–F9 / 1–9 / Q–O / A–L rows, 4 switchable sets)
where a tap fires that RO hotbar slot; an **Attack** button (targets nearest / focused
mob and closes to range); **auto-target** and **touch-targeting** toggles; **pick-up**
and **talk-to-nearest-NPC** buttons.

**Not yet done:** touch-hold-drag on a skill → targeting mode → aim → release to cast
at the entity / ground cell, with range indicator. This needs new code wiring the
MobileUI skill buttons into roBrowser's `SkillTargetSelection` / ground-select
machinery, and is the next focused task.

## E. HUD

roBrowser MobileUI overlay (now actually shown): joystick bottom-left; attack /
pickup / talk-NPC bottom-right; skill grid (toggle to reveal, cycle 4 sets); top bar
= targeting / auto-target / auto-follow / status / fullscreen toggles; the RO windows
(inventory, equip, skills, stats) are still the desktop-style draggable windows opened
from the basic-info bar. A mobile-first re-layout of those windows is a later pass.

## F. Test results (this pass)

| Item | Result |
|------|--------|
| roBrowser build (with all 3 JS changes) | ✅ compiles, no errors |
| APK build | ✅ `FateMMO-client-debug.apk` (7.1 MB) |
| Launch (Android 14 emulator) | ✅ no `AndroidRuntime`/JS errors from the changes |
| Login → char-select | ✅ (7900 → 7121), pre-renewal / packetver 20180620 |
| **In-game: joystick, skills, multi-touch, NPC_Titles-gone** | ⚠️ **NOT verified by me** — the emulator (≈2 fps swiftshader + adb-injected input) cannot open the CharCreate UI or hold an in-game session. Needs a real device. |

A throwaway test character exists so you don't risk your main account:
**account `emutest` / password `emutest`**, character **EmuNovice** on `new_1-1`.

---

# Session 2 — connect + black-screen fixes (2026-09-04, later)

The user reported: (a) icon unchanged, (b) "did not change anything", (c) unable to
connect, (d) enter character → **black screen + "Disconnected from the server" while
still downloading**. Root-caused and fixed six distinct server-side bugs. **The APK
did not need to change** for (c)/(d) — the chat + joystick code was already shipped;
these were all server/infra bugs.

| # | Bug | Root cause | Fix |
|---|-----|-----------|-----|
| 1 | **"Unable to connect"** after re-opening the app | rAthena login server rejects a re-login while the account is still flagged online (`User 'x' is already online - Rejected` → client shows "Incorrect ID/Password"). Closing the app doesn't log out cleanly. | `online_check: no` in `FateRO-mobile/conf/import/login_conf.txt` |
| 2 | Remote Client slow / stalling under load | It ran as single-threaded `php -S` — every asset request serialised; a map needs hundreds. | Moved to an **Apache vhost on :8000** (`fatemmo-remoteclient.conf`, prefork MPM, mod_php). 20 parallel requests: 0.13 s. `php -S` service disabled. |
| 3 | Some GRF assets `CORS`-blocked | `Header set` was inside `<Directory>`; the `ErrorDocument 404 → index.php` (GRF-served) responses didn't inherit it. | `Header always set Access-Control-Allow-Origin *` (+ methods/headers/CORP) at **VirtualHost** level. |
| 4 | **Map textures 500-erroring → black screen** | `remote-client/Bmp.php` calls `imagecolorallocatealpha($img,$r,$g,$b,$a)` with `$a` up to 255. **PHP 8.4** made that a fatal `ValueError` (0–127 only). Every affected BMP → HTTP 500 → texture missing. | Patched `Bmp.php` to clamp alpha: `max(0,min(127,(int)$a))` (lines 46 & 71). |
| 5 | Fonts / BGM / `System/*` all 403 | Apache `www-data` had no traverse (`+x`) permission on `/home/debian` and the RC subtree. | `chmod 755 /home/debian`; `find remote-client -type d -exec chmod 755`, files `644`; `data/` + `cache/` `775` + setgid, group `www-data`. |
| 6 | **Black screen for new / relocated characters** | `char_athena.conf` spawns pre-renewal characters on **`new_1-1`** — and that map is **not in this server's client data** (`data/new_1-1.rsw` → 404; `data/prontera.rsw` → 200). A character loading a nonexistent map never finishes → never sends load-complete → map-server ping timeout → "Disconnected", assets keep streaming. | `start_point*: prontera,156,191` in `FateRO-mobile/conf/import/char_conf.txt`. Existing chars on real maps were unaffected (0 real chars were on `new_1-1`). |

**Result (verified on emulator):** login → char-select → **enter game → the map renders
with full HUD, minimap, skill bar, and a clean chat box (no NPC_Titles spam).**
Screenshot: `AndroidClient/artifacts/prontera-ingame.png`.

### Additional client change this session
- `src/Engine/MapEngine.js` — on map enter, if `ROConfig.mobileUI === true`, force
  `Session.isTouchDevice = true` + `MobileUI.show()` (don't rely on a `touchstart`
  having fired first). Ensures the joystick/HUD overlay appears on an app build.

### Server services now (all `enabled` for reboot persistence)
- main: `fatemmo-mobile-{login,char,map}`, `fatemmo-remoteclient` (Apache)
- proxy: `fatemmo-wsproxy`, `fatemmo-fwd-{7900,7121,7122,8000}`

### Still not visually confirmed by me
The **virtual joystick overlay itself** — the emulator renders at ~2 fps (software GL)
and its map load is a race against timeouts, so I got one clean in-game frame but could
not reliably re-enter to inspect the on-screen controls. To verify on the phone. The
`mobileUI` flag, `Core/Mobile.js` force, `MapEngine.js` force-show, and the multi-touch
joystick rewrite are all in the shipped `Online.js`.

### The app icon
Not changed — it's still the placeholder "F". You asked for the Fate MMO logo. I can't
read an image pasted into chat as a file; **put the logo PNG somewhere on this PC
(e.g. `F:\FateMMO\logo.png`) and tell me the path** and I'll cut the adaptive +
legacy launcher icons and rebuild.

---

# Session 3 — automatic joystick + mobile UX polish (2026-09-04)  ·  APK v0.1.2

### Audit answers (per spec)

1. **Where the joystick initialises** — `src/UI/Components/MobileUI/MobileUI.js`
   → `MobileUI.init()` → `setupJoystick()` (queries `#joystickBase`/`#joystickThumb`,
   binds `mousedown`/`touchstart`). Runs once, on first component `append()`.
2. **What made it need a trigger** — TWO gates:
   (a) `MobileUI.onAppend` only sets `display:block` if `Session.isTouchDevice`
   (true after the first `touchstart`, or forced by our `mobileUI` flag);
   (b) — the real one — in `MobileUI.html` `#joystickContainer` and all button bars
   ship with `class="… disabled"` (CSS `visibility:hidden`), and **only tapping the
   🛠️ wrench** (`#toggleUIButton` → `toggleButtons()`) removed `disabled`.
3. **Why no auto-init** — `showButtons` starts `false`; nothing called `toggleButtons()`.
4. **Lifecycle** — MobileUI is a persistent shadow-DOM overlay appended on every map
   load (`MapEngine.js`), not tied to an Activity; survives menus. `init()` once,
   `onAppend()` every map.
5. **Chat input** — `ChatBox` component has a real `.input-chatbox` element; roBrowser
   focuses it on the **Enter** key. On mobile there was no way to send Enter.
6. **Files** — `MobileUI.{js,html,css}`, `Engine/MapEngine.js`, `Core/Mobile.js`
   (client); `AndroidManifest.xml`, `MainActivity.kt` (wrapper).
7. **ragnafinest.apk** — closed RO Workshop native engine, packed `.so`, not
   source-inspectable. Behavioural model replicated: persistent left joystick,
   right-thumb action cluster, always-visible chat affordance, no wrench/gesture to
   arm controls.

### Changes (smallest safe edits — joystick logic untouched)

| File | Change |
|------|--------|
| `MobileUI.js` | New `revealCoreControls()` — un-hides `#joystickContainer`, action cluster, `#chatButton` (calls the existing `toggleButtons()` once if `showButtons` is false; never hides). Called from `MobileUI.show()` **and** `onAppend()` when `isTouchDevice`. Result: **joystick + attack + chat are live the moment you're in the map — no wrench tap, every map, after menus, after map change.** Added `#chatButton` handler → `keyPress(13)` (reuses roBrowser's own Enter→open-chat path → raises the Android keyboard). |
| `MobileUI.html` | Added `<button id="chatButton">💬</button>`; `#chatButton` added to `toggleButtons()` show/hide lists. |
| `MobileUI.css` | Joystick 25→**34 vmin** (min 150 px), translucent dark base + white ring; attack button 17.5→**20 vmin**; F-buttons/pickup/talk enlarged w/ `min-*px`; **`#chatButton`** bottom-centre 12 vmin; wrench shrunk to 5.5 vmin @ 0.7 opacity; **`env(safe-area-inset-*)`** on the overlay + joystick + clusters (notch / gesture-bar safe); every `.buttons` min 40 px. |
| `Engine/MapEngine.js` | On map enter, if `ROConfig.mobileUI === true` → `Session.isTouchDevice = true; MobileUI.show()` (don't wait for a touch event). |
| `AndroidManifest.xml` | `android:windowSoftInputMode="adjustResize"`. |
| `MainActivity.kt` | (a) `OnApplyWindowInsetsListener` pads the WebView by the IME height so roBrowser's bottom-anchored chat rises above the keyboard (needed because edge-to-edge defeats plain adjustResize); (b) **back button**: keyboard up → hide it (+ blur the web input) and consume; else ESC to the game; else double-back-to-quit. |

### Verified
- roBrowser + APK build clean; `chatButton` present in shipped `Online.js`;
  `mobileUI: true`, `autoLogin: []` in `Config.local.js`; APK installs + launches +
  reaches login with no JS errors.
- **In-game visual confirmation of the joystick/chat button could not be captured** —
  the software-GL emulator loads this server's hub map (`maintown`, 7.6 MB ground
  mesh) too slowly for a clean frame inside a reasonable wait. One earlier run did
  render the world fully (`artifacts/prontera-ingame.png`). **Confirm on the phone.**

---

# Session 4 — resource caching + Character Info / Skills mobile UI (2026-09-04)  ·  APK v0.1.3

## Part 1 — caching (why maps were slow every time)

**Audit:**
- The client is roBrowser JS in a WebView — no native resource manager. Resource
  path: roBrowser → HTTP GET to the Apache Remote Client (:8000) → GRF extract →
  JS parse (GND/BMP) → WebGL upload.
- roBrowser's own persistent cache (`src/Core/FileSystem.js`) uses the **removed
  `webkitRequestFileSystem` API** → does nothing on Android WebView. `saveFiles:true`
  is a no-op.
- The Remote Client sent `ETag`/`Last-Modified` but **no `Cache-Control`** → the
  WebView revalidated **every asset on every map visit** (a network round-trip per
  file × 200+ files, through the proxy) = the repeated slow loads.
- Server side was fine: assets are extracted to `~/remote-client/data/` on first
  fetch and served statically after.

**Fixes:**
1. **Apache: `Cache-Control: public, max-age=31536000, immutable`** on every game-asset
   type (bmp/tga/jpg/png/spr/act/gat/gnd/rsw/rsm/str/pal/wav/mp3/lua/lub/txt/xml/…),
   via `mod_expires` + `mod_headers`, on **both** the static path and the
   `404→index.php` GRF path (`HttpCache.php` forced to `IMMUTABLE_MAX_AGE`). GRF
   contents never change, so this is correct. → the WebView now serves repeat-visit
   map assets **from device storage with zero network / zero revalidation**. This is
   the core "returning to a map is fast" fix; it survives app restart (WebView disk
   cache is in app data).
2. **Server map warm** — background job `curl`s every map's `.gat/.gnd/.rsw` (1242
   maps) so the big per-map files are pre-extracted; a player's *first* visit to any
   map then skips GRF extraction too, and their device immutable-caches it.

**Not done (out of scope / high risk):** caching the *parsed* GND geometry / decoded
textures in IndexedDB so roBrowser skips the JS re-parse. That's a rewrite of
`MapLoader`/`Ground`; the network was the dominant cost and is now cached. A
Service Worker (Cache Storage, unlimited persistent) was considered but the WebView
page is served over `http://appassets…` (not a secure context) so SW registration
would fail; would require switching to `https://` + mixed-content handling.

## Part 2 — Character Info & Skills UI (mobile)

Active variants at packetver 20180620: `BasicInfoV4` (the always-on HP/SP/Lv panel),
`WinStatsV1` (stats window), `SkillListV2` (skills window — already has a mini list
view, a big skill-tree view, resize, **and touch drag-to-cast**). All were PC-sized
(24 px skill icons, 11 px close buttons, 220–280 px windows).

**Changes (CSS overrides only — no HTML/JS restructure, drag/cast untouched):**
| File | Change |
|------|--------|
| `BasicInfoV4.css` | `:host { transform: scale(1.55); transform-origin: top left }` + safe-area margins + 34 px menu buttons + 16 px titlebar dots. Stays top-left (it's the persistent HUD panel), now readable/tappable. |
| `WinStatsV1.css` | `:host { zoom: 1.7 }`, **centred** on screen, `max 96vw/92vh`, 26 px titlebar, 22 px close, 20 px stat-up buttons. |
| `SkillListV2.css` | `:host { zoom: 1.15 }` + **centred** + `max 96vw/92vh`; list/tree panels `min(78vw,620px) × min(64vh,520px)` **scrollable**; **skill icons 40–44 px, `image-rendering: pixelated`**; list rows 40 px tall, 14 px text; `+/-` buttons 36 px; close 24 px; footer 40 px with 56 px apply/reset. Responsive via `vw/vh` + `max-*`. |

`zoom` (not `transform`) on the windows so the internal absolute layout stays intact
and every element is proportionally larger **and correctly hit-tested**. The two
windows are now fixed-centred rather than drag-anywhere — deliberate for mobile (they
open on demand). The persistent joystick/HUD from session 3 is unaffected.

---

## Part 2 REDO (v0.1.4) — after comparing to the real RagnaFinest client

v0.1.3 in-game screenshots showed the `scale(1.55)` / `zoom` + `transform: translate`
approach was wrong: the Character Info panel blew up and overlapped the joystick +
chat, the Skills window mis-positioned (transform+zoom bug in WebView), its titlebar
text clipped ("S…Tree"), and **skill drag broke** — `zoom` on `:host` distorts
`touch.pageXY` vs `document.elementFromPoint(clientX,clientY)`, which is exactly the
coordinate pair `SkillListCommon.js` drag-to-cast relies on.

RagnaFinest reference (user-supplied): Character Info stays **compact, docked hard
top-left**, with a tidy **5-col menu-icon grid** below it; Skills is a **big,
near-full-screen readable list** — one tall row per skill `[icon] Name / status` with
a divider line, "Skill Point : N" pinned at the bottom.

**Changes (still CSS-only, no HTML/JS restructure):**
| File | v0.1.4 |
|------|--------|
| `BasicInfoV4.css` | Removed `transform: scale`. Panel + menu strip widened 220→240 px; menu buttons 40 px on a `repeat(5,1fr)` grid (4 px gap → fits 240); `.small` stat lines 11–12 px; safe-area margins; **no transform** so the HUD-drag/magnet math is intact. |
| `WinStatsV1.css`  | Kept `zoom` (1.7→1.6 — the internal layout is px-absolute and needs one), **dropped the `transform: translate` centring** (that's the WebView mis-place bug), docked top-left `8px/8px`. |
| `SkillListV2.css` | **Removed `zoom` AND `transform` entirely** (restores drag-to-cast). Docked `top/left: 0`. `.content`/`.contentbig` → `min(94vw,448px) × 78vh`, `overflow-y:auto`. List rows: 38 px icons, `min-height:48px`, 15 px text, `white-space:normal`, 1 px `#e3e3e3` bottom border (the divider). `+` button 40 px. Titlebar 34 px flex row, `.text width:auto` (fixes the clip). Footer 44 px. Tree cells 42 px, no offset hacks. |

Drag-to-cast coordinate integrity is the reason `SkillListV2` gets **zero**
transform/zoom now. `WinStatsV1` keeps `zoom` because its +stat buttons are simple
`click` targets (hit-test fine under `zoom`) and its 11 px-grid layout is impractical
to rebuild.

## Part 2 REDO-2 (v0.1.5) — after the v0.1.4 in-game shot

v0.1.4 skill window was still wrong: docked full-height (covered the bottom-left
joystick), glaring white, mostly empty with 2 skills, a huge blue arrow scrollbar,
and `.name { display:flex }` collapsed the row's `<br>` so "Basic Skill" + "Lv : 9"
ran together ("Basic SkillLv : 9").

**`SkillListV2.css` (v0.1.5):**
- **Dark** panel `rgba(11,13,18,.96)`, border `#2c313d`; titlebar/footer `#161922`;
  `<ui-image>` bar textures hidden; name `#f2f4f7`, level `#9db3d0`, "Passive"
  `#8bc7a3`.
- Body height **`auto`**, `max-height: calc(100vh - 140px)` → fits the skills, never
  reaches the joystick; scrolls only when long. Achieved by making the **active**
  `.tab-content-mini` `position: relative` (others stay `absolute`+hidden) so
  `.content` can shrink-wrap it.
- Row: `.name { display:block }` (name / `Lv : N` on two lines), 36 px icon, "Passive"
  right-aligned, 1 px `rgba(255,255,255,.08)` divider.
- `::-webkit-scrollbar { width:5px }` + buttons hidden → kills the giant blue bar.
- Docked `top:6px; left:30px` so the vertical 1st/2nd/3rd job-tab labels (negative
  offset) stay on-screen.
- Still **no zoom / no transform** (drag-to-cast intact).

## Loading screen (v0.1.5)

The Fate GRF ships no `loadingNN.jpg` / login art → the map-load + login screens
were a black void with a tiny bar.
- **`assets/web/bg_loading.jpg`** — 1600×720 Fate MMO splash (composed from
  `D:\Fate Logos\Cover Photo.png`, darkened for text legibility).
- **`src/UI/Background.js`** — `setImage()` single-file error path now falls back to
  `window.ROConfig.loadingFallbackImage || 'bg_loading.jpg'` (relative → resolves to
  the APK asset). `setPercent()` bar widened to `min(360, 70vw)×16`, dark/purple
  palette, `"Loading  N%"` caption, `clearRect` band to stop smear.
- This does **not** make first-load faster — that needs the pre-download step below.

## v0.1.6 — drag skill → F1-F9, and movable/resizable controls

Skill Tree list is good now. Two follow-ups from the user: (a) dragging a skill onto
an F1-F9 button did nothing; (b) the joystick + skill cluster should be placeable /
sizable "wherever the player is comfortable".

**`src/UI/Components/MobileUI/MobileUI.js`:**
- `onSkillDragDrop` — a **capture-phase** `window` `touchend` listener. While a skill
  drag is live (`window._OBJ_DRAG_.type === 'skill'`, set by `SkillListCommon.js`'s
  300 ms long-press), it hit-tests `#f1Button..#f9Button` by `getBoundingClientRect`
  and, on a hit, binds via `ShortCut.addElement(idx,true,SKID,lvl)` +
  `ShortCut.onChange(...)` (idx 0-8 = F1-F9, matching `EXECUTE0..8` in
  `Preferences/ShortCutControls.js`). Does **not** `stopPropagation` — SkillListCommon
  still needs its own touchend to drop the ghost. Only **active** skills drag (RO
  rule: `!skill.type` bails in `onSkillTouchStart`), which is correct.
- `paintFButtonIcon` / `refreshFButtonIcons` — draw the skill's `item/<Name>.bmp` on
  the button (`.mui-bound` → hides the "Fn" text); on every `onAppend` the F-buttons
  are re-mirrored from the ShortCut slot DOM so bindings survive map reloads.
- **Edit mode**: long-press the 🛠️ wrench (~0.6 s) → `#MobileUI.mui-edit`. Shows a
  top toolbar (`#mui-edit-panel`: Stick ±, Skills ±, Reset, Done). `#joystickContainer`
  and `#buttonContainer` become drag-to-move (capture-phase `touchstart` +
  `stopImmediatePropagation` so the joystick's own `startDrag` can't fire; `startDrag`
  also early-returns when `_editMode`). Scale = `transform: scale()` on the container,
  0.6-1.8. Saved to `Preferences('MobileUILayout', { joy, pad })`, re-applied in
  `onAppend` via `applyLayout()`. Short-tap wrench = unchanged (toggle bars).
- Joystick `maxDistance` now from `getBoundingClientRect().width/2` (was `offsetWidth`)
  so it stays correct when the stick is scaled.

**`MobileUI.css`:** `.FButton.mui-bound`, `#MobileUI.mui-edit` dashed outlines,
`#mui-edit-panel` toolbar styling.

## v0.1.7 — "Download game data?" pre-login prefetch

Server map-warm finished: `200:3081 miss:645` of 1242 maps' `.gat/.gnd/.rsw`;
`~/remote-client/data` = 5.4 GB; disk 24/40 GB used (14 GB free).

**`app/build.gradle.kts` — `generateRoBrowserConfig`** now appends `prefetchBootstrapJs()`
to the generated `Config.local.js` (so a roBrowser web rebuild can't drop it; no
`index.html` edit needed — `index.html` already loads `Config.local.js`).

The bootstrap is framework-free vanilla JS:
- On launch, unless `localStorage['fatemmo.assets.done.v1']` is set (or `…later.v1`
  within 12 h), shows a dark modal: **"Download game data?" → [Later] [Download now]**.
- **Download now** → `fetch(remoteClient + '/data/manifest.txt')`, then GETs every
  listed path with concurrency 6, `cache:'force-cache'`, `mode:'cors'`, progress bar +
  "N / M files", plus a "Play now" button that stops the pool. Full completion sets
  the `done` flag.
- URL + per-segment `encodeURIComponent` **exactly matches** `FileManager.getHTTP`
  in roBrowser, so the warmed entries are cache hits for the real map loader
  (`remoteClient + "data/<map>.gnd"` etc.). roBrowser uses plain `fetch` (cache mode
  `default`) → served from the HTTP cache when immutable/fresh.
- No manifest on the server yet → friendly "will download as you play" + auto-dismiss.

**Server step the user must run once** (creates the list the client fetches):
```bash
cd ~/remote-client && find data -type f | sed 's#^data/##' > data/manifest.txt && wc -l data/manifest.txt
```
Re-run after more play/warming to refresh it.

**Caveat:** Android WebView's HTTP cache has a size cap and evicts, so prefetching
multi-GB won't all persist on-device; the durable win is the **server** `data/` cache
(the RemoteClient's `index.php` writes each GRF extraction to disk on miss), which
removes the GRF-extract lag for everyone. Follow-up: priority-order the manifest
(geometry + sprites + palettes first) and add a "Download data" entry point on the
in-game loading screen.

## v0.1.8 — fixes from the v0.1.6/0.1.7 device shots

1. **Download-data modal buttons were dead.** roBrowser's global touch handlers eat
   synthesised `click`s. Now every button binds `touchend` + `pointerup` + `click`
   (deduped) with explicit `pointer-events:auto` / `touch-action:manipulation`;
   tapping the dark backdrop = Later. (`app/build.gradle.kts` prefetch bootstrap.)
2. **Skill Tree only showed 1st-job (Thief) skills / "UI fucked up".**
   - `SkillListV2.css`: `.contentbig { display:none }` — mobile now *only* shows the
     scrollable **list** view (the PC tree grid was cramped + double-scrollbar). The
     `.extend` toggle is hidden so it can't be flipped back.
   - Job tabs (1st/2nd/3rd/4th/Etc) rebuilt as a real **horizontal tab bar** at the
     top (`.tab-mini { display:contents }` + flex, labels `writing-mode:horizontal-tb`,
     `order`). They were at a negative offset off the left edge → player couldn't
     switch to Assassin / Assassin Cross skills. Window docked `left:8px`.
   - `SkillListCommon.js onAppend`: the mini + tree radios share one `name` group and
     the HTML marks the tree's `#tab-1` checked, so with the tree hidden **no** mini
     tab was selected and the list was blank. On mobile (`ROConfig.mobileUI`), select
     the first `.tab-switch-mini` when none is checked.
3. **Joystick / F-cluster shrunk** (`MobileUI.css`): joystick 34→26 vmin and lifted to
   `bottom:10%`; button cluster 40→33 vmin; atk 20→17 vmin. They were swallowing the
   screen and sitting on top of the chat log. Still scalable via Edit mode.
4. **`#leftBar`** (F10/F12/sit) moved off the character panel to the right edge below
   the minimap.

## v0.1.9 — device feedback round

- **Character-Info menu grid blew up / overflowed** (`BasicInfoV4.css`). Rewrote the
  grid: fixed 232 px strip, `repeat(5,1fr)` with `gap`, buttons `width:100%;
  max-width:42px; aspect-ratio:1/1; background-size:contain` + `!important` — can no
  longer overflow regardless of the bmp's intrinsic size. Hover-name + "new" overlay
  hidden.
- **Couldn't re-drag a skill between F-buttons.** `MobileUI.js`: F1-F9 bindings now
  live in `Preferences('MobileUIFBinds')` (`index -> {skid,level}`). New
  `setupFButtonDrag` — long-press (240 ms) a bound F-button, drag to another → move
  (or swap if occupied) via `ShortCut.addElement/removeElement/onChange` + repaint.
  F-keys changed to **tap-on-touchend** (`bindFKey`) so a long-press/drag doesn't also
  cast. `refreshFButtonIcons` now re-applies the saved binds on every map load.
- **Couldn't resize the skill cluster** (edit-panel buttons dead). Same swallowed-click
  bug as the download modal — edit-panel buttons now use `muiTap` (touch + pointer +
  click, deduped).
- **Joystick / cluster** already shrunk in v0.1.8; unchanged here.
- **Chat overlay** (`ChatBox.css`): docked bottom-left full-viewport-width bar;
  translucent blurred log `min(74vw,660px)` × 26vh; 13 px log text, 14 px input;
  `Send to` 84 px + wide `Chat message`; bigger filter/size buttons + tabs.

## v0.1.10 — declutter

- **Top F1-F9 hotbar removed** — `ShortCut/ShortCut.css` `:host { display:none !important }`.
  The slot logic still runs (F-key press -> `clickElement` -> cast); skills live only
  on the on-screen F1-F9 buttons now (which show their icons since v0.1.9).
- **Character-Info menu grid starts collapsed on mobile** — `BasicInfoCommon.js`
  `buttons: !mobileUI` default, pref version bumped to 1.2 so it re-applies. The
  panel is just the stat lines + a **22px arrow handle** (`BasicInfoV4.css .bt_menu`)
  to open the grid when needed.
- **Chat shrunk** (`ChatBox.css`): log `min(56vw,460px)` × 13vh (was 26vh), 12px text,
  `rgba(0,0,0,0.4)`; input bar 34px.

### Known / not fixed this round
- **Item names are mojibake** ("ƒoƒCƒlƒŠ..."). `langtype=1` → roBrowser decodes the
  item-name table as `windows-1252`; the Fate table looks Shift-JIS/other. Needs a
  `CLIENT_LANGTYPE` change or a `customItemInfo` pointing at the right file — TBD,
  don't guess blind.
- **~5 min from char-select to in-world even with the prefetch done.** Prefetch only
  covered the 4158 already-extracted files; textures/models still hit the PHP
  GRF-extract path. Fix = flatten the whole GRF on the server
  (`scratchpad/grf_extract.py Fate.grf ~/remote-client/data`) then regenerate
  `manifest.txt`. Also want a chrome://inspect network capture to confirm the stall
  is asset extraction and not the char→map handoff.

### Not yet matched to RagnaFinest (bigger, separate work)
- **"Download full client? (~3 Gb)" prompt + patcher** — RagnaFinest is the native
  Gravity client with a Thor patcher; roBrowser streams per-map. Closest analogue =
  a pre-login "warm all assets now / later" step driven by the Remote Client. Needs
  the GRF-extractor crawl finished first (see G.5).
- **Skills list dark full-screen theme** — reference is white-on-black full-bleed;
  v0.1.4 is a large light panel (same structure, works, readable). Dark theme = a
  follow-up colour pass.
- **Chat**: reference has a large translucent log + full-width `Send to | Chat
  message` bar. Session-3 chat button + Android keyboard handling is in; the overlay
  sizing pass is still open.

### Verified / not verified
- roBrowser + APK build clean; launches; reaches login; no JS/native errors; login
  screen unaffected (`artifacts/v013-login.png`).
- `Cache-Control: immutable` confirmed on static + GRF-served responses.
- **Visual check of the resized Character Info / Skills panels in-game: needs your
  phone** (emulator can't hold an in-game session long enough).

## G. Remaining / needs your device

1. **Verify on your phone** with `emutest`/`emutest` (or your own account): enter
   game → confirm the joystick moves you, skill taps cast, two thumbs work at once,
   and **NPC titles no longer appear in public chat** (they should float over the
   NPCs' heads instead).
2. **Drag-to-cast** skill interaction (D above) — next task.
3. Skill buttons: real skill **icons + cooldown sweep + range ring** instead of the
   F-key grid.
4. Mobile re-layout of inventory / equip / skill / stat windows.
5. Full asset pre-extraction — the Remote Client search API returns nothing to the
   crawler (encoding/endpoint), so only the map `.gat/.gnd/.rsw` got pre-pulled;
   textures/models still stream on first visit (then cache). A proper GRF extractor
   run would finish this.
