package dev.cm.monitor

import org.junit.Assert.assertEquals
import org.junit.Test

class PollingPolicyTest {
    @Test fun usesSupportedIntervals() {
        assertEquals(1, PollingPolicy.normalize(1))
        assertEquals(2, PollingPolicy.normalize(2))
        assertEquals(5, PollingPolicy.normalize(5))
        assertEquals(5, PollingPolicy.normalize(0))
    }

    @Test fun backsOffFailuresWithoutBusyRetrying() {
        assertEquals(1_000L, PollingPolicy.delayMs(1, 0))
        assertEquals(2_000L, PollingPolicy.delayMs(1, 1))
        assertEquals(4_000L, PollingPolicy.delayMs(1, 2))
        assertEquals(8_000L, PollingPolicy.delayMs(1, 4))
        assertEquals(30_000L, PollingPolicy.delayMs(5, 10))
    }
}
