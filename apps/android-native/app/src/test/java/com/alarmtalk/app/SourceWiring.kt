package com.alarmtalk.app

import java.io.File
import org.junit.Assert.assertTrue

/**
 * **배선을 소스로 보는 테스트의 도우미.**
 *
 * `MainViewModel` 은 암호화 저장소·Room·워커를 통째로 물고 있어 단위 테스트에서 세울 수 없고, 이
 * 모듈에는 Compose UI 테스트 하네스도 없다. 그래서 "성공 갈래가 그 함수를 부르는가" 같은 **배선**은
 * 소스 글자로 본다(`StockClipManifestWiringTest`·`ColdStartRequestKeysTest` 가 쓰는 방식 — 그 둘은
 * 같은 도우미를 클래스 안에 따로 들고 있다).
 *
 * ⚠ 소스 검사는 **호출이 거기 있는가**만 본다 — 동작은 순수 함수의 테스트와 실기기가 본다.
 */

/** 앱 본체 소스의 뿌리. 테스트는 `app/` 에서 돈다 — 모듈 루트 기준 상대 경로다. */
private const val MAIN_SOURCE_ROOT = "src/main/java/com/alarmtalk/app/"

/** [path](예: `ui/main/MainViewModelVoiceActions.kt`)의 본문. 없으면 경로를 알려 주며 실패한다. */
internal fun readSource(path: String): String {
    val file = File(MAIN_SOURCE_ROOT + path)
    assertTrue(
        "$path 를 못 찾았다(경로: ${file.absolutePath}). 파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
        file.exists(),
    )
    return file.readText()
}

/** [signature] 부터 짝이 맞는 닫는 중괄호까지 — 그 함수(또는 블록) 하나. */
internal fun functionBody(source: String, signature: String): String {
    val start = source.indexOf(signature)
    assertTrue("`$signature` 를 못 찾았다.", start >= 0)
    val open = source.indexOf('{', source.indexOf(')', start))
    var depth = 0
    for (i in open until source.length) {
        when (source[i]) {
            '{' -> depth += 1
            '}' -> {
                depth -= 1
                if (depth == 0) return source.substring(start, i + 1)
            }
        }
    }
    return source.substring(start)
}

/** 주석에 적힌 옛 모양이 걸리지 않게 줄 주석을 걷는다. */
internal fun withoutLineComments(source: String): String =
    source.lineSequence().joinToString("\n") { line -> line.substringBefore("//") }
