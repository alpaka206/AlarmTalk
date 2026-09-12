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

/**
 * ⚠ **못 읽으면 백지가 아니라 이유를 보여 준다**(코덱스 #732). 예전에는 빈 문자열을
 * 돌려줘서, 사용자는 아무 설명 없는 백지 앞에서 동의만 하게 됐다.
 *
 * ⚠ **랜딩 웹으로 떨어뜨리지 말 것.** 동의 기록에 실리는 버전은 빌드 시점의
 * `BuildConfig.LEGAL_POLICY_VERSION` 이라, 실시간 문서를 대신 띄우면 **보여 준 것과
 * 기록한 버전이 갈라진다** — 번들에 실은 이유가 그것이다(`docs/spec/consent.md`).
 * 여기서 실패하는 것은 빌드 사고이므로 사용자가 할 수 있는 일은 업데이트뿐이다.
 */
/**
 * 번들 법무 문서를 **둘 다** 읽을 수 있는가. 동의 화면을 띄우기 전에 본다.
 *
 * ⚠ 하나만 없어도 막는다 — 제출하는 `BuildConfig.LEGAL_POLICY_VERSION` 은 **두 문서에서
 * 함께** 뽑은 값이라(build.gradle.kts 가 다르면 빌드를 세운다), 한쪽이 없으면 그 버전이
 * 무엇을 가리키는지 앱이 말할 수 없다.
 */
internal fun Context.legalDocumentsReadable(): Boolean =
    LegalDocument.entries.all { runCatching { assets.open(it.assetPath).close() }.isSuccess }

internal fun Context.readLegalDocument(doc: LegalDocument): AnnotatedString =
    runCatching { assets.open(doc.assetPath).bufferedReader().use { it.readText() } }
        .map(::renderLegalMarkdown)
        .getOrElse { AnnotatedString(getString(R.string.auth_consent_document_unavailable)) }

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
