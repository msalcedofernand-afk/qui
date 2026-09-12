package com.redmicontrol.plane

/** KernelSU bridge: only fixed package/service operations are allowed. */
object RootHelper {
    private val protectedPackages = setOf(
        "android", "com.android.systemui", "com.android.phone", "com.android.settings",
        "com.android.launcher3", "com.google.android.inputmethod.latin", "com.android.externalstorage",
        "com.android.providers.media.module", "com.android.networkstack", "com.android.bluetooth",
        "com.android.nfc", "com.google.android.gms", "com.google.android.gsf", "com.google.android.webview",
        "com.google.android.documentsui", "com.google.android.verifier", "com.google.android.configupdater",
        "com.android.vending", "com.termux", "com.tailscale.ipn", "me.weishu.kernelsu"
    )
    private val packagePattern = Regex("[A-Za-z0-9_\\.]{1,180}")
    private val serviceTargets = setOf("crafty", "minecraft", "control-plane")

    fun isProtectedPackage(target: String) = target in protectedPackages

    fun apply(action: String, target: String): Result<Unit> {
        val command = when (action) {
            "freeze" -> {
                if (!packagePattern.matches(target) || isProtectedPackage(target)) return Result.failure(IllegalArgumentException("protected_target"))
                listOf("cmd", "package", "suspend", "--user", "0", target)
            }
            "unfreeze" -> {
                if (!packagePattern.matches(target)) return Result.failure(IllegalArgumentException("invalid_package"))
                listOf("cmd", "package", "unsuspend", "--user", "0", target)
            }
            "force-stop" -> {
                if (!packagePattern.matches(target) || isProtectedPackage(target)) return Result.failure(IllegalArgumentException("protected_target"))
                listOf("am", "force-stop", "--user", "0", target)
            }
            "start-service", "stop-service" -> {
                if (target !in serviceTargets) return Result.failure(IllegalArgumentException("service_not_allowed"))
                return Result.failure(UnsupportedOperationException("service_adapter_not_configured"))
            }
            "set-cpu-mode" -> return Result.failure(UnsupportedOperationException("cpu_adapter_not_configured"))
            else -> return Result.failure(IllegalArgumentException("action_not_allowed"))
        }
        return runRoot(command)
    }

    private fun runRoot(argv: List<String>): Result<Unit> = try {
        val command = argv.joinToString(" ") { it.replace("'", "'\\''") }
        val process = ProcessBuilder("su", "-c", command).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        if (process.waitFor() == 0) Result.success(Unit) else Result.failure(IllegalStateException(output.trim().ifEmpty { "root_command_failed" }))
    } catch (error: Exception) {
        Result.failure(error)
    }
}
