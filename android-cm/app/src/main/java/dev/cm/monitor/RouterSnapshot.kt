package dev.cm.monitor

/** A point-in-time reading of a local router. Counter values are cumulative. */
data class RouterSnapshot(
    val uptimeSeconds: Double,
    val memoryTotalKb: Long,
    val memoryAvailableKb: Long,
    val temperatureC: Double?,
    val loadAverage: String,
    val d2kRunning: Boolean,
    val doqRunning: Boolean,
    val cpuTotalTicks: Long,
    val cpuIdleTicks: Long,
    val networkRxBytes: Long,
    val networkTxBytes: Long,
    val storageTotalKb: Long,
    val storageAvailableKb: Long,
    val raw: String
) {
    val memoryUsedPercent: Double
        get() = if (memoryTotalKb <= 0) 0.0 else
            (100.0 * (memoryTotalKb - memoryAvailableKb) / memoryTotalKb).coerceIn(0.0, 100.0)
}

object RouterSnapshotParser {
    fun parse(raw: String): RouterSnapshot {
        val map = raw.lineSequence().mapNotNull { line ->
            val index = line.indexOf('=')
            if (index < 1) null else line.substring(0, index).trim() to
                line.substring(index + 1).trim()
        }.toMap()

        val uptime = map["UPTIME"]?.toDoubleOrNull()
        val memory = map["MEMTOTAL"]?.toLongOrNull()
        val cpu = map["CPU"]?.split(',', limit = 2)
        val cpuTotal = cpu?.getOrNull(0)?.toLongOrNull()
        val cpuIdle = cpu?.getOrNull(1)?.toLongOrNull()
        require(uptime != null && uptime >= 0 && memory != null && memory > 0 &&
            cpuTotal != null && cpuTotal > 0 && cpuIdle != null && cpuIdle in 0L..cpuTotal) {
            "SSH не вернул системные данные Linux. Проверь доступ к shell в KeeneticOS."
        }
        val available = map["MEMAVAILABLE"]?.toLongOrNull()?.coerceIn(0L, memory) ?: 0L
        val storage = map["STORAGE"]?.split(',', limit = 2)
        val storageTotal = storage?.getOrNull(0)?.toLongOrNull()?.coerceAtLeast(0) ?: 0L
        val storageFree = storage?.getOrNull(1)?.toLongOrNull()?.coerceIn(0L, storageTotal) ?: 0L
        val temperature = map["TEMP"]?.toDoubleOrNull()?.takeIf { it > 0 }
            ?.let { if (it >= 1000) it / 1000 else it }?.takeIf { it in -40.0..150.0 }

        return RouterSnapshot(
            uptimeSeconds = uptime,
            memoryTotalKb = memory,
            memoryAvailableKb = available,
            temperatureC = temperature,
            loadAverage = map["LOAD"].orEmpty(),
            d2kRunning = map["D2K"] == "1",
            doqRunning = map["DOQ"] == "1",
            cpuTotalTicks = cpuTotal,
            cpuIdleTicks = cpuIdle,
            networkRxBytes = map["NETRX"]?.toLongOrNull()?.coerceAtLeast(0L) ?: 0L,
            networkTxBytes = map["NETTX"]?.toLongOrNull()?.coerceAtLeast(0L) ?: 0L,
            storageTotalKb = storageTotal,
            storageAvailableKb = storageFree,
            raw = raw
        )
    }
}
