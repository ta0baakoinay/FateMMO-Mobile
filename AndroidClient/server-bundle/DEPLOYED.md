# Fate MMO mobile — what is actually deployed (2026-09-04)

Set up over SSH and **verified end-to-end on an Android emulator**: APK launches →
roBrowser renders from your GRFs → login screen → **connects to login server →
authenticates → character-server → character-select screen**. (Character creation
+ walking around were not driven through the emulator — 2 fps software GL + the
soft-keyboard covering the login window made scripted input unreliable — but the
map-server is up, connected, and serving all 1242 maps to the char-server.)

Your **live 20250716 server and PC client were not touched.** The mobile client
talks to a **second, separate rAthena instance** on different ports and its **own
database**.

---

## MAIN server — 51.79.147.208 (user `debian`, has sudo)

| What | Where | Notes |
|------|-------|-------|
| Live server (untouched) | `~/FateRO`, ports 6900/6121/5121, web 8888 | your existing 20250716 pre-renewal server |
| **Mobile rAthena** | `~/FateRO-mobile`, ports **7900 / 7121 / 7122** | copy of your source, `PACKETVER 20180620`, `//#define PACKET_OBFUSCATION`, `--enable-prere` |
| Mobile DB | **`ragnarok_main`** (the LIVE DB) — user `fatemmo_mobile` granted ALL on `ragnarok_main` + `ragnarok_logs` | pass in `~/.fatemmo_mobile_dbpass` (chmod 600). Set via `conf/import/inter_conf.txt`. Players use their **existing live accounts + characters**. (An unused `ragnarok_mobile` DB from the first pass still exists — drop it if you like.) |
| Double-login guard | `~/FateRO-mobile/npc/custom/fatemmo_login_guard.txt` (registered in `npc/scripts_custom.conf`) | `OnPCLoginEvent` on the mobile map-server: if the account already has a char `online=1` (i.e. on the PC server), it messages the player and `@kick`s them. **One-sided** — does not stop logging into the PC server while mobile is online. Not a hard lock; monitor `picklog`/`@who` on both server groups too. |
| Mobile conf overrides | `~/FateRO-mobile/conf/import/{login,char,map,inter}_conf.txt` | ports, `char_ip`/`map_ip` = 167.104.101.102, `use_web_auth_token: no`, `new_account: yes`, DB creds |
| **Remote Client** (GRF asset HTTP) | `~/remote-client`, port **8000** | roBrowserLegacy-RemoteClient-PHP + a `router.php` (adds CORS, serves via `php -S`). GRFs in `~/remote-client/resources/` (Fate/data/hd/palettes = 8.4 GB) + `System/`, `SystemEN/`, `BGM/` |
| Swap | `/swapfile.fatemmo` 3 GB, in `/etc/fstab` | added for the compile; kept as headroom (box had none) |

**systemd units (main):** `fatemmo-mobile-login`, `fatemmo-mobile-char`,
`fatemmo-mobile-map`, `fatemmo-remoteclient` — all `enabled` + `active`.
```
sudo systemctl restart fatemmo-mobile-login fatemmo-mobile-char fatemmo-mobile-map   # order matters, ~4s apart
sudo systemctl restart fatemmo-remoteclient
sudo journalctl -u fatemmo-mobile-map -f
```

## PROXY server — 167.104.101.102 (user `root`)

| What | Where | Notes |
|------|-------|-------|
| Your existing proxy | `/opt/ragnarok-proxy` (`ragnarok-proxy.service`) | untouched — still forwards 6900/6121/5121 to main |
| **wsProxy** | npm `wsproxy` global, `fatemmo-wsproxy.service`, port **5999** | `wsproxy -p 5999 -a 167.104.101.102:7900,167.104.101.102:7121,167.104.101.102:7122`, runs as `daemon` |
| **socat forwards** | `fatemmo-fwd-7900/7121/7122/8000.service` | `167.104.101.102:PORT` → `51.79.147.208:PORT` (mobile rAthena + Remote Client) |

```
systemctl restart fatemmo-wsproxy fatemmo-fwd-7900 fatemmo-fwd-7121 fatemmo-fwd-7122 fatemmo-fwd-8000
journalctl -u fatemmo-wsproxy -f     # shows every client connection
```

## Data path

```
APK WebView  --ws://167.104.101.102:5999/-->  wsProxy (proxy)
   |                                              |-- 167.104.101.102:7900 --socat--> main:7900  login
   |                                              |-- 167.104.101.102:7121 --socat--> main:7121  char
   |                                              |-- 167.104.101.102:7122 --socat--> main:7122  map
   '--http://167.104.101.102:8000/-->  socat --> main:8000  Remote Client --> reads the 4 GRFs
```
Client only ever contacts `167.104.101.102`. Main IP `51.79.147.208` is only in
server-side infra (wsProxy allow-list is the proxy IP; socat targets the main IP
internally).

---

## Caveats / to tidy later

1. **Cross-instance double-login is only softly guarded.** Mobile now uses the live
   DB, so the same account/character exist on both server groups. The two login
   servers can't share a session lock (different packet versions). The mobile-side
   `OnPCLoginEvent` guard (above) kicks a mobile login when that account is already
   online on PC — but not the reverse. For a hard lock you'd add a matching script
   to the LIVE `npc/` and `@reloadscript` it. Otherwise: watch item/trade/storage
   logs on both groups.
3. Remote Client `/api/health` reports the GRFs as "invalid" — this is a false
   negative in that project's health probe under `php -S`; real file serving
   works (login + char-select rendered from the GRFs).
4. Ports 7900/7121/7122/8000/5999 are open to the world on their hosts. Lock them
   to the proxy IP (nftables on main; the proxy's wsProxy/socat can stay public or
   go behind TLS). Not done — matches your current no-firewall posture.
5. `ws://` (not `wss://`). Fine for the APK (cleartext allowed). For a browser or
   a hardened build, put a TLS domain in front of :5999 and :8000 and switch the
   APK config to `wss://` / `https://`.
6. The shared login password you sent is on both hosts — rotate it (`passwd`).
7. SSH: a key `claude-fatemmo-setup` was added to `~/.ssh/authorized_keys` on both
   hosts for this setup. Remove it when done:
   `sed -i '/claude-fatemmo-setup/d' ~/.ssh/authorized_keys`
