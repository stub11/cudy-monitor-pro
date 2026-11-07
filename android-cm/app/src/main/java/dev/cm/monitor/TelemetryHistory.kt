package dev.cm.monitor

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme

/** Keeps no sensitive data: only bounded in-memory samples while CM is open. */
internal data class TelemetryPoint(
    val cpu: Double?,
    val ram: Double,
    val load1: Double?,
    val temp: Double?,
    val rxBps: Double?,
    val txBps: Double?
)

internal object TelemetryHistory {
    const val CAPACITY = 180
    fun <T> append(previous: List<T>, point: T): List<T> =
        if (previous.size >= CAPACITY) previous.drop(previous.size - CAPACITY + 1) + point
        else previous + point
}

@Composable
internal fun MiniMetric(
    title: String,
    value: String,
    points: List<Double?>,
    modifier: Modifier = Modifier,
    note: String = ""
) {
    val lineColor = Color(0xFF26E1AC)
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = Color(0xFF142742)),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(title, color = Color(0xFFB6C9DE), style = MaterialTheme.typography.labelLarge)
            Text(value, color = lineColor, fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleLarge, maxLines = 2)
            Sparkline(points, lineColor, Modifier.fillMaxWidth().height(42.dp))
            if (note.isNotBlank()) {
                Text(note, color = Color(0xFFB6C9DE), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
internal fun Sparkline(points: List<Double?>, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        if (points.size < 2) return@Canvas
        val defined = points.filterNotNull().filter { it.isFinite() }
        if (defined.size < 2) return@Canvas
        val low = defined.minOrNull() ?: return@Canvas
        val high = defined.maxOrNull() ?: return@Canvas
        val span = (high - low).coerceAtLeast(0.1)
        val path = Path()
        var active = false
        points.forEachIndexed { index, value ->
            if (value == null || !value.isFinite()) {
                active = false
            } else {
                val x = size.width * index / (points.size - 1).toFloat()
                val y = size.height * (1f - ((value - low) / span).toFloat())
                if (!active) path.moveTo(x, y) else path.lineTo(x, y)
                active = true
            }
        }
        drawPath(path, color = color, style = Stroke(width = 2.dp.toPx()))
    }
}
