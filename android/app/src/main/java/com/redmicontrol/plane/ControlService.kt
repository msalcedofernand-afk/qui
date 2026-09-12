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
        syncProfile()
        while (running) {
            try {
                val connection = (URL("http://127.0.0.1:3000/api/events").openConnection() as HttpURLConnection).apply {
                    setRequestProperty("Authorization", "Bearer ${BuildConfig.CONTROL_TOKEN}")
                    connectTimeout = 5000
                    readTimeout = 0
                }
                connection.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> if (running && line.startsWith("event: profile.changed")) syncProfile() }
                }
                connection.disconnect()
            } catch (_: Exception) {
                if (running) Thread.sleep(3000)
            }
        }
    }

    private fun syncProfile() {
        try {
            val state = JSONObject(readRootFile("/data/adb/linux/alpine/opt/redmi-control/server/data/state.json"))
            val profiles = JSONArray(readRootFile("/data/adb/linux/alpine/opt/redmi-control/server/data/profiles.json"))
            val active = state.optString("activeProfile", "normal")
            if (active == lastProfile) return
            updateWakeLock(active == "minecraft")
            val allManaged = mutableSetOf<String>()
            var selected: JSONObject? = null
            for (index in 0 until profiles.length()) {
                val profile = profiles.getJSONObject(index)
                profile.optJSONArray("freezeApps")?.let { allManaged.addAll(it.toStringList()) }
                if (profile.optString("id") == active) selected = profile
            }
            allManaged.forEach { RootHelper.apply("unfreeze", it) }
            // Stop first so suspension releases the app process and its RAM immediately.
            selected?.optJSONArray("freezeApps")?.toStringList()?.forEach {
                RootHelper.apply("force-stop", it)
                RootHelper.apply("freeze", it)
            }
            selected?.optJSONArray("stopApps")?.toStringList()?.forEach { RootHelper.apply("force-stop", it) }
            lastProfile = active
        } catch (_: Exception) {
            // The panel may still be starting; retry on the next service tick.
        }
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

    private fun readRootFile(path: String): String {
        val process = ProcessBuilder("su", "-c", "cat '$path'").start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        process.waitFor(3, TimeUnit.SECONDS)
        return output
    }

    private fun JSONArray.toStringList(): List<String> = List(length()) { index -> getString(index) }
}
