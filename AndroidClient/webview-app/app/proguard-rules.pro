# WebView shell — keep JS interface (none defined yet, but future-proof).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.fatemmo.client.** { *; }
