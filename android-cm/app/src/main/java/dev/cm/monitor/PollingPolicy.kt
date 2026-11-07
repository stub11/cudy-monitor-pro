package dev.cm.monitor

/** Predictable polling with no overlapping connection attempts.
 * The caller starts each delay only after the previous request completed. */
internal object PollingPolicy {
    val supportedSeconds = listOf(1, 2, 5)

    fun normalize(seconds: Int): Int = if (seconds in supportedSeconds) seconds else 5

    fun delayMs(seconds: Int, consecutiveFailures: Int): Long {
        val normal = normalize(seconds) * 1_000L
        val multiplier = when {
            consecutiveFailures <= 0 -> 1L
            consecutiveFailures == 1 -> 2L
            consecutiveFailures == 2 -> 4L
            else -> 8L
        }
        return (normal * multiplier).coerceAtMost(30_000L)
    }
}
