package com.fatemmo.client

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewAssetLoader.AssetsPathHandler

/**
 * Thin, full-screen WebView host for the roBrowserLegacy build bundled under
 * assets/web/. All server-specific configuration is injected at build time from
 * client.env.properties (see BuildConfig + assets/web/Config.local.js).
 */
class MainActivity : ComponentActivity() {

    private companion object {
        const val TAG = "FateMMO"
        const val VIRTUAL_HOST = "appassets.androidplatform.net"
    }

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var lastBackPress = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge + immersive: the game draws its own UI.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        assetLoader = WebViewAssetLoader.Builder()
            .setHttpAllowed(true)                       // serve bundle over http:// (no mixed-content vs ws://)
            .setDomain(VIRTUAL_HOST)
            .addPathHandler("/assets/", AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(0xFF060810.toInt())
            isFocusableInTouchMode = true
        }
        setContentView(webView)

        // Edge-to-edge means adjustResize won't shrink the view automatically -
        // pad the WebView by the keyboard height so roBrowser's bottom-anchored
        // chat input rises above the Android soft keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, ime)
            insets
        }

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            javaScriptCanOpenWindowsAutomatically = true
            @Suppress("DEPRECATION")
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = "$userAgentString FateMMOClient/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView, request: WebResourceRequest
            ): Boolean {
                // Keep everything inside the WebView; roBrowser never navigates away.
                return false
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    Log.e(TAG, "main-frame load error ${error.errorCode}: ${error.description} @ ${request.url}")
                    Toast.makeText(this@MainActivity,
                        "Load error: ${error.description}", Toast.LENGTH_LONG).show()
                } else {
                    Log.w(TAG, "subresource error ${error.errorCode} @ ${request.url}")
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                Log.i(TAG, "page finished: $url")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                val where = "${m.sourceId()}:${m.lineNumber()}"
                val msg = "[web] ${m.message()} ($where)"
                when (m.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.e(TAG, msg)
                    ConsoleMessage.MessageLevel.WARNING -> Log.w(TAG, msg)
                    else -> Log.i(TAG, msg)
                }
                return true
            }

            override fun onProgressChanged(view: WebView, newProgress: Int) {
                if (newProgress == 100) Log.i(TAG, "web load 100%")
            }

            // Not overridden before now, so window.alert() had no guaranteed
            // behavior in this WebView (base WebChromeClient may silently no-op
            // rather than actually blocking). Needed for a diagnostic pause in
            // the JS layer (roBrowser) that must reliably hold execution until
            // the tester dismisses it - a plain console log isn't enough since
            // the on-screen diag overlay's log buffer gets overwritten too fast
            // to reliably screenshot otherwise. Harmless to keep generally.
            override fun onJsAlert(
                view: WebView, url: String, message: String, result: JsResult
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setOnCancelListener { result.confirm() }
                    .setCancelable(false)
                    .show()
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // 1) If the soft keyboard is up (chat input), just close it.
                if (hideImeIfVisible()) {
                    return
                }
                // 2) Otherwise feed ESC to the game (closes an open window / cancels
                //    a skill / closes an NPC dialog - roBrowser handles it).
                dispatchKeyToWeb(KeyEvent.KEYCODE_ESCAPE)
                // 3) Only a second back within 2s actually quits.
                val now = SystemClock.elapsedRealtime()
                if (now - lastBackPress < 2000) {
                    finish()
                } else {
                    lastBackPress = now
                    Toast.makeText(this@MainActivity,
                        "Press back again to quit ${BuildConfig.DISPLAY_NAME}", Toast.LENGTH_SHORT).show()
                }
            }
        })

        Log.i(TAG, "loading ${BuildConfig.CLIENT_URL}  (server=${BuildConfig.SERVER_ADDRESS}, wsproxy=${BuildConfig.WSPROXY_URL})")
        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.CLIENT_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    private fun dispatchKeyToWeb(keyCode: Int) {
        val t = SystemClock.uptimeMillis()
        webView.dispatchKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, keyCode, 0))
        webView.dispatchKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, keyCode, 0))
    }

    /** @return true if the soft keyboard was showing and has now been dismissed. */
    private fun hideImeIfVisible(): Boolean {
        val insets = ViewCompat.getRootWindowInsets(webView) ?: return false
        if (!insets.isVisible(WindowInsetsCompat.Type.ime())) {
            return false
        }
        // Drop focus from roBrowser's chat input, then hide the IME.
        webView.evaluateJavascript(
            "(function(){var e=document.activeElement;" +
                "while(e&&e.shadowRoot&&e.shadowRoot.activeElement)e=e.shadowRoot.activeElement;" +
                "if(e&&e.blur)e.blur();})();",
            null
        )
        WindowInsetsControllerCompat(window, webView).hide(WindowInsetsCompat.Type.ime())
        return true
    }

    private fun hideSystemBars() {
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.hide(WindowInsetsCompat.Type.systemBars())
        c.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
        // Deliberately NOT calling webView.pauseTimers() here: it freezes ALL
        // JavaScript timers process-wide (not just this WebView), including the
        // game's WebSocket ping/keepalive and packet handling. Since this is a
        // live-connection multiplayer client, even a brief background pause
        // (switching apps, taking a screenshot, a notification) would silently
        // kill the connection - the socket keeps "working" at the OS level but
        // nothing processes it until resume, so by the time JS resumes the
        // server has usually already timed the session out. onPause() alone
        // still lets the WebView stop non-essential rendering work.
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
        webView.onResume()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) hideSystemBars()
    }

    override fun onDestroy() {
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.stopLoading()
        webView.settings.javaScriptEnabled = false
        webView.clearHistory()
        webView.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }
}
