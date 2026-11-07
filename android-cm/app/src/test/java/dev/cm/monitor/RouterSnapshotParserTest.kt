package dev.cm.monitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RouterSnapshotParserTest {
    private val sample = """
        UPTIME=7200.2
        MEMTOTAL=497664
        MEMAVAILABLE=245760
        TEMP=62500
        LOAD=0.05 0.12 0.09
        D2K=1
        DOQ=0
        CPU=12345,5678
        NETRX=1234567
        NETTX=7654321
        STORAGE=14787584,14400000
    """.trimIndent()

    @Test fun normalEntwareSnapshot() {
        val result = RouterSnapshotParser.parse(sample)
        assertEquals(7200.2, result.uptimeSeconds, 0.001)
        assertEquals(497664L, result.memoryTotalKb)
        assertEquals(62.5, result.temperatureC!!, 0.001)
        assertEquals(12345L, result.cpuTotalTicks)
        assertEquals(5678L, result.cpuIdleTicks)
        assertEquals(1234567L, result.networkRxBytes)
        assertEquals(true, result.d2kRunning)
        assertEquals(false, result.doqRunning)
    }

    @Test fun rejectsKeeneticConfigurationCliResponse() {
        try {
            RouterSnapshotParser.parse("Command::Base error[7405600]: no such command: awk")
            throw AssertionError("Expected command-output validation error")
        } catch (expected: IllegalArgumentException) {
            assert(expected.message?.contains("shell") == true)
        }
    }

    @Test fun rejectsTruncatedMetrics() {
        try {
            RouterSnapshotParser.parse("UPTIME=50\nMEMTOTAL=4000\nCPU=\n")
            throw AssertionError("Expected incomplete metrics rejection")
        } catch (_: IllegalArgumentException) { }
    }

    @Test fun reportsMissingCoreFieldsWithoutRawTerminalOutput() {
        try {
            RouterSnapshotParser.parse("Welcome to KeeneticOS\\nUPTIME=10\\nMEMTOTAL=8000\\n")
            throw AssertionError("Expected CPU parsing failure")
        } catch (expected: RouterTelemetryException) {
            assertEquals(listOf("CPU"), expected.missingFields)
            assert(expected.message?.contains("CPU") == true)
            assert(expected.message?.contains("KeeneticOS") == false)
        }
    }

    @Test fun unavailableSensorIsNotReportedAsZero() {
        val result = RouterSnapshotParser.parse(sample.replace("TEMP=62500", "TEMP=0"))
        assertNull(result.temperatureC)
    }

    @Test fun clampsInvalidAvailableMemory() {
        val result = RouterSnapshotParser.parse(sample.replace("MEMAVAILABLE=245760", "MEMAVAILABLE=800000"))
        assertEquals(0.0, result.memoryUsedPercent, 0.001)
    }
}
