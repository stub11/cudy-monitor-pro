package dev.cm.monitor

import android.content.Context
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.KeyPairGenerator
import java.security.Security
import java.security.MessageDigest
import java.security.PublicKey
import java.util.Base64
import java.util.concurrent.TimeUnit

class UntrustedHostKey(val fingerprint: String) : Exception("Требуется подтверждение ключа SSH")
class ChangedHostKey : Exception("Ключ роутера изменился. Подключение заблокировано.")

class RouterClient(private val context: Context) {
    companion object {
        // Android's built-in provider named BC can lack X25519.
        // SSHJ resolves BC by name; install the bundled full provider first.
        @Synchronized
        private fun prepareSshCrypto() {
            val current = Security.getProvider("BC")
            if (current != null &&
                runCatching { KeyPairGenerator.getInstance("X25519", current) }.isSuccess
            ) return

            Security.removeProvider("BC")
            val position = Security.insertProviderAt(BouncyCastleProvider(), 1)
            check(position > 0) { "Не удалось включить криптопровайдер SSH" }
            KeyPairGenerator.getInstance("X25519", "BC")
        }
    }
    private val store = context.getSharedPreferences("ssh_pins", Context.MODE_PRIVATE)
    // Intentionally constant: never concatenate user-supplied strings into shell commands.
    private val readOnlyCommand = """
        printf 'UPTIME='; cut -d ' ' -f 1 /proc/uptime
        printf 'MEMTOTAL='; awk '/^MemTotal:/{print $2}' /proc/meminfo
        printf 'MEMAVAILABLE='; awk '/^MemAvailable:/{print $2}' /proc/meminfo
        printf 'TEMP='; cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0
        printf 'LOAD='; cut -d ' ' -f 1-3 /proc/loadavg
        printf 'D2K='; if pidof d2kd >/dev/null 2>&1; then echo 1; else echo 0; fi
        printf 'DOQ='; if pidof doqd >/dev/null 2>&1; then echo 1; else echo 0; fi
        printf 'CPU='; awk 'NR==1 {idle=$5+$6; total=0; for(i=2;i<=NF;i++)total+=${'$'}i; printf "%.0f,%.0f\n", total, idle}' /proc/stat
        printf 'NETRX='; awk 'NR>2 && $1 !~ /^lo:/ {gsub(/:/, "", $1); total += $2} END {printf "%.0f\n", total+0}' /proc/net/dev
        printf 'NETTX='; awk 'NR>2 && $1 !~ /^lo:/ {gsub(/:/, "", $1); total += $10} END {printf "%.0f\n", total+0}' /proc/net/dev
        printf 'STORAGE='; df -k /opt 2>/dev/null | awk 'NR==2 {print $2","$4}'
    """.trimIndent().replace("\n", "; ")

    fun approve(host: String, port: Int, fingerprint: String) {
        store.edit().putString("$host:$port", fingerprint).apply()
    }
    private fun privateIpv4(host: String): Boolean {
        val parts = host.split(".").mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        return parts[0] == 10 || (parts[0] == 172 && parts[1] in 16..31) ||
            (parts[0] == 192 && parts[1] == 168)
    }
    fun fetch(host: String, port: Int, username: String, password: String): RouterSnapshot {
        require(privateIpv4(host)) { "Укажи локальный IPv4 роутера" }
        require(port in 1..65535) { "Некорректный порт SSH" }
        require(username.isNotBlank()) { "Укажи имя пользователя" }
        val pinned = store.getString("$host:$port", null)
        var untrustedFingerprint: String? = null
        var changedKey = false
        try {
          prepareSshCrypto()
          SSHClient().use { ssh ->
            ssh.addHostKeyVerifier(object : HostKeyVerifier {
                override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
                override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
                    val digest = MessageDigest.getInstance("SHA-256").digest(key.encoded)
                    val fingerprint = Base64.getEncoder().withoutPadding().encodeToString(digest)
                    if (pinned == null) {
                        untrustedFingerprint = fingerprint
                        return false
                    }
                    if (pinned != fingerprint) {
                        changedKey = true
                        return false
                    }
                    return true
                }
            })
            ssh.connectTimeout = 5000
            ssh.connect(host, port)
            ssh.authPassword(username, password)
            ssh.startSession().use { session ->
                val command = session.exec(readOnlyCommand)
                val result = command.inputStream.bufferedReader().use { it.readText() }
                command.join(8, TimeUnit.SECONDS)
                return RouterSnapshotParser.parse(result)
            }
          }
        } catch (error: Exception) {
            if (changedKey) throw ChangedHostKey()
            untrustedFingerprint?.let { throw UntrustedHostKey(it) }
            throw error
        }
    }
}
