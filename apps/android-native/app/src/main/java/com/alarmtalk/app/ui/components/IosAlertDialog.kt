package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import com.alarmtalk.app.WakerPillShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.border
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * iOS 시스템 알럿(UIAlertController) 스타일의 공용 다이얼로그.
 *
 * 디자인 출처: Figma "Alert" 컴포넌트 세트 (양 플랫폼 모달 통일 기준), 수치는 변형
 * `2018:456`(Dark·Title·2 horizontal) 기준으로 정밀 정렬.
 *   - 컨테이너: radius 14, 화면 적응 폭(최대 300; Figma 270 ~ 큰 폰 대응 절충)
 *   - content: 가로 16 / 세로 20 패딩, 가운데 정렬, 타이틀↔설명 2dp
 *   - 타이틀 17/Semibold(라인 22, 자간 -0.4), 설명 13/Regular(라인 18, 자간 -0.08, 보조색)
 *   - 액션: 행 높이 44, 0.5dp 구분선(onSurface 20%)으로 분리된 텍스트 버튼
 *           왼쪽=Regular / 강조=Semibold, 17/라인22/자간-0.4. 2개는 가로(가운데 세로 구분선).
 *   - X 닫기·채운 알약 버튼 없음
 *
 * 색은 Figma 의 iOS 블루(#007AFF) 대신 앱 브랜드 색(`primary`)을 써서 다크모드까지
 * 자동 대응한다. 폰트는 앱 표준 Pretendard(Figma 는 SF Pro) — iOS 에선 SF Pro 로 동일.
 */
/**
 * 알럿 안에서 쓰는 **유일한 타입 스케일**.
 *
 * 알럿은 iOS 수치(17/13/15 + 음수 자간)로 짜여 있고 앱의 Material 스케일(bodySmall,
 * labelSmall …)과 다르다. 두 체계가 한 모달 안에서 섞이면 글자 크기·자간이 줄마다 어긋나
 * 완성도가 떨어져 보인다 — 실제로 오류 문구는 자간이 빠져 있었고 글자수 카운터만 Material
 * 스케일이었다. 알럿 안의 모든 텍스트는 여기서만 스타일을 가져간다.
 */
internal object IosAlertType {
    // ⚠ **음수 자간을 다시 넣지 말 것.** 이 값들(-0.4/-0.08/-0.2)은 **SF Pro 의 트래킹**을
    // 그대로 베낀 것인데, 우리가 쓰는 글꼴은 **Pretendard** 다. 라틴 글꼴의 음수 트래킹을
    // 한글에 걸면 글자가 서로 붙어 읽기 어려워진다 — 2026-08-11 에 "안드로이드 쪽이 잘
    // 안 읽히고 안 예쁘다" 로 드러난 것이 이것이다.
    //
    // 앱 전체는 이미 자간 0 이 규칙이다(`theme/AlarmTalkTypography.kt` 의
    // `alarmTalkTextStyle` 이 모든 스타일에 `letterSpacing = 0.sp` 를 건다).
    // **알럿만 그 규칙 밖에 있었다.** 같은 규칙으로 되돌린다.
    //
    // ⚠ **본문은 13 이 아니라 14.5 다.** 오래 "iOS 본문 = 13" 으로 알고 썼는데 **틀렸다.**
    // 2026-08-11 에 두 폰의 스크린샷에서 **글리프 실제 높이**를 재서 확인했다:
    //
    //   제목  iOS 15.0pt / 안드 14.9dp  (둘 다 폰트 17) → 이미 일치
    //   본문  iOS 12.7pt / 안드 10.9dp  (안드 폰트 13)  → 안드가 15% 작다
    //
    // 안드로이드 글리프 비율(14.9/17 = 0.874)로 역산하면 iOS 본문과 같은 크기를 내는 값이
    // **14.5sp** 다. 13 으로 두면 글자가 작아 보일 뿐 아니라 **한 줄에 더 들어가서**
    // 같은 문장이 아이폰 3줄 / 갤럭시 2줄로 갈린다(사용자가 그걸 먼저 알아챘다).
    val Title = TextStyle(fontSize = 17.sp, lineHeight = 21.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold)
    val Message = TextStyle(fontSize = 14.5.sp, lineHeight = 20.sp, letterSpacing = 0.sp)
    val Field = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, letterSpacing = 0.sp)
    val Action = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = 0.sp)
}

internal data class IosAlertAction(
    val label: String,
    val emphasized: Boolean = false,
    val destructive: Boolean = false,
    /**
     * 처리 중일 때 액션을 잠근다. **바깥 탭·뒤로가기만 막는 것으로는 부족하다** —
     * 버튼은 그대로 눌려서 같은 요청을 두 번 보내거나, 응답이 오기 전에 모달을 닫아
     * 결과(특히 실패 안내)를 받을 화면 자체를 없앤다(Codex #671 P2).
     */
    val enabled: Boolean = true,
    val onClick: () -> Unit,
)

/**
 * 알럿 본문 아래에 놓이는 입력 슬롯.
 *
 * iOS 알럿도 입력을 받는다 — `UIAlertController.addTextField` 가 그것이고, 잠금해제 암호·
 * 이름 변경 같은 데서 쓰인다. 생김새는 **본문 아래에 얇은 테두리의 작은 필드**이고, 액션은
 * 그대로 아래에 남는다. 필드는 앱 표준 `OutlinedTextField`(WakerInputShape)를 그대로 쓴다 —
 * 알럿 전용 입력 컴포넌트를 따로 두지 않는다.
 *
 * (예전에는 "iOS 알럿은 텍스트 액션만 두는 형식" 이라고 보고 입력이 필요하면 별도 모달로
 * 뺐는데, 그 전제가 틀렸다. 알럿과 입력 모달이 갈라져 있을 이유가 없다.)
 */
@Composable
internal fun IosAlertDialog(
    title: String?,
    message: String?,
    actions: List<IosAlertAction>,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    // 본문과 액션 사이에 들어가는 입력 영역. 없으면 예전과 똑같은 순수 알럿이다.
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    // 본문이 몇 줄로 그려졌는지. 정렬을 그 결과로 정한다(위 주석 참조).
    var messageLineCount by remember(message) { mutableIntStateOf(0) }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = modifier
                // ⚠ **순서를 지킬 것 — `fillMaxWidth()` 가 먼저면 상한이 안 걸린다.**
                // `fillMaxWidth()` 는 최소폭까지 화면폭으로 못박아서, 뒤에 오는
                // `widthIn(max)` 가 최대만 낮춰도 최소가 그대로라 아무 일도 안 일어난다.
                // 실제로 그래서 알럿이 **331dp** 로 떴다(상한 320 이 무시됨, 2026-08-11
                // 실측). 상한을 먼저 걸고 마지막에 채운다.
                .padding(horizontal = 24.dp)
                // 실측: iPhone 16 Pro(402pt)에서 폭 **320**, 좌우 여백 41.
                .widthIn(max = 320.dp)
                .fillMaxWidth(),
            // ⚠ 14 가 아니다 — 실측 반경은 **약 34**(iOS 26). 14 는 iOS 7~18 시절 값이다.
            shape = RoundedCornerShape(34.dp),
            // iOS 알럿은 어두운 글래스 패널 느낌 — 배경보다 한 단계 밝은 surfaceVariant 로 분리감을 준다.
            color = scheme.surfaceVariant,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = BorderStroke(0.5.dp, scheme.onSurface.copy(alpha = 0.12f)),
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                val hasContent = !title.isNullOrBlank() || !message.isNullOrBlank()
                if (hasContent) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = ALERT_TEXT_INSET, end = ALERT_TEXT_INSET, top = 22.dp, bottom = 20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        // ⚠ **여러 줄 본문은 가운데가 아니라 왼쪽 정렬이다.**
                        // iOS 알럿은 본문이 한 줄이면 가운데, **여러 줄이면 제목까지 왼쪽
                        // 정렬**로 바뀐다(2026-08-11 실측 — 탈퇴 알럿의 여러 줄 본문이 왼쪽
                        // 정렬이었다). 긴 문단을 가운데 정렬하면 줄마다 시작점이 달라 읽는
                        // 눈이 매 줄 다시 왼쪽을 찾아야 한다.
                        //
                        // ⚠ **줄 수 기준을 3 으로 두지 말 것.** 알럿 폭이 기기마다 달라
                        // 같은 문장이 아이폰에서 3줄, 갤럭시에서 2줄로 감긴다 — 3 으로 두면
                        // 같은 알럿이 한쪽만 가운데 정렬로 뜬다(실제로 그랬다).
                        // 판정은 **한 줄인가 아닌가**로만 한다.
                        val longMessage = messageLineCount >= 2
                        val blockAlign = if (longMessage) TextAlign.Start else TextAlign.Center
                        if (!title.isNullOrBlank()) {
                            Text(
                                text = title,
                                color = scheme.onSurface,
                                textAlign = blockAlign,
                                style = IosAlertType.Title,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        if (!title.isNullOrBlank() && !message.isNullOrBlank()) {
                            Spacer(Modifier.height(TITLE_TO_MESSAGE_GAP))
                        }
                        if (!message.isNullOrBlank()) {
                            Text(
                                text = message,
                                color = scheme.onSurfaceVariant,
                                textAlign = blockAlign,
                                style = IosAlertType.Message,
                                modifier = Modifier.fillMaxWidth(),
                                // 줄 수는 그려 봐야 안다 — 재 보고 다음 배치에서 정렬을 정한다.
                                onTextLayout = { messageLineCount = it.lineCount },
                            )
                        }
                        if (content != null) {
                            // 본문이 있으면 그 문단과 입력 사이 간격(14). 제목뿐이면 조금 더
                            // 띄운다(10) — 4dp 로 두면 입력창이 제목에 달라붙어, 제목이
                            // 입력창의 라벨처럼 읽힌다(폰에서 확인).
                            Spacer(Modifier.height(if (message.isNullOrBlank()) 10.dp else 14.dp))
                            content()
                        }
                    }
                } else if (content != null) {
                    // 제목·본문 없이 입력만 있는 알럿도 같은 여백을 갖는다.
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = ALERT_TEXT_INSET, end = ALERT_TEXT_INSET, top = 22.dp, bottom = 20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        content = content,
                    )
                }
                IosAlertActionRow(actions = actions, scheme = scheme)
            }
        }
    }
}

/**
 * 알럿 안의 입력 필드.
 *
 * `OutlinedTextField` 를 쓰지 않는 이유는 오직 **비율** 이다 — 그건 최소 높이가 56dp 라
 * 액션 행보다 커서, 알럿 안에서 입력창이 혼자 덩치가 다르다(높이를 낮출 파라미터도 없다).
 *
 * 기본 48dp 인 이유는 액션 행([ACTION_ROW_HEIGHT])과 같다 — **Android 최소 터치 타깃**이다.
 * 입력칸도 탭해서 포커스를 잡는 터치 타깃이라 같은 기준을 받는다. 액션 행보다는 4dp 낮게
 * 둬서 '누르는 것' 과 '쓰는 것' 의 위계는 남긴다.
 */
@Composable
internal fun IosAlertField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    minHeight: Dp = 48.dp,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    val scheme = MaterialTheme.colorScheme
    val textStyle = IosAlertType.Field.copy(color = scheme.onSurface)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = singleLine,
        keyboardOptions = keyboardOptions,
        textStyle = textStyle,
        cursorBrush = SolidColor(scheme.primary),
        modifier = modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = minHeight)
                    // 알럿 컨테이너(14)보다 작은 반경 — 안에 든 요소가 더 각지는 iOS 문법.
                    .border(0.5.dp, scheme.onSurface.copy(alpha = 0.22f), RoundedCornerShape(8.dp))
                    .background(scheme.surface.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart,
            ) {
                if (value.isEmpty() && !placeholder.isNullOrBlank()) {
                    Text(
                        text = placeholder,
                        color = scheme.onSurfaceVariant.copy(alpha = 0.7f),
                        style = textStyle,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                inner()
            }
        },
    )
}

/**
 * 알럿 글자 블록의 좌우 여백 — **30dp**(2026-08-11 iOS 실측).
 *
 * ⚠ **20 으로 되돌리지 말 것.** 20 이면 같은 문장이 아이폰보다 넓게 퍼져 줄바꿈 위치가
 * 달라진다(실측: 아이폰 좌우 30 / 우리 18). 아이폰 알럿은 폭 320 에 좌우 30 이라
 * 글자가 260 폭 안에서 감긴다 — 그 답답함이 알럿의 인상을 만든다.
 */
private val ALERT_TEXT_INSET = 30.dp

/**
 * 제목과 본문 사이 — **7dp**(iOS 실측 7.3).
 *
 * ⚠ 4 로 되돌리지 말 것. 절반이라 제목과 본문이 한 덩어리로 붙어 보였다.
 */
private val TITLE_TO_MESSAGE_GAP = 7.dp

/**
 * 액션 버튼 높이 — **48dp**.
 *
 * ⚠ **44 로 되돌리지 말 것.** 예전 주석은 "iOS 원본은 44" 라고 적었는데 **지금 iOS 는
 * 48이다**(2026-08-11 시뮬레이터 실측 — `AlarmTalkUITests/SystemAlertMetricsUITests`).
 * 마침 안드로이드 최소 터치 타깃도 48이라, 두 기준이 같은 값에서 만난다.
 */
private val ACTION_HEIGHT = 48.dp

/** 알럿 안쪽 여백 — 버튼 좌우·아래가 모두 16dp(실측). */
private val ALERT_INSET = 16.dp

/** 버튼 사이 간격(실측 8dp). */
private val ACTION_GAP = 8.dp

/**
 * 액션 영역.
 *
 * ⚠ **구분선으로 나눈 납작한 텍스트 버튼으로 되돌리지 말 것.** 그건 iOS 7~18 의 알럿이고,
 * **지금 iOS 알럿에는 구분선이 아예 없다** — 액션은 알럿 안쪽에 여백을 두고 놓인
 * **채워진 캡슐 버튼**이다(2026-08-11 실측: 두 버튼 사이·제목과 버튼 사이 모두 알럿
 * 배경색 그대로였다). 옛 모양을 흉내 내면 사용자 아이폰의 진짜 알럿과 나란히 놓였을 때
 * 우리 것만 옛날 앱처럼 보인다.
 */
@Composable
private fun IosAlertActionRow(actions: List<IosAlertAction>, scheme: ColorScheme) {
    // 2개는 가로 한 줄, 3개 이상은 세로 — 이 규칙은 그대로다(iOS 도 같다).
    if (actions.size == 2) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = ALERT_INSET, end = ALERT_INSET, bottom = ALERT_INSET),
            horizontalArrangement = Arrangement.spacedBy(ACTION_GAP),
        ) {
            actions.forEach { action ->
                IosAlertButton(
                    action = action,
                    scheme = scheme,
                    modifier = Modifier.weight(1f).height(ACTION_HEIGHT),
                )
            }
        }
    } else {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = ALERT_INSET, end = ALERT_INSET, bottom = ALERT_INSET),
            verticalArrangement = Arrangement.spacedBy(ACTION_GAP),
        ) {
            actions.forEach { action ->
                IosAlertButton(
                    action = action,
                    scheme = scheme,
                    modifier = Modifier.fillMaxWidth().height(ACTION_HEIGHT),
                )
            }
        }
    }
}

@Composable
private fun IosAlertButton(
    action: IosAlertAction,
    scheme: ColorScheme,
    modifier: Modifier = Modifier,
) {
    // ⚠ **글자색만으로 구분한다 — 채움색은 모든 액션이 같다.** 실측에서 '취소'와
    // 파괴적 '로그아웃' 이 **같은 회색 채움**이었고, 다른 건 글자색(흰색 vs 빨강)뿐이었다.
    // 파괴적 액션을 빨간 채움으로 만들면 우리만 튄다.
    val contentColor = when {
        action.destructive -> scheme.error
        action.emphasized -> scheme.primary
        else -> scheme.onSurface
    }
    Box(
        modifier = modifier
            // 높이 48 의 캡슐(반경 24) — 실측값이다.
            .clip(WakerPillShape)
            .background(scheme.onSurface.copy(alpha = 0.10f))
            .clickable(enabled = action.enabled, onClick = action.onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = action.label,
            // 잠긴 동안에도 글자는 남기고 흐리게만 — 사라지면 버튼 위치가 밀려 오조작이 된다.
            color = if (action.enabled) contentColor else contentColor.copy(alpha = 0.38f),
            style = IosAlertType.Action,
            fontWeight = if (action.emphasized) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
