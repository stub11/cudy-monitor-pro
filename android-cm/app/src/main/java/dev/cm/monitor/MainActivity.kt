package dev.cm.monitor

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.delay
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import java.util.Locale
import java.util.concurrent.Executors

private val bg = Color(0xFF071223)
private val card = Color(0xFF142742)
private val mint = Color(0xFF26E1AC)
private val worker = Executors.newSingleThreadExecutor()

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val client = RouterClient(applicationContext)
        val github = GitHubFeatures(applicationContext)
        val profileStore = RouterProfileStore(applicationContext)
        val rememberedRouter = profileStore.load()
        @Suppress("DEPRECATION")
        val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "0.1.2"
        setContent {
            var githubTokenInput by remember { mutableStateOf("") }
            var githubHasToken by remember { mutableStateOf(github.hasToken()) }
            var diagnosticsEnabled by remember { mutableStateOf(github.reportingEnabled()) }
            var githubStatus by remember { mutableStateOf("Обновления проверяются по GitHub. Автоотчёты — в приватный CM.") }
            var update by remember { mutableStateOf<CmUpdate?>(null) }
            var hasUpdateFile by remember { mutableStateOf(false) }
            var githubBusy by remember { mutableStateOf(false) }
            fun checkForUpdate() {
                if (githubBusy) return
                githubBusy = true
                githubStatus = "Проверяем доступные версии…"
                worker.execute {
                    try {
                        val found = github.latestUpdate(version)
                        runOnUiThread {
                            update = found
                            githubStatus = if (found == null) "Обновлений нет ($version)" else "Новая версия CM ${found.version}"
                            githubBusy = false
                        }
                    } catch (e: Exception) {
                        runOnUiThread { githubStatus = "Проверка обновлений: ${e.message ?: "ошибка сети"}"; githubBusy = false }
                    }
                }
            }
            fun downloadUpdate() {
                val selected = update ?: return
                if (githubBusy) return
                githubBusy = true
                githubStatus = "Загружаем CM ${selected.version}…"
                worker.execute {
                    try {
                        github.fetchApk(selected)
                        runOnUiThread {
                            hasUpdateFile = true
                            githubBusy = false
                            githubStatus = "APK загружен. Подтверди установку Android."
                            try { github.installDownloadedApk() } catch (e: Exception) {
                                githubStatus = "Запуск установки: ${e.message}"
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread { githubBusy = false; githubStatus = "Не удалось загрузить: ${e.message}" }
                    }
                }
            }
            var routerName by remember { mutableStateOf(rememberedRouter?.name ?: "Cudy WBR3000UAX") }
            var host by remember { mutableStateOf(rememberedRouter?.host ?: "") }
            var portText by remember { mutableStateOf(rememberedRouter?.port?.toString() ?: "22") }
            var username by remember { mutableStateOf(rememberedRouter?.username ?: "admin") }
            var password by remember { mutableStateOf(rememberedRouter?.password ?: "") }
            var rememberRouter by remember { mutableStateOf(true) }
            var savedRouter by remember { mutableStateOf(rememberedRouter != null) }
            var showConnectionSettings by remember { mutableStateOf(rememberedRouter == null) }
            var status by remember { mutableStateOf("Подключись к роутеру по домашнему Wi-Fi") }
            var snapshot by remember { mutableStateOf<RouterSnapshot?>(null) }
            var cpuPercent by remember { mutableStateOf<Double?>(null) }
            var transferRate by remember { mutableStateOf<Pair<Double, Double>?>(null) }
            var history by remember { mutableStateOf<List<TelemetryPoint>>(emptyList()) }
            var showDetails by remember { mutableStateOf(false) }
            var showGithubSettings by remember { mutableStateOf(false) }
            var lastFetchAt by remember { mutableStateOf<Long?>(null) }
            var lastEndpoint by remember { mutableStateOf<String?>(null) }
            var pending by remember { mutableStateOf<Triple<String, Int, String>?>(null) }
            var busy by remember { mutableStateOf(false) }
            var autoRefresh by remember { mutableStateOf(false) }
            fun connect() {
                if (busy) return
                busy = true
                status = "Подключение по SSH…"
                val h = host.trim()
                val p = portText.toIntOrNull() ?: 0
                val u = username.trim()
                val pw = password
                val endpoint = "$h:$p:$u"
                val nameForSave = routerName.trim().ifEmpty { "Домашний роутер" }.take(60)
                val shouldRemember = rememberRouter
                worker.execute {
                    try {
                        val result = client.fetch(h, p, u, pw)
                        val profileSaved = if (shouldRemember) {
                            runCatching { profileStore.save(SavedRouter(nameForSave, h, p, u, pw)) }.isSuccess
                        } else false
                        runOnUiThread {
                            if (profileSaved) savedRouter = true
                            showConnectionSettings = false
                            val old = if (endpoint == lastEndpoint) snapshot else null
                            if (old != null) {
                                cpuPercent = TelemetryMath.cpuPercent(
                                    old.cpuTotalTicks, old.cpuIdleTicks,
                                    result.cpuTotalTicks, result.cpuIdleTicks
                                )
                                val now = android.os.SystemClock.elapsedRealtime()
                                val elapsed = now - (lastFetchAt ?: now)
                                val rx = TelemetryMath.bitsPerSecond(old.networkRxBytes, result.networkRxBytes, elapsed)
                                val tx = TelemetryMath.bitsPerSecond(old.networkTxBytes, result.networkTxBytes, elapsed)
                                transferRate = if (rx != null && tx != null) Pair(rx, tx) else null
                            }
                            if (old == null) { cpuPercent = null; transferRate = null }
                            lastEndpoint = endpoint
                            lastFetchAt = android.os.SystemClock.elapsedRealtime()
                            snapshot = result
                            history = TelemetryHistory.append(history,
                                TelemetryPoint(cpuPercent, result.memoryUsedPercent,
                                    result.loadAverage.split(" ").firstOrNull()?.toDoubleOrNull(),
                                    result.temperatureC, transferRate?.first, transferRate?.second))
                            status = if (profileSaved) "Подключено · Роутер сохранён" else "Подключено"
                            autoRefresh = true
                            pending = null
                            busy = false
                        }
                    } catch (e: UntrustedHostKey) {
                        runOnUiThread { pending = Triple(h, p, e.fingerprint); status = "Подтверди ключ роутера"; busy = false; autoRefresh = false }
                    } catch (e: Exception) {
                        val reported = try { github.sendErrorReport(e, version) } catch (_: Exception) { false }
                        runOnUiThread {
                            status = if (e.message?.contains("Exhausted available authentication") == true)
                                "SSH отклонил авторизацию. Для root нужен пароль SSH Entware, а не обязательно пароль admin панели."
                            else e.message ?: "Ошибка подключения"
                            if (reported) status += " · Отчёт отправлен в приватный GitHub."
                            busy = false
                            autoRefresh = false
                        }
                    }
                }
            }
            LaunchedEffect(Unit) {
                checkForUpdate()
                if (rememberedRouter != null) connect()
            }
            LaunchedEffect(autoRefresh, snapshot, busy) {
                if (autoRefresh && snapshot != null && !busy) {
                    delay(5_000)
                    connect()
                }
            }
            MaterialTheme(colorScheme = darkColorScheme(
                primary = mint, onPrimary = bg, background = bg, onBackground = Color.White,
                surface = card, onSurface = Color.White, onSurfaceVariant = Color(0xFFB6C9DE),
                surfaceVariant = card, outline = Color(0xFF71839C)
            )) {
                Column(
                    Modifier.fillMaxSize().background(bg)
                        .statusBarsPadding().navigationBarsPadding()
                        .verticalScroll(rememberScrollState()).padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(13.dp)
                ) {
                    Text("CM", style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Bold, color = Color.White)
                    Text("Aurora · Монитор роутера по SSH", color = Color(0xFF9CB7D6))
                    if ((snapshot != null || savedRouter) && !showConnectionSettings) {
                        Card(colors = CardDefaults.cardColors(containerColor = card),
                            modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(routerName.ifBlank { "Домашний роутер" },
                                    color = Color.White, style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold)
                                Text("$host · SSH $portText · ${if (busy) "Подключение…" else if (snapshot != null) "Подключён" else "Нет данных"}",
                                    color = if (snapshot != null) mint else Color(0xFFFFC27C),
                                    style = MaterialTheme.typography.bodyMedium)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = { showConnectionSettings = true },
                                        modifier = Modifier.weight(1f)) { Text("Настройки") }
                                    Button(onClick = { connect() }, enabled = !busy,
                                        modifier = Modifier.weight(1f)) {
                                        Text(if (busy) "Обновление…" else "Обновить")
                                    }
                                }
                            }
                        }
                    } else {
                        if (snapshot != null) {
                            TextButton(onClick = { showConnectionSettings = false }) {
                                Text("Вернуться к показателям")
                            }
                        }
                        OutlinedTextField(routerName, { routerName = it.take(60) },
                            label = { Text("Имя роутера") }, modifier = Modifier.fillMaxWidth(),
                            singleLine = true)
                        OutlinedTextField(host, { host = it }, label = { Text("Локальный IPv4 роутера") },
                            modifier = Modifier.fillMaxWidth(), singleLine = true)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(portText, { portText = it }, label = { Text("SSH порт") },
                                modifier = Modifier.weight(1f), singleLine = true)
                            OutlinedTextField(username, { username = it }, label = { Text("Пользователь") },
                                modifier = Modifier.weight(2f), singleLine = true)
                        }
                        OutlinedTextField(password, { password = it }, label = { Text("SSH пароль") },
                            visualTransformation = PasswordVisualTransformation(),
                            modifier = Modifier.fillMaxWidth(), singleLine = true)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Checkbox(checked = rememberRouter, onCheckedChange = { rememberRouter = it })
                            Text("Запомнить роутер и SSH-вход на этом телефоне",
                                modifier = Modifier.padding(top = 12.dp),
                                style = MaterialTheme.typography.bodySmall, color = Color(0xFFB6C9DE))
                        }
                        if (savedRouter) {
                            OutlinedButton(onClick = {
                                profileStore.clear()
                                savedRouter = false
                                rememberRouter = false
                                password = ""
                                autoRefresh = false
                                status = "Сохранённый вход удалён с телефона"
                            }, modifier = Modifier.fillMaxWidth(), enabled = !busy) {
                                Text("Удалить сохранённое подключение")
                            }
                        }
                        Button(onClick = { connect() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                            Text(if (busy) "Подключение…" else "Подключиться / Обновить")
                        }
                    }
                    if (snapshot == null || status != "Подключено · Роутер сохранён" && status != "Подключено") {
                        Text(status, color = if (snapshot != null) mint else Color(0xFFFFC27C))
                    }
                    if (snapshot != null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Checkbox(checked = autoRefresh, onCheckedChange = { autoRefresh = it })
                            Text("Автообновление каждые 5 секунд", modifier = Modifier.padding(top = 12.dp),
                                color = Color(0xFFB6C9DE))
                        }
                    }
                    pending?.let { (pendingHost, pendingPort, fingerprint) ->
                        Card(colors = CardDefaults.cardColors(containerColor = card)) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                Text("Новый SSH-ключ", fontWeight = FontWeight.Bold)
                                Text("Проверь отпечаток на своём роутере перед подтверждением. Это не OpenSSH SHA256, а SHA256 от Java-кодирования публичного ключа.")
                                Text("Роутер: $pendingHost:$pendingPort", style = MaterialTheme.typography.bodySmall)
                                Text(fingerprint, style = MaterialTheme.typography.bodySmall)
                                Button(onClick = {
                                    client.approve(pendingHost, pendingPort, fingerprint)
                                    pending = null
                                    status = "Ключ сохранён. Подключись повторно."
                                }) { Text("Доверять этому ключу") }
                            }
                        }
                    }
                    snapshot?.let { s ->
                        Text("Обзор", style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold, color = Color.White)
                        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            MiniMetric("Процессор",
                                cpuPercent?.let { String.format(Locale.US, "%.1f%%", it) } ?: "Замер…",
                                history.map { it.cpu }, Modifier.weight(1f))
                            MiniMetric("Память",
                                String.format(Locale.US, "%.1f%%", s.memoryUsedPercent),
                                history.map { it.ram }, Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            MiniMetric("Температура",
                                s.temperatureC?.let { String.format(Locale.US, "%.1f°C", it) } ?: "Нет датчика",
                                history.map { it.temp }, Modifier.weight(1f))
                            MiniMetric("Нагрузка · 1 мин",
                                s.loadAverage.split(" ").firstOrNull() ?: "—",
                                history.map { it.load1 }, Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            MiniMetric("Приём ↓",
                                transferRate?.first?.let(::formatRate) ?: "Замер…",
                                history.map { it.rxBps }, Modifier.weight(1f))
                            MiniMetric("Отдача ↑",
                                transferRate?.second?.let(::formatRate) ?: "Замер…",
                                history.map { it.txBps }, Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            ServiceMetric("D2K", s.d2kRunning, Modifier.weight(1f))
                            ServiceMetric("DoQ", s.doqRunning, Modifier.weight(1f))
                        }
                        Text("Скорость сети приблизительная: суммируются интерфейсы Linux.",
                            color = Color(0xFF9CB7D6), style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = { showDetails = !showDetails },
                            modifier = Modifier.fillMaxWidth()) {
                            Text(if (showDetails) "Скрыть подробности" else "Подробные показатели")
                        }
                        if (showDetails) {
                            Metric("Время работы", "${(s.uptimeSeconds / 3600).toInt()} ч", "")
                            Metric("Сеть · получено", formatBytes(s.networkRxBytes),
                                "Суммарный счётчик интерфейсов, без loopback")
                            Metric("Сеть · отправлено", formatBytes(s.networkTxBytes),
                                "Суммарный счётчик интерфейсов, без loopback")
                            Metric("Entware /opt",
                                if (s.storageTotalKb > 0) String.format(Locale.US, "%.1f%%",
                                    100.0 * (s.storageTotalKb - s.storageAvailableKb) / s.storageTotalKb)
                                else "Нет данных",
                                if (s.storageTotalKb > 0)
                                    "${(s.storageTotalKb - s.storageAvailableKb) / 1024} / ${s.storageTotalKb / 1024} МБ"
                                else "")
                        }
                    }
                    HorizontalDivider()
                    Text("Обновления CM", fontWeight = FontWeight.Bold, color = Color.White)
                    Button(onClick = { checkForUpdate() }, enabled = !githubBusy, modifier = Modifier.fillMaxWidth()) {
                        Text(if (githubBusy) "Проверка / загрузка…" else "Проверить обновления")
                    }
                    update?.let { available ->
                        Text("Доступна версия ${available.version}", color = mint)
                        Button(onClick = { downloadUpdate() }, enabled = !githubBusy && githubHasToken,
                            modifier = Modifier.fillMaxWidth()) { Text("Скачать и установить внутри CM") }
                        if (!githubHasToken) {
                            Text("Для загрузки из GitHub Actions нужен токен с Actions: Read. Или открой сборку в браузере.")
                            TextButton(onClick = {
                                startActivity(Intent(Intent.ACTION_VIEW,
                                    Uri.parse("https://github.com/stub11/cudy-monitor-pro/actions/runs/${available.runId}")))
                            }) { Text("Открыть APK на GitHub") }
                        }
                    }
                    if (hasUpdateFile) {
                        OutlinedButton(onClick = {
                            try { github.installDownloadedApk() }
                            catch (e: Exception) { githubStatus = "Не удалось открыть установщик: ${e.message}" }
                        }, modifier = Modifier.fillMaxWidth()) { Text("Продолжить установку загруженного APK") }
                    }
                    OutlinedButton(
                        onClick = { showGithubSettings = !showGithubSettings },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text(if (showGithubSettings) "Скрыть настройки GitHub" else "Диагностика и настройки GitHub") }
                    if (showGithubSettings) {
                    HorizontalDivider()
                    Text("Автодиагностика GitHub", fontWeight = FontWeight.Bold, color = Color.White)
                    Text("Ошибки SSH отправляются только в приватный stub11/CM. Пароли, IP-адреса, SSH-ключи и журналы не передаются.",
                        style = MaterialTheme.typography.bodySmall, color = Color(0xFFB6C9DE))
                    OutlinedTextField(value = githubTokenInput, onValueChange = { githubTokenInput = it },
                        label = { Text(if (githubHasToken) "Заменить GitHub-токен" else "GitHub-токен: Issues Write + Actions Read") },
                        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
                        singleLine = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            try {
                                if (githubTokenInput.isBlank()) error("Введите токен")
                                github.saveToken(githubTokenInput)
                                githubTokenInput = ""
                                githubHasToken = true
                                githubStatus = "Токен защищён Android Keystore"
                            } catch (e: Exception) { githubStatus = "Не удалось сохранить токен: ${e.message}" }
                        }, modifier = Modifier.weight(1f)) { Text("Сохранить") }
                        OutlinedButton(onClick = {
                            github.removeToken()
                            githubHasToken = false
                            diagnosticsEnabled = false
                            github.setReportingEnabled(false)
                            githubTokenInput = ""
                            githubStatus = "Токен удалён"
                        }, modifier = Modifier.weight(1f)) { Text("Удалить токен") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Checkbox(checked = diagnosticsEnabled, enabled = githubHasToken,
                            onCheckedChange = { value ->
                                diagnosticsEnabled = value
                                github.setReportingEnabled(value)
                            })
                        Text("Автоматически отправлять новые ошибки SSH (не чаще раза в сутки на тип)",
                            modifier = Modifier.padding(top = 5.dp), style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFB6C9DE))
                    }
                    Text(githubStatus, color = Color(0xFFB6C9DE))
                    }
                    Text("CM $version · SSH без серверного агента", color = Color.Gray)
                }
            }
        }
    }
}
@Composable
private fun ServiceMetric(title: String, running: Boolean, modifier: Modifier = Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = card), modifier = modifier) {
        Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, color = Color(0xFFB6C9DE), style = MaterialTheme.typography.labelLarge)
            Text(if (running) "Работает" else "Не найден",
                color = if (running) mint else Color(0xFFFFC27C),
                fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun Metric(title: String, value: String, subtitle: String) {
    Card(colors = CardDefaults.cardColors(containerColor = card), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, color = Color(0xFFB6C9DE))
            Text(value, color = mint, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            if (subtitle.isNotBlank()) Text(subtitle, color = Color(0xFFADC1DB))
        }
    }
}

private fun formatRate(bitsPerSecond: Double): String =
    if (bitsPerSecond >= 1_000_000.0)
        String.format(Locale.US, "%.2f Мбит/с", bitsPerSecond / 1_000_000.0)
    else String.format(Locale.US, "%.0f Кбит/с", bitsPerSecond / 1000.0)

private fun formatBytes(value: Long): String = when {
    value >= 1_000_000_000 -> String.format(Locale.US, "%.2f ГБ", value / 1_000_000_000.0)
    value >= 1_000_000 -> String.format(Locale.US, "%.1f МБ", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1f КБ", value / 1_000.0)
    else -> "$value Б"
}
