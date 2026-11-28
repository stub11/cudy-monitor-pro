package dev.cm.monitor

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One remembered home router. All fields, including the SSH password, are
 * encrypted as one record using a non-exportable Android Keystore AES key.
 * No credentials are ever sent to GitHub reports or included in builds.
 */
internal data class SavedRouter(
    val name: String,
    val host: String,
    val port: Int,
    val username: String,
    val password: String
)

internal class RouterProfileStore(context: Context) {
    private val preferences = context.getSharedPreferences("cm_router_profiles", Context.MODE_PRIVATE)
    private val alias = "cm_router_ssh_profile_aes_v1"

    private fun secretKey(): SecretKey {
        val keystore = KeyStore.getInstance("AndroidKeyStore")
        keystore.load(null)
        (keystore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    @Synchronized
    fun save(profile: SavedRouter) {
        require(profile.name.isNotBlank() && profile.name.length <= 60)
        require(profile.host.length <= 45 && profile.port in 1..65535)
        require(profile.username.isNotBlank() && profile.password.isNotEmpty())
        val json = JSONObject().apply {
            put("name", profile.name.trim())
            put("host", profile.host.trim())
            put("port", profile.port)
            put("username", profile.username.trim())
            put("password", profile.password)
        }.toString()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.iv + cipher.doFinal(json.toByteArray(Charsets.UTF_8))
        preferences.edit().putString("selected_router", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()
    }

    @Synchronized
    fun load(): SavedRouter? {
        val encoded = preferences.getString("selected_router", null) ?: return null
        return try {
            val encrypted = Base64.decode(encoded, Base64.DEFAULT)
            if (encrypted.size < 29) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
            val data = JSONObject(String(cipher.doFinal(encrypted.copyOfRange(12, encrypted.size)), Charsets.UTF_8))
            SavedRouter(data.getString("name"), data.getString("host"), data.getInt("port"),
                data.getString("username"), data.getString("password"))
        } catch (_: Exception) {
            null // Stale/unreadable keystore data is never treated as a valid login.
        }
    }

    @Synchronized
    fun clear() {
        preferences.edit().remove("selected_router").commit()
    }
}
