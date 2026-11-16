package dev.cm.monitor

/**
 * Pure counter calculations. These are only meaningful for two samples of the
 * same device/boot and of a non-resetting counter. No network calls or files.
 */
object TelemetryMath {
    fun cpuPercent(previousTotal: Long, previousIdle: Long, total: Long, idle: Long): Double? {
        val deltaTotal = total - previousTotal
        val deltaIdle = idle - previousIdle
        if (deltaTotal <= 0L || deltaIdle < 0L || deltaIdle > deltaTotal) return null
        return (100.0 * (deltaTotal - deltaIdle) / deltaTotal).coerceIn(0.0, 100.0)
    }

    fun bitsPerSecond(previousBytes: Long, bytes: Long, elapsedMillis: Long): Double? {
        if (previousBytes < 0 || bytes < previousBytes || elapsedMillis <= 0L) return null
        return (bytes - previousBytes).toDouble() * 8000.0 / elapsedMillis
    }
}
