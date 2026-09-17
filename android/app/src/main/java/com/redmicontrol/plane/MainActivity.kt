package com.redmicontrol.plane

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        hideSystemNavigationBar()
        setContent { ControlApp() }
    }

    private fun hideSystemNavigationBar() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemNavigationBar()
    }
}

@Composable
private fun ControlApp() {
    val context = LocalContext.current
    var credentials by remember { mutableStateOf(SecureCredentials.load(context)) }
    if (credentials == null) {
        SetupScreen { endpoint, token ->
            SecureCredentials.save(context, endpoint, token)
            credentials = SecureCredentials.load(context)
        }
    } else {
        LaunchedEffect(Unit) { ContextCompat.startForegroundService(context, Intent(context, ControlService::class.java)) }
        ControlPanelWebView(credentials!!, onReconfigure = {
            SecureCredentials.clear(context)
            credentials = null
        })
    }
}

@Composable
private fun SetupScreen(onSave: (String, String) -> Unit) {
    var endpoint by remember { mutableStateOf("http://127.0.0.1:3000") }
    var token by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Redmi Control", style = MaterialTheme.typography.headlineMedium)
            Text("Configura el servidor del panel", modifier = Modifier.padding(top = 8.dp, bottom = 24.dp))
            OutlinedTextField(endpoint, { endpoint = it }, modifier = Modifier.fillMaxWidth(), label = { Text("URL del backend") }, singleLine = true)
            OutlinedTextField(token, { token = it }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), label = { Text("Token del panel") }, singleLine = true)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
            Button(modifier = Modifier.fillMaxWidth().padding(top = 20.dp), onClick = {
                runCatching { onSave(endpoint, token) }.onFailure { error = it.message ?: "No se pudo guardar la configuración" }
            }) { Text("Guardar y abrir panel") }
            Text("El token se guarda cifrado con Android Keystore y no se incrusta en el APK.", modifier = Modifier.padding(top = 16.dp))
        }
    }
}

@Composable
private fun ControlPanelWebView(credentials: ControlCredentials, onReconfigure: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val target = request.url
                            val base = Uri.parse(credentials.endpoint)
                            return if (target.scheme == base.scheme && target.host == base.host && target.port == base.port) {
                                false
                            } else {
                                context.startActivity(Intent(Intent.ACTION_VIEW, target))
                                true
                            }
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            if (url.startsWith(credentials.endpoint)) {
                                val token = org.json.JSONObject.quote(credentials.token)
                                view.evaluateJavascript("window.controlPlaneLogin && window.controlPlaneLogin($token);", null)
                            }
                        }
                    }
                    loadUrl("${credentials.endpoint}/?v=4")
                }
            }
        )
        TextButton(onClick = onReconfigure, modifier = Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 8.dp)) {
            Text("Conexión")
        }
    }
}
