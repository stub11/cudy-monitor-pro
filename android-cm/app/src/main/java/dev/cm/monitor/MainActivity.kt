package dev.cm.monitor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
        setContent {
            var host by remember { mutableStateOf("") }
            var portText by remember { mutableStateOf("22") }
            var username by remember { mutableStateOf("root") }
            var password by remember { mutableStateOf("") }
            var status by remember { mutableStateOf("Подключись к роутеру по домашнему Wi-Fi") }
            var snapshot by remember { mutableStateOf<RouterSnapshot?>(null) }
            var cpuPercent by remember { mutableStateOf<Double?>(null) }
            var transferRate by remember { mutableStateOf<Pair<Double, Double>?>(null) }
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
                worker.execute {
                    try {
                        val result = client.fetch(h, p, u, pw)
                        runOnUiThread {
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
                            status = "Подключено"
                            autoRefresh = true
                            pending = null
                            busy = false
                        }
                    } catch (e: UntrustedHostKey) {
                        runOnUiThread { pending = Triple(h, p, e.fingerprint); status = "Подтверди ключ роутера"; busy = false; autoRefresh = false }
                    } catch (e: Exception) {
                        runOnUiThread { status = e.message ?: "Ошибка подключения"; busy = false; autoRefresh = false }
                    }
                }
            }
            LaunchedEffect(autoRefresh, snapshot, busy) {
                if (autoRefresh && snapshot != null && !busy) {
                    delay(15_000)
                    connect()
                }
            }
            MaterialTheme(colorScheme = darkColorScheme(
                primary = mint, background = bg, surface = card, onBackground = Color.White
            )) {
                Column(
                    Modifier.fillMaxSize().background(bg)
                        .verticalScroll(rememberScrollState()).padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(13.dp)
                ) {
                    Text("CM", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    Text("Aurora · Монитор роутера по SSH", color = Color(0xFF9CB7D6))
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
                    Button(onClick = { connect() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Text(if (busy) "Подключение…" else "Подключиться / Обновить")
                    }
                    Text(status, color = if (snapshot != null) mint else Color(0xFFFFC27C))
                    if (snapshot != null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Checkbox(checked = autoRefresh, onCheckedChange = { autoRefresh = it })
                            Text("Обновлять каждые 15 секунд", modifier = Modifier.padding(top = 12.dp))
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
                        Metric("Загрузка процессора", cpuPercent?.let { String.format(Locale.US, "%.1f%%", it) } ?: "Ожидание второго замера",
                            "Рассчитывается по разнице /proc/stat между обновлениями")
                        transferRate?.let { pair ->
                            Metric("Скорость сети ↓ / ↑",
                                String.format(Locale.US, "%.1f / %.1f Кбит/с", pair.first / 1000.0, pair.second / 1000.0),
                                "Приблизительно по суммарным счётчикам интерфейсов")
                        }
                        Metric("Оперативная память", String.format(Locale.US, "%.1f%%", s.memoryUsedPercent),
                            "${(s.memoryTotalKb - s.memoryAvailableKb) / 1024} / ${s.memoryTotalKb / 1024} МБ")
                        Metric("Температура", s.temperatureC?.let { String.format(Locale.US, "%.1f°C", it) } ?: "Нет датчика", "")
                        Metric("Нагрузка Linux", s.loadAverage, "Load average за 1, 5 и 15 минут; не процент CPU")
                        Metric("Время работы", "${(s.uptimeSeconds / 3600).toInt()} ч", "")
                        Metric("D2K", if (s.d2kRunning) "Работает" else "Не найден", "")
                        Metric("DoQ", if (s.doqRunning) "Работает" else "Не найден", "")
                        Metric("Сеть · получено", formatBytes(s.networkRxBytes), "Суммарный счётчик интерфейсов, без loopback")
                        Metric("Сеть · отправлено", formatBytes(s.networkTxBytes), "Суммарный счётчик интерфейсов, без loopback")
                        Metric("Entware /opt", if (s.storageTotalKb > 0) String.format(Locale.US, "%.1f%%", 100.0 * (s.storageTotalKb - s.storageAvailableKb) / s.storageTotalKb) else "Нет данных",
                            if (s.storageTotalKb > 0) "${(s.storageTotalKb - s.storageAvailableKb) / 1024} / ${s.storageTotalKb / 1024} МБ" else "")
                    }
                    Text("CM 0.1.0 · SSH без серверного агента", color = Color.Gray)
                }
            }
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

private fun formatBytes(value: Long): String = when {
    value >= 1_000_000_000 -> String.format(Locale.US, "%.2f ГБ", value / 1_000_000_000.0)
    value >= 1_000_000 -> String.format(Locale.US, "%.1f МБ", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1f КБ", value / 1_000.0)
    else -> "$value Б"
}
