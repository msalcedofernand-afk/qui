package com.redmicontrol.plane

import android.app.*
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import androidx.core.app.NotificationCompat

class ControlService : Service() {
    @Volatile private var running = false
    private var lastProfile = ""
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel("control", "Control plane", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        startForeground(7, NotificationCompat.Builder(this, "control").setSmallIcon(android.R.drawable.ic_lock_idle_lock).setContentTitle("Redmi Control activo").setContentText("Monitorizando el perfil del dispositivo").setOngoing(true).build())
        running = true
        Thread({ eventLoop() }, "control-plane-events").start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        running = false
        releaseWakeLock()
        super.onDestroy()
    }

    private fun eventLoop() {
        while (running) {
            try {
                processNextCommand()
                val connection = (URL("http://127.0.0.1:3000/internal/broker/events").openConnection() as HttpURLConnection).apply {
                    setRequestProperty("Authorization", "Bearer ${BuildConfig.CONTROL_TOKEN}")
                    connectTimeout = 5000
                    readTimeout = 0
                }
                connection.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> if (running && line.startsWith("event: broker.command")) processNextCommand() }
                }
                connection.disconnect()
            } catch (_: Exception) {
                if (running) Thread.sleep(3000)
            }
        }
    }

    private fun processNextCommand() {
        if (BuildConfig.CONTROL_TOKEN.isEmpty()) return
        val next = request("GET", "/internal/broker/commands/next") ?: return
        val id = next.optString("id")
        if (id.isEmpty()) return
        val claimed = request("POST", "/internal/broker/commands/$id/claim", JSONObject().put("brokerId", "android-root"))
        if (claimed?.optString("status") != "running") return
        try {
            val ok = when (next.optString("type")) {
                "profile.activate" -> {
                    val payload = next.optJSONObject("payload")
                    applyProfile(payload?.optJSONObject("profile"), payload?.optJSONObject("previousProfile"))
                }
                else -> false
            }
            request("POST", "/internal/broker/commands/$id/result", JSONObject().put("status", if (ok) "succeeded" else "failed").put("error", if (ok) JSONObject.NULL else "typed_command_failed"))
        } catch (error: Exception) {
            request("POST", "/internal/broker/commands/$id/result", JSONObject().put("status", "failed").put("error", error.message ?: "broker_execution_failed"))
        }
    }

    private fun applyProfile(profile: JSONObject?, previousProfile: JSONObject?): Boolean {
        if (profile == null) return false
        val active = profile.optString("id", "normal")
        val previousActive = previousProfile?.optString("id")?.ifEmpty { lastProfile.ifEmpty { "normal" } }
            ?: lastProfile.ifEmpty { "normal" }
        updateWakeLock(active == "minecraft")
        val previousFrozen = previousProfile?.optJSONArray("freezeApps")?.toStringList() ?: emptyList()
        val frozen = profile.optJSONArray("freezeApps")?.toStringList() ?: emptyList()
        val stopped = profile.optJSONArray("stopApps")?.toStringList() ?: emptyList()
        val unfrozen = mutableListOf<String>()
        val suspended = mutableListOf<String>()
        var ok = true
        previousFrozen.filterNot { it in frozen }.forEach { pkg ->
            val result = RootHelper.apply("unfreeze", pkg)
            ok = result.isSuccess && ok
            if (result.isSuccess) unfrozen += pkg
        }
        frozen.forEach { pkg ->
            val stoppedResult = RootHelper.apply("force-stop", pkg)
            val suspendResult = RootHelper.apply("freeze", pkg)
            ok = stoppedResult.isSuccess && suspendResult.isSuccess && ok
            if (suspendResult.isSuccess) suspended += pkg
        }
        stopped.forEach { pkg -> ok = RootHelper.apply("force-stop", pkg).isSuccess && ok }
        val cpuMode = profile.optString("cpuMode", "balanced")
        ok = RootHelper.apply("set-cpu-mode", cpuMode).isSuccess && ok
        if (!ok) {
            // Compensate changes already made. force-stop is intentionally not
            // reversed because restarting arbitrary apps is unsafe.
            suspended.asReversed().forEach { RootHelper.apply("unfreeze", it) }
            unfrozen.asReversed().forEach { RootHelper.apply("freeze", it) }
            previousProfile?.optString("cpuMode")?.takeIf { it.isNotEmpty() }?.let { RootHelper.apply("set-cpu-mode", it) }
            updateWakeLock(previousActive == "minecraft")
            return false
        }
        lastProfile = active
        return ok
    }

    private fun updateWakeLock(enabled: Boolean) {
        if (enabled && wakeLock?.isHeld != true) {
            val manager = getSystemService(PowerManager::class.java)
            wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RedmiControl:Minecraft").apply {
                setReferenceCounted(false)
                acquire()
            }
        } else if (!enabled) releaseWakeLock()
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject? {
        val connection = (URL("http://127.0.0.1:3000$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 4000; readTimeout = 8000
            setRequestProperty("Authorization", "Bearer ${BuildConfig.CONTROL_TOKEN}")
            if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json") }
        }
        body?.toString()?.toByteArray()?.let { bytes -> connection.outputStream.use { stream -> stream.write(bytes) } }
        if (connection.responseCode == 204) return null
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
        if (connection.responseCode !in 200..299) throw IllegalStateException("control_http_${connection.responseCode}: ${text.take(300)}")
        return JSONObject(text)
    }

    private fun JSONArray.toStringList(): List<String> = List(length()) { index -> getString(index) }
}
