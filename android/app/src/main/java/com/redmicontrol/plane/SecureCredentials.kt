package com.redmicontrol.plane

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class ControlCredentials(val endpoint: String, val token: String)

/** Stores connection secrets outside BuildConfig and the APK resources. */
object SecureCredentials {
    private const val preferences = "control_credentials"
    private const val encryptedValue = "value"
    private const val keyAlias = "redmi-control-credentials"
    private const val transformation = "AES/GCM/NoPadding"

    fun load(context: Context): ControlCredentials? = runCatching {
        val encoded = context.getSharedPreferences(preferences, Context.MODE_PRIVATE)
            .getString(encryptedValue, null) ?: return null
        val payload = JSONObject(decrypt(getKey(), Base64.decode(encoded, Base64.NO_WRAP)))
        val endpoint = payload.optString("endpoint").trim().trimEnd('/')
        val token = payload.optString("token").trim()
        if (endpoint.isBlank() || token.isBlank()) null else ControlCredentials(endpoint, token)
    }.getOrNull()

    fun save(context: Context, endpoint: String, token: String) {
        val cleanEndpoint = endpoint.trim().trimEnd('/')
        val uri = Uri.parse(cleanEndpoint)
        require(uri.scheme == "http" || uri.scheme == "https") { "La URL debe comenzar por http:// o https://" }
        require(!uri.host.isNullOrBlank()) { "La URL debe incluir un host válido" }
        require(uri.scheme == "https" || isPrivateHttpHost(uri.host!!)) {
            "Las conexiones HTTP solo se permiten a localhost, LAN o Tailscale"
        }
        require(token.trim().length >= 16) { "El token debe tener al menos 16 caracteres" }
        val plaintext = JSONObject().put("endpoint", cleanEndpoint).put("token", token.trim()).toString()
        val encrypted = encrypt(getKey(), plaintext)
        context.getSharedPreferences(preferences, Context.MODE_PRIVATE).edit()
            .putString(encryptedValue, Base64.encodeToString(encrypted, Base64.NO_WRAP)).apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(preferences, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun getKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(false)
                .build())
        }.generateKey()
    }

    private fun encrypt(key: SecretKey, value: String): ByteArray {
        val cipher = Cipher.getInstance(transformation).apply { init(Cipher.ENCRYPT_MODE, key) }
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return byteArrayOf(iv.size.toByte()) + iv + ciphertext
    }

    private fun decrypt(key: SecretKey, payload: ByteArray): String {
        val ivSize = payload.first().toInt()
        require(ivSize in 12..16 && payload.size > ivSize + 1)
        val iv = payload.copyOfRange(1, ivSize + 1)
        val ciphertext = payload.copyOfRange(ivSize + 1, payload.size)
        return Cipher.getInstance(transformation).apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        }.doFinal(ciphertext).toString(StandardCharsets.UTF_8)
    }

    private fun isPrivateHttpHost(host: String): Boolean {
        val normalized = host.lowercase()
        if (normalized == "localhost" || normalized == "::1" || normalized == "127.0.0.1") return true
        val octets = normalized.split('.').mapNotNull { it.toIntOrNull() }
        if (octets.size != 4 || normalized.split('.').size != 4) return false
        val first = octets[0]
        val second = octets[1]
        return first == 10 ||
            (first == 172 && second in 16..31) ||
            (first == 192 && second == 168) ||
            (first == 100 && second in 64..127)
    }
}
