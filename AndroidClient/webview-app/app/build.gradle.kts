import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
//  Load the single source of truth: ../client.env.properties
// ---------------------------------------------------------------------------
val envFile = rootProject.file("client.env.properties")
val env = Properties().apply {
    require(envFile.exists()) { "Missing ${envFile.absolutePath}" }
    envFile.inputStream().use { load(it) }
}
fun env(key: String): String =
    env.getProperty(key) ?: throw GradleException("client.env.properties: missing '$key'")

android {
    namespace = env("APP_ID")
    compileSdk = 35

    defaultConfig {
        applicationId = env("APP_ID")
        minSdk = 24
        targetSdk = 35
        versionCode = env("APP_VERSION_CODE").toInt()
        versionName = env("APP_VERSION_NAME")

        buildConfigField("String", "CLIENT_URL",
            "\"http://appassets.androidplatform.net/assets/web/index.html\"")
        buildConfigField("String", "SERVER_ADDRESS", "\"${env("CLIENT_SERVER_ADDRESS")}\"")
        buildConfigField("String", "WSPROXY_URL",    "\"${env("CLIENT_WSPROXY_URL")}\"")
        buildConfigField("String", "DISPLAY_NAME",   "\"${env("CLIENT_DISPLAY_NAME")}\"")

        resValue("string", "app_name", env("CLIENT_DISPLAY_NAME"))
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
        getByName("release") {
            isMinifyEnabled = false          // WebView shell has ~no Kotlin to shrink
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        buildConfig = true
        viewBinding = false
    }

    lint {
        // WebView shell: no value in lint-vital, and its report model task races
        // the generated-config task under Gradle strict validation.
        checkReleaseBuilds = false
        abortOnError = false
    }

    // Generated roBrowser Config.local.js lives here and is merged into assets/.
    sourceSets.getByName("main") {
        assets.srcDir(layout.buildDirectory.dir("generated/robrowser"))
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}

// ---------------------------------------------------------------------------
//  Task: write assets/web/Config.local.js from client.env.properties
// ---------------------------------------------------------------------------
val generateRoBrowserConfig by tasks.registering {
    val outDir = layout.buildDirectory.dir("generated/robrowser/web")
    inputs.file(envFile)
    outputs.dir(outDir)
    doLast {
        val f = outDir.get().file("Config.local.js").asFile
        f.parentFile.mkdirs()
        f.writeText(
            """
            /* AUTO-GENERATED from client.env.properties — do not edit by hand. */
            window.ROConfigLocal = {
                development: false,
                enableConsole: true,
                skipIntro: true,
                skipServerList: true,
                forceUseAddress: true,
                mobileUI: true,
                loadingFallbackImage: "bg_loading.jpg",
                // mobile GPU relief: render at 70% res, cap pixel ratio
                quality: 70,
                maxPixelRatio: 1.5,
                autoLogin: ${if (env.getProperty("CLIENT_AUTOLOGIN")?.isNotBlank() == true) "[${env("CLIENT_AUTOLOGIN")}]" else "[]"},
                remoteClient: "${env("CLIENT_REMOTE_CLIENT_URL")}",
                servers: [{
                    display:     "${env("CLIENT_DISPLAY_NAME")}",
                    desc:        "${env("CLIENT_DISPLAY_NAME")}",
                    address:     "${env("CLIENT_SERVER_ADDRESS")}",
                    port:        ${env("CLIENT_LOGIN_PORT")},
                    langtype:    ${env("CLIENT_LANGTYPE")},
                    packetver:   ${env("CLIENT_PACKETVER")},
                    renewal:     ${env("CLIENT_RENEWAL")},
                    packetKeys:  false,
                    socketProxy: "${env("CLIENT_WSPROXY_URL")}",
                    remoteClient:"${env("CLIENT_REMOTE_CLIENT_URL")}",
                    forceUseAddress: true
                }]
            };
            """.trimIndent() + "\n" + prefetchBootstrapJs() + "\n" + diagOverlayJs()
        )
        logger.lifecycle("Wrote ${f.absolutePath}")
    }
}

/**
 * On-screen load diagnostics (no chrome://inspect needed). Wraps fetch + XHR
 * to count requests / in-flight / bytes / slow URLs, and measures main-thread
 * jank. Shows a tiny top-left readout. Tap it to hide.
 */
fun diagOverlayJs(): String = """
/* ---- Fate MMO on-screen load diagnostics (auto-generated) ---- */
(function () {
    var t0 = Date.now();
    var nDone = 0, nFail = 0, inflight = 0, bytes = 0, jank = 0, maxGap = 0;
    var slow = [];          // {u, ms}
    var last = performance.now();

    // ---- WebSocket instrumentation (map / login / char server links) ----
    var ws = { state: 'none', openedMs: 0, rx: 0, tx: 0, closes: 0, errs: 0, url: '', startedAt: 0 };
    var _WS = window.WebSocket;
    if (_WS) {
        window.WebSocket = function (url, proto) {
            var s = new _WS(url, proto);
            ws.url = String(url).replace(/^wss?:\/\//, '');
            ws.state = 'connecting';
            ws.startedAt = Date.now();
            s.addEventListener('open', function () {
                ws.state = 'open';
                ws.openedMs = Date.now() - ws.startedAt;
            });
            s.addEventListener('message', function () { ws.rx++; });
            s.addEventListener('close', function (e) { ws.state = 'closed(' + (e && e.code) + ')'; ws.closes++; });
            s.addEventListener('error', function () { ws.errs++; });
            var _send = s.send;
            s.send = function () { ws.tx++; return _send.apply(s, arguments); };
            return s;
        };
        window.WebSocket.prototype = _WS.prototype;
        window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1;
        window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
    }

    // ---- console ring buffer (roBrowser logs its phases/errors here) ----
    var logbuf = [];
    ['log', 'info', 'warn', 'error'].forEach(function (k) {
        var orig = console[k];
        console[k] = function () {
            try {
                var m = Array.prototype.slice.call(arguments).map(function (a) {
                    return typeof a === 'string' ? a : (function () { try { return JSON.stringify(a); } catch (e) { return String(a); } })();
                }).join(' ');
                logbuf.push((k === 'error' ? '! ' : k === 'warn' ? '~ ' : '  ') + m.slice(0, 140));
                if (logbuf.length > 40) { logbuf.shift(); }
            } catch (e) {}
            return orig && orig.apply(console, arguments);
        };
    });
    window.addEventListener('error', function (e) {
        logbuf.push('!! ' + (e.message || 'error') + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno);
        if (logbuf.length > 40) { logbuf.shift(); }
    });

    function short(u) {
        try { u = String(u).split('?')[0]; } catch (e) {}
        var p = u.split('/'); return p.slice(-2).join('/');
    }
    function record(u, ms, ok, len) {
        if (ok) { nDone++; } else { nFail++; }
        if (len > 0) { bytes += len; }
        if (ms >= 1200) {
            slow.push({ u: short(u), ms: Math.round(ms) });
            slow.sort(function (a, b) { return b.ms - a.ms; });
            if (slow.length > 6) { slow.length = 6; }
        }
    }

    var _fetch = window.fetch;
    if (_fetch) {
        window.fetch = function (input, init) {
            var u = (input && input.url) || input;
            var s = performance.now();
            inflight++;
            return _fetch.apply(this, arguments).then(function (res) {
                inflight--;
                var len = parseInt(res.headers && res.headers.get && res.headers.get('content-length'), 10) || 0;
                record(u, performance.now() - s, res.ok, len);
                return res;
            }, function (err) {
                inflight--; record(u, performance.now() - s, false, 0);
                throw err;
            });
        };
    }

    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__s = 0; return _open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
        var x = this; x.__s = performance.now(); inflight++;
        x.addEventListener('loadend', function () {
            inflight--;
            var len = 0; try { len = parseInt(x.getResponseHeader('content-length'), 10) || 0; } catch (e) {}
            record(x.__u, performance.now() - x.__s, x.status >= 200 && x.status < 400, len);
        });
        return _send.apply(this, arguments);
    };

    // main-thread jank meter
    (function tick() {
        var now = performance.now();
        var gap = now - last; last = now;
        if (gap > 250) { jank++; if (gap > maxGap) { maxGap = gap; } }
        requestAnimationFrame(tick);
    })();

    var hidden = false;
    function build() {
        if (!document.body) { return void document.addEventListener('DOMContentLoaded', build); }
        var d = document.createElement('div');
        d.id = 'fm-diag';
        d.style.cssText =
            'position:fixed;left:2px;top:2px;z-index:2147483646;pointer-events:auto;' +
            'font:9px/1.3 monospace;color:#7fffca;background:rgba(0,0,0,.72);' +
            'padding:3px 6px;border-radius:4px;white-space:pre;max-width:92vw;max-height:52vh;overflow:hidden;';
        d.addEventListener('click', function () { hidden = !hidden; d.style.opacity = hidden ? '0.12' : '1'; });
        document.body.appendChild(d);
        setInterval(function () {
            if (hidden) { return; }
            var s = Math.round((Date.now() - t0) / 1000);
            var wl = 'ws ' + ws.state + (ws.openedMs ? ' (' + (ws.openedMs / 1000).toFixed(1) + 's)' : '') +
                '  rx ' + ws.rx + ' tx ' + ws.tx + (ws.closes ? ' close ' + ws.closes : '') + (ws.errs ? ' ERR ' + ws.errs : '') +
                (ws.url ? '  ' + ws.url : '');
            var txt = 'FM diag ' + s + 's   net ' + nDone + '/' + nFail + 'f/' + inflight + 'p  ' +
                (bytes / 1048576).toFixed(1) + 'MB  jank ' + jank + '(' + Math.round(maxGap) + 'ms)\n' + wl;
            if (slow.length) {
                txt += '\nslow: ' + slow.map(function (x) { return x.u + ' ' + (x.ms / 1000).toFixed(1) + 's'; }).join('  ');
            }
            txt += '\n-- log --\n' + logbuf.slice(-14).join('\n');
            d.textContent = txt;
        }, 500);
    }
    build();
})();
"""

/**
 * Appended to the generated Config.local.js. A standalone, framework-free
 * "Download game data now / later" prompt (RagnaFinest-style) that pre-warms
 * the WebView HTTP cache from the Remote Client's /data/manifest.txt so later
 * map loads are cache hits. Independent of the roBrowser build so a web
 * rebuild never drops it.
 */
fun prefetchBootstrapJs(): String = """
/* ---- Fate MMO asset prefetch (auto-generated) ---- */
(function () {
    var CFG = window.ROConfigLocal || {};
    var BASE = String(CFG.remoteClient || '').replace(/\/${'$'}/, '');
    if (!BASE) { return; }

    var DONE = 'fatemmo.assets.done.v1';
    var LATER = 'fatemmo.assets.later.v1';
    var LATER_MS = 12 * 3600 * 1000;
    try {
        if (localStorage.getItem(DONE)) { return; }
        var t = parseInt(localStorage.getItem(LATER) || '0', 10);
        if (t && (Date.now() - t) < LATER_MS) { return; }
    } catch (e) {}

    var pool = { stop: false };

    function el(tag, css, html) {
        var e = document.createElement(tag);
        if (css) { e.style.cssText = css; }
        if (html != null) { e.innerHTML = html; }
        return e;
    }

    /* roBrowser installs global touch handlers that can eat synthesised
       click events, so bind touch + pointer + click and de-dupe. */
    function tap(node, fn) {
        if (!node) { return; }
        var lock = false;
        function h(e) {
            if (lock) { return; }
            lock = true;
            setTimeout(function () { lock = false; }, 600);
            if (e.cancelable) { e.preventDefault(); }
            e.stopPropagation();
            fn(e);
        }
        node.addEventListener('touchend', h, true);
        node.addEventListener('pointerup', h, true);
        node.addEventListener('click', h, true);
    }

    function build() {
        if (!document.body) { return void document.addEventListener('DOMContentLoaded', build); }
        if (document.getElementById('fatemmo-prefetch')) { return; }

        var ov = el('div', 'position:fixed;inset:0;z-index:2147483647;background:rgba(6,8,14,.92);pointer-events:auto;' +
            'display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif;');
        ov.id = 'fatemmo-prefetch';
        // swallow gestures that land on the backdrop itself (not on the card)
        ['touchstart', 'touchmove', 'pointerdown', 'mousedown'].forEach(function (t) {
            ov.addEventListener(t, function (e) { if (e.target === ov) { e.stopPropagation(); } }, false);
        });

        var card = el('div', 'width:min(88vw,420px);background:#12151d;border:1px solid #2c313d;border-radius:12px;pointer-events:auto;' +
            'padding:20px 20px 16px;color:#e8eaee;box-shadow:0 12px 40px rgba(0,0,0,.5);');
        card.innerHTML =
            '<div style="font-size:17px;font-weight:bold;margin-bottom:8px">Download game data?</div>' +
            '<div id="fmp-msg" style="font-size:13px;line-height:1.5;color:#b9bfca">' +
            'Pre-download maps and graphics now so the game loads fast later.<br>' +
            'Best on Wi&#8209;Fi &mdash; this can be 1&ndash;3&nbsp;GB. You can also skip and let it stream as you play.' +
            '</div>' +
            '<div id="fmp-bar-wrap" style="display:none;margin-top:14px">' +
            '  <div style="height:10px;background:#1e2230;border-radius:6px;overflow:hidden;border:1px solid #2c313d">' +
            '    <div id="fmp-bar" style="height:100%;width:0;background:linear-gradient(90deg,#7a5abe,#4a90d9);transition:width .2s"></div>' +
            '  </div>' +
            '  <div id="fmp-count" style="font-size:12px;color:#9aa2af;margin-top:6px">Preparing&hellip;</div>' +
            '</div>' +
            '<div id="fmp-btns" style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">' +
            '  <button id="fmp-later" style="pointer-events:auto;touch-action:manipulation;padding:12px 18px;min-height:44px;border-radius:8px;border:1px solid #3a4150;background:#1b1f29;color:#cfd4dd;font-size:14px;font-weight:bold">Later</button>' +
            '  <button id="fmp-now" style="pointer-events:auto;touch-action:manipulation;padding:12px 20px;min-height:44px;border-radius:8px;border:0;background:#4a90d9;color:#fff;font-size:14px;font-weight:bold">Download now</button>' +
            '</div>';

        ov.appendChild(card);
        document.body.appendChild(ov);

        function chooseLater() {
            try { localStorage.setItem(LATER, String(Date.now())); } catch (e) {}
            dismiss();
        }
        function chooseNow() {
            card.querySelector('#fmp-btns').style.display = 'none';
            card.querySelector('#fmp-bar-wrap').style.display = 'block';
            var b = el('button', 'margin-top:14px;padding:12px 14px;min-height:44px;border-radius:8px;border:1px solid #3a4150;' +
                'background:#1b1f29;color:#cfd4dd;font-size:13px;font-weight:bold;width:100%;pointer-events:auto;touch-action:manipulation');
            b.textContent = 'Play now (stop downloading)';
            tap(b, function () { pool.stop = true; markLater(); dismiss(); });
            card.appendChild(b);
            start();
        }

        tap(card.querySelector('#fmp-later'), chooseLater);
        tap(card.querySelector('#fmp-now'), chooseNow);
        // tapping the dark area outside the card = Later (bubble phase, backdrop only)
        var bdLock = false;
        function backdrop(e) {
            if (e.target !== ov || bdLock) { return; }
            bdLock = true;
            chooseLater();
        }
        ov.addEventListener('touchend', backdrop, false);
        ov.addEventListener('click', backdrop, false);
    }

    function setMsg(s) { var m = document.getElementById('fmp-msg'); if (m) { m.innerHTML = s; } }
    function markLater() { try { localStorage.setItem(LATER, String(Date.now())); } catch (e) {} }
    function dismiss() {
        pool.stop = true;
        var ov = document.getElementById('fatemmo-prefetch');
        if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
    }

    function start() {
        fetch(BASE + '/data/manifest.txt', { mode: 'cors', cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.text() : Promise.reject('HTTP ' + r.status); })
            .then(function (txt) {
                var list = txt.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
                if (!list.length) { return Promise.reject('empty manifest'); }
                run(list);
            })
            .catch(function (err) {
                setMsg('Couldn\'t get the data list from the server (' + err + ').<br>' +
                    'No problem &mdash; the game will download what it needs as you play.');
                var w = document.getElementById('fmp-bar-wrap'); if (w) { w.style.display = 'none'; }
                markLater();
                setTimeout(dismiss, 4500);
            });
    }

    function run(list) {
        var total = list.length, done = 0, idx = 0, CONC = 6;
        var bar = document.getElementById('fmp-bar');
        var cnt = document.getElementById('fmp-count');

        function tick() {
            done++;
            if (bar) { bar.style.width = (done / total * 100).toFixed(1) + '%'; }
            if (cnt) { cnt.textContent = 'Downloading ' + done + ' / ' + total + ' files'; }
            if (done >= total && !pool.stop) { finish(); }
        }
        function enc(p) { return p.replace(/[^/]+/g, function (a) { return encodeURIComponent(a); }); }
        function next() {
            if (pool.stop) { return; }
            if (idx >= list.length) { return; }
            var p = list[idx++];
            fetch(BASE + '/data/' + enc(p), { mode: 'cors', cache: 'force-cache' })
                .then(function (r) { return r && r.arrayBuffer ? r.arrayBuffer() : null; })
                .catch(function () {})
                .then(function () { tick(); next(); });
        }
        for (var k = 0; k < CONC; k++) { next(); }
    }

    function finish() {
        try { localStorage.setItem(DONE, String(Date.now())); localStorage.removeItem(LATER); } catch (e) {}
        var cnt = document.getElementById('fmp-count');
        if (cnt) { cnt.textContent = 'Done — game data cached.'; }
        setTimeout(dismiss, 900);
    }

    build();
})();
"""

// Any task that reads the merged/generated assets must run after we write Config.local.js.
tasks.matching {
    val n = it.name
    (n.startsWith("merge") && n.endsWith("Assets")) ||
        n.startsWith("generateAssets") ||
        n.contains("Lint") || n.contains("lint") ||
        n.startsWith("package") || n.startsWith("bundle")
}.configureEach { dependsOn(generateRoBrowserConfig) }
