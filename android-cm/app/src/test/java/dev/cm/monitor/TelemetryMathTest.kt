package dev.cm.monitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TelemetryMathTest {
    @Test fun cpuIdleAndBusy() {
        assertEquals(0.0, TelemetryMath.cpuPercent(100, 30, 200, 130)!!, 0.0001)
        assertEquals(65.0, TelemetryMath.cpuPercent(100, 30, 200, 65)!!, 0.0001)
        assertEquals(100.0, TelemetryMath.cpuPercent(100, 30, 200, 30)!!, 0.0001)
    }

    @Test fun rejectsCpuCounterResetsAndInvalidIdle() {
        assertNull(TelemetryMath.cpuPercent(100, 40, 50, 20))
        assertNull(TelemetryMath.cpuPercent(100, 40, 200, 41 - 2))
        assertNull(TelemetryMath.cpuPercent(100, 40, 200, 200))
    }

    @Test fun networkRateUsesElapsedTime() {
        assertEquals(8000.0, TelemetryMath.bitsPerSecond(500, 1500, 1000)!!, 0.001)
        assertEquals(4000.0, TelemetryMath.bitsPerSecond(500, 1500, 2000)!!, 0.001)
    }

    @Test fun rejectsNetworkCounterResetsAndZeroInterval() {
        assertNull(TelemetryMath.bitsPerSecond(1200, 900, 1000))
        assertNull(TelemetryMath.bitsPerSecond(100, 200, 0))
    }
}
