package com.alarmtalk.app

import android.content.Context
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/**
 * 앱에 실린 법무 문서 전문. 빌드 시 `docs/legal` 아래 마크다운 원문을 그대로 복사해 넣는다
 * (build.gradle.kts 의 copyLegalDocs — 사본이 아니라 같은 단일 출처다).
 */
internal enum class LegalDocument(val assetPath: String) {
    Privacy("legal/privacy-policy.ko.md"),
    Terms("legal/terms-of-service.ko.md"),
}

internal fun Context.readLegalDocument(doc: LegalDocument): AnnotatedString =
    runCatching { assets.open(doc.assetPath).bufferedReader().use { it.readText() } }
        .map(::renderLegalMarkdown)
        .getOrElse { AnnotatedString("") }

/**
 * 법무 문서 마크다운을 폰에서 읽히는 텍스트로 만든다. 렌더러 의존성을 새로 들이지 않고
 * 이 문서들이 실제로 쓰는 문법만 다룬다 — 제목, 굵게, 불릿, 표, 구분선.
 *
 * **표는 표로 그리지 않는다.** 처리방침의 위탁·국외이전 표는 5열이라 폰 폭에 절대 안 맞는다.
 * 헤더를 라벨로 삼아 행마다 `항목: 값` 블록으로 푸는 편이 가로 스크롤보다 훨씬 잘 읽힌다.
 */
internal fun renderLegalMarkdown(markdown: String): AnnotatedString = buildAnnotatedString {
    val bold = SpanStyle(fontWeight = FontWeight.Bold)
    var tableHeader: List<String>? = null
    var firstBlock = true

    fun breakBlock() {
        if (!firstBlock) append("\n\n")
        firstBlock = false
    }

    /** `**굵게**` 와 `` `코드` `` 만 처리한다. 나머지 기호는 원문 그대로 둔다. */
    fun appendInline(text: String) {
        var rest = text.replace("`", "")
        while (true) {
            val open = rest.indexOf("**")
            if (open < 0) break
            val close = rest.indexOf("**", open + 2)
            if (close < 0) break
            append(rest.substring(0, open))
            withStyle(bold) { append(rest.substring(open + 2, close)) }
            rest = rest.substring(close + 2)
        }
        append(rest)
    }

    fun tableCells(line: String): List<String> =
        line.trim().trim('|').split('|').map { it.trim() }

    for (raw in markdown.lines()) {
        val line = raw.trimEnd()
        when {
            line.isBlank() -> tableHeader = null

            line.startsWith("#") -> {
                tableHeader = null
                breakBlock()
                withStyle(bold) { append(line.trimStart('#').trim()) }
            }

            // 표 구분선(|---|---|)은 그리지 않는다.
            line.startsWith("|") && line.trim('|', '-', ' ', ':').isEmpty() -> Unit

            line.startsWith("|") -> {
                val cells = tableCells(line)
                if (tableHeader == null) {
                    tableHeader = cells
                } else {
                    breakBlock()
                    cells.forEachIndexed { index, cell ->
                        if (cell.isBlank()) return@forEachIndexed
                        if (index > 0) append("\n")
                        tableHeader?.getOrNull(index)?.takeIf { it.isNotBlank() }?.let { label ->
                            withStyle(bold) { append("$label: ") }
                        }
                        appendInline(cell)
                    }
                }
            }

            line.startsWith("- ") || line.startsWith("* ") -> {
                tableHeader = null
                breakBlock()
                append("• ")
                appendInline(line.drop(2))
            }

            line.startsWith("---") -> tableHeader = null

            else -> {
                tableHeader = null
                breakBlock()
                appendInline(line)
            }
        }
    }
}
