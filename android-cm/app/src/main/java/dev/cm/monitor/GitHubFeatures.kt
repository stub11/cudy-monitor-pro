package dev.cm.monitor

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.net.Uri
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipInputStream

internal data class CmUpdate(val version: String, val runId: Long, val artifactId: Long, val digest: String?)

internal class GitHubFeatures(private val context: Context) {
    private val prefs = context.getSharedPreferences("cm_github_settings", Context.MODE_PRIVATE)
    private val secrets = GitHubSecretStore(context)
    private val buildRepo = "stub11/cudy-monitor-pro"
    private val reportsRepo = "stub11/CM"

    fun hasToken(): Boolean = !secrets.read().isNullOrBlank()
    fun saveToken(token: String) = secrets.save(token.trim())
    fun removeToken() = secrets.clear()
    fun reportingEnabled(): Boolean = prefs.getBoolean("reports_enabled", false) && hasToken()
    fun setReportingEnabled(value: Boolean) = prefs.edit().putBoolean("reports_enabled", value).apply()

    private fun connection(url: String, token: String? = null, method: String = "GET"): HttpURLConnection {
        require(url.startsWith("https://api.github.com/")) { "Недопустимый адрес GitHub API" }
        return (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            readTimeout = 20000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            setRequestProperty("User-Agent", "CM-Android")
            if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
        }
    }

    private fun json(url: String, token: String? = null): JSONObject {
        val c = connection(url, token)
        return try {
            val status = c.responseCode
            if (status !in 200..299) throw IllegalStateException("GitHub API HTTP $status")
            JSONObject(c.inputStream.bufferedReader().use { it.readText() })
        } finally { c.disconnect() }
    }

    private fun versionParts(version: String): List<Int> = version.split(".").map { it.toIntOrNull() ?: 0 }
    private fun newer(candidate: String, installed: String): Boolean {
        val a = versionParts(candidate)
        val b = versionParts(installed)
        return (0..2).firstNotNullOfOrNull { i ->
            when {
                (a.getOrElse(i) { 0 }) > (b.getOrElse(i) { 0 }) -> true
                (a.getOrElse(i) { 0 }) < (b.getOrElse(i) { 0 }) -> false
                else -> null
            }
        } ?: false
    }

    fun latestUpdate(currentVersion: String): CmUpdate? {
        val runs = json("https://api.github.com/repos/$buildRepo/actions/workflows/cm-android-public.yml/runs?event=push&status=success&per_page=12")
            .getJSONArray("workflow_runs")
        
        for (i in 0 until runs.length()) {
            val run = runs.getJSONObject(i)
            if (run.optString("head_branch") != "build/cm-android-public-ci") continue
            val headRepo = run.optJSONObject("head_repository") ?: continue
            if (headRepo.optString("full_name") != buildRepo) continue
            val id = run.getLong("id")
            val arts = json("https://api.github.com/repos/$buildRepo/actions/runs/$id/artifacts")
                .getJSONArray("artifacts")
            for (j in 0 until arts.length()) {
                val art = arts.getJSONObject(j)
                if (art.optBoolean("expired", true)) continue
                val name = art.optString("name")
                val match = Regex("^CM-android-v(\\d+\\.\\d+\\.\\d+)$").matchEntire(name) ?: continue
                val version = match.groupValues[1]
                return if (newer(version, currentVersion)) {
                    CmUpdate(version, id, art.getLong("id"), art.optString("digest").takeIf { it.startsWith("sha256:") })
                } else null
            }

        }
        return null
    }

    fun fetchApk(update: CmUpdate): File {
        val token = secrets.read() ?: error("Для скачивания через приложение нужен GitHub-токен с Actions: Read")
        val conn = connection("https://api.github.com/repos/$buildRepo/actions/artifacts/${update.artifactId}/zip", token)
        val zip = File(context.cacheDir, "cm-update-artifact.zip")
        val apk = File(context.cacheDir, "cm-updates/cm-update.apk")
        apk.parentFile?.mkdirs()
        try {
            if (conn.responseCode != 200) error("GitHub не разрешил скачать APK: HTTP ${conn.responseCode}. Нужны права Actions: Read")
            val md = MessageDigest.getInstance("SHA-256")
            conn.inputStream.use { input ->
                zip.outputStream().use { output ->
                    val buf = ByteArray(8192)
                    var total = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > 70_000_000L) error("Слишком большой архив обновления")
                        md.update(buf, 0, n)
                        output.write(buf, 0, n)
                    }
                }
            }
            val hash = md.digest().joinToString("") { "%02x".format(it) }
            if (update.digest != null && !update.digest.substringAfter(":").equals(hash, true))
                error("Контрольная сумма архива обновления не совпала")
            ZipInputStream(zip.inputStream()).use { stream ->
                var found = false
                while (true) {
                    val e = stream.nextEntry ?: break
                    if (e.isDirectory || !e.name.endsWith(".apk") || found) continue
                    var length = 0L
                    apk.outputStream().use { out ->
                        val buf = ByteArray(8192)
                        while (true) {
                            val n = stream.read(buf)
                            if (n < 0) break
                            length += n
                            if (length > 75_000_000L) error("Слишком большой APK")
                            out.write(buf, 0, n)
                        }
                    }
                    found = true
                }
                if (!found) error("APK отсутствует в архиве GitHub")
            }
            @Suppress("DEPRECATION")
            val info = context.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
            if (info?.packageName != context.packageName) error("Неправильное имя пакета APK")
            if (info.versionName != update.version) error("Версия APK не совпадает с обновлением")
            return apk
        } catch (error: Exception) {
            apk.delete()
            throw error
        } finally {
            conn.disconnect()
            zip.delete()
        }
    }

    fun installDownloadedApk() {
        val apk = File(context.cacheDir, "cm-updates/cm-update.apk")
        require(apk.isFile) { "Обновление ещё не загружено" }
        // Public GitHub debug runners may rotate APK signing keys between runs.
        // Never bypass Android signature checks.
        @Suppress("DEPRECATION")
        val archiveInfo = context.packageManager.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNATURES)
        @Suppress("DEPRECATION")
        val currentInfo = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
        @Suppress("DEPRECATION")
        val archiveSigner = archiveInfo?.signatures?.firstOrNull()?.toByteArray()
        @Suppress("DEPRECATION")
        val currentSigner = currentInfo.signatures?.firstOrNull()?.toByteArray()
        if (archiveSigner == null || currentSigner == null ||
            !MessageDigest.isEqual(archiveSigner, currentSigner)
        ) {
            error("Подпись APK отличается от установленной. Android не разрешит обновление поверх CM. Для тестовой сборки удали старый CM или настрой постоянный ключ подписи.")
        }
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(settings)
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        context.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        })
    }

    private fun codeFor(error: Throwable): String = when (error) {
        is RouterTelemetryException -> "SSH_TELEMETRY_PARSE_FAILED"
        is SshShellTimeout -> if (error.stage == "WAIT_LINUX_SHELL") "SSH_SHELL_READY_TIMEOUT" else "SSH_TELEMETRY_TIMEOUT"
        is UntrustedHostKey -> "SSH_HOST_KEY_APPROVAL"
        is ChangedHostKey -> "SSH_HOST_KEY_CHANGED"
        else -> {
            val message = error.message.orEmpty().lowercase()
            when {
                "exhausted available authentication" in message -> "SSH_AUTH_REJECTED"
                "authentication" in message || "auth fail" in message -> "SSH_AUTH_FAILED"
                "x25519" in message || "algorithm" in message -> "SSH_CRYPTO_NEGOTIATION"
                "timeout" in message || "timed out" in message ||
                    ("failed to connect" in message && "after " in message) -> "SSH_CONNECT_TIMEOUT"
                "refused" in message -> "SSH_CONNECTION_REFUSED"
                else -> "SSH_OTHER_ERROR"
            }
        }
    }

    fun sendErrorReport(error: Throwable, appVersion: String): Boolean {
        if (!reportingEnabled()) return false
        val token = secrets.read() ?: return false
        val code = codeFor(error)
        val safeMissing = (error as? RouterTelemetryException)?.missingFields
            ?.filter { it in setOf("UPTIME", "MEMTOTAL", "CPU") }
            ?.joinToString(", ")
            ?.ifBlank { "none" } ?: "not applicable"
        val stage = if (error is RouterTelemetryException) "Linux telemetry parsing" else "SSH connection/authentication"
        val now = System.currentTimeMillis()
        val last = prefs.getLong("last_report_$code", 0)
        if (now - last < 24L * 60 * 60 * 1000) return false
        // Whitelisted metadata only: NO host, username, password, fingerprint,
        // token, raw error message, command output, network identifiers or logs.
        val body = JSONObject().apply {
            put("title", "[CM auto-diagnostic] $code")
            put("body", """
                Automatically submitted from CM Android (private repository).

                - Error code: `$code`
                - App version: `$appVersion`
                - Android API: `${Build.VERSION.SDK_INT}`
                - Stage: `$stage`
                - Missing fields (allowlisted): `$safeMissing`
                - No credentials, IPs or raw logs included.
            """.trimIndent())
        }
        val conn = connection("https://api.github.com/repos/$reportsRepo/issues", token, "POST")
        return try {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode == 201) {
                prefs.edit().putLong("last_report_$code", now).apply()
                true
            } else false
        } finally { conn.disconnect() }
    }
}
