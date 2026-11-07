package dev.cm.monitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TelemetryHistoryTest {
    @Test fun keepsNewest180Samples() {
        var items = emptyList<Int>()
        repeat(225) { items = TelemetryHistory.append(items, it) }
        assertEquals(180, items.size)
        assertEquals(45, items.first())
        assertEquals(224, items.last())
    }

    @Test fun acceptsMissingSensorsWithoutCoercingToZero() {
        val point = TelemetryPoint(null, 42.0, null, null, null)
        val list = TelemetryHistory.append(emptyList(), point)
        assertEquals(1, list.size)
        assertTrue(list.first().cpu == null)
        assertEquals(42.0, list.first().ram, 0.01)
    }
}
