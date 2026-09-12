package com.redmicontrol.plane

import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ContextCompat.startForegroundService(this, Intent(this, ControlService::class.java))
        setContent { ControlPanelWebView() }
    }
}

@Composable
private fun ControlPanelWebView() {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = false
                    override fun onPageFinished(view: WebView, url: String) {
                        if (url.startsWith("http://127.0.0.1:3000/") && BuildConfig.CONTROL_TOKEN.isNotEmpty()) {
                            val token = org.json.JSONObject.quote(BuildConfig.CONTROL_TOKEN)
                            view.evaluateJavascript("if (!localStorage.getItem('control_token')) { localStorage.setItem('control_token', $token); location.reload(); }", null)
                        }
                    }
                }
                settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
                loadUrl("http://127.0.0.1:3000/?v=3")
            }
        }
    )
}
