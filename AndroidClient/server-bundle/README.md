# Fate MMO — server-side setup for the Android (roBrowser) client

The APK is only the *renderer*. To play, you need these running and reachable
**through the proxy `167.104.101.102`** (main IP `51.79.147.208` stays private):

| Service | Port | Host | Purpose | Must equal (APK side) |
|---------|------|------|---------|-----------------------|
| **rAthena — mobile instance** | 6900 / 6121 / 5121 | main, proxied | game server @ **PACKETVER 20180620**, obfuscation OFF | `CLIENT_SERVER_ADDRESS`, `CLIENT_LOGIN_PORT` |
| **wsProxy** | 5999 | proxy | browser WebSocket ⇄ rAthena TCP | `CLIENT_WSPROXY_URL` |
| **Remote Client** | 8000 | proxy | serves assets from the 4 GRFs over HTTP | `CLIENT_REMOTE_CLIENT_URL` |

All APK-side values are in **one file**:
`AndroidClient/webview-app/client.env.properties` → rebuild APK after any change.

---

## 1. rAthena — run a SEPARATE instance for mobile ⚠️

Your main server is **PACKETVER 20250716** with packet **obfuscation ON**.
roBrowserLegacy only has packet tables up to ~2021–2022 and cannot do
obfuscation — it **will not** talk to the main server. Lowering the main
server's PACKETVER would break your PC client (`FateMMO.exe`, a 2025 client).

**Solution: a second rAthena instance, same MySQL DB, different ports, built for
roBrowser.** Players share accounts/characters across both.

```bash
# on the MAIN box, beside your existing server:
cp -r rathena-source rathena-mobile && cd rathena-mobile

# 1a. packetver -> 20180620
sed -i 's/#define PACKETVER .*/#define PACKETVER 20180620/' src/custom/defines_pre.hpp

# 1b. disable packet obfuscation (line 48 of packets.hpp)
sed -i 's|^\t\t#define PACKET_OBFUSCATION$|\t\t//#define PACKET_OBFUSCATION|' src/config/packets.hpp
grep -n 'PACKET_OBFUSCATION' src/config/packets.hpp        # verify -> //#define

# 1c. build (pre-renewal, matches your source's #define PRERE)
./configure --enable-prere && make clean server -j$(nproc)
```

`conf/` of the mobile instance (import-override or edit directly):
```
# inter_athena.conf  -> point at the SAME database as the main server
# login_athena.conf
login_port: 6900
use_web_auth_token: no
# char_athena.conf
char_port: 6121
char_ip: 167.104.101.102          # clients reach char via the proxy
# map_athena.conf
map_port: 5121
map_ip: 167.104.101.102
char_ip: <main-internal-ip>        # map -> char stays internal
```
`subnet_athena.conf` (already correct in your source):
```
subnet: 255.0.0.0:127.0.0.1:127.0.0.1
subnet: 255.255.255.255:167.104.101.102:167.104.101.102
```
If 6900/6121/5121 are taken by the main server, pick free ports for the mobile
instance and update the proxy forward + `client.env.properties` + wsProxy `-a`.

**Proxy**: forward `167.104.101.102:{6900,6121,5121}` → the mobile instance on
the main box.

*(Reference diff for 1a/1b: `rathena/robrowser-compat.patch`.)*

---

## 2. wsProxy + Remote Client (Docker, on the PROXY host)

```bash
# on 167.104.101.102, beside this docker-compose.yml:
git clone https://github.com/MrAntares/roBrowserLegacy-RemoteClient-PHP.git
cp remote-client/DATA.INI roBrowserLegacy-RemoteClient-PHP/resources/DATA.INI
cp /path/to/Fate.grf /path/to/palettes.grf /path/to/hd.grf /path/to/data.grf \
   roBrowserLegacy-RemoteClient-PHP/resources/

docker compose up -d --build
docker compose logs -f
```
`resources/DATA.INI` load order is **Fate.grf first** (your main/override GRF),
then palettes, hd, data.

Sanity checks:
```bash
curl -I http://167.104.101.102:8000/data/clientinfo.xml   # 200 = GRFs served OK
php roBrowserLegacy-RemoteClient-PHP/doctor.php --deep     # GRF format + encoding
#   mojibake / 404 on korean-named files -> set GRF_ENCODING=UTF-8 in docker-compose.yml, rebuild
```
No Docker:
* wsProxy: `npm i -g wsproxy && wsproxy -p 5999 -a 167.104.101.102:6900,167.104.101.102:6121,167.104.101.102:5121`
* Remote Client: `apt install php php-gd`, files in `resources/`, `php -S 0.0.0.0:8000` from the repo root.

Open the proxy firewall: `5999 8000` (tcp), plus the forwards for `6900 6121 5121`.

---

## 3. Then

```powershell
adb install -r AndroidClient\artifacts\FateMMO-client-debug.apk
adb shell am start -n com.fatemmo.client.debug/com.fatemmo.client.MainActivity
adb logcat -s FateMMO:V chromium:V
```
The app opens straight into the roBrowser login screen (intro + server list
skipped). Log in with an existing account, or a new `id_M` / `id_F` if
`new_account: yes`.

## 4. Re-pointing later

Edit `AndroidClient/webview-app/client.env.properties`, rebuild
(`gradlew :app:assembleDebug`), and update wsProxy's `-a` list to match.
