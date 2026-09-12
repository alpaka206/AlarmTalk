package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import com.alarmtalk.app.WakerInputShape
import com.alarmtalk.app.WakerPillShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.border
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
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
 * ⚠ **수치는 이 주석이 아니라 아래 상수·본문이 원본이다**(2026-09-02 정정).
 * 예전에는 여기에 Figma `2018:456` 값을 적어 뒀는데, 그 뒤 **실기기 실측으로 여섯 항목을
 * 고치면서 주석만 안 고쳐** 같은 파일 안에서 정반대를 말하고 있었다(radius 14 vs 34,
 * 폭 300 vs 320, 액션 44 vs 48 …). 값이 궁금하면 `ALERT_*` 상수와 각 Composable 을 볼 것.
 *
 * 지금 살아 있는 규격의 근거는 **iOS 26 실측**이고, 그 이유는 각 상수 옆 주석에 있다.
 * 규격 표는 `docs/spec/alarm-editor.md` §4-1 이 유일 출처다.
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
            // ⚠ **`surfaceVariant`(#29345A)로 되돌리지 말 것**(2026-08-17 지시
            // "아이폰처럼 배경색이나 버튼색"). 실측하면 아이폰 알럿 컨테이너는 **#111623**
            // 로 **화면보다 어둡고 채도가 낮다** — 우리 것은 한 단계 밝은 남색이라 같은
            // 알럿이 두 앱에서 다른 물건처럼 보였다. 어두운 쪽이 뒤 화면과도 더 잘 갈린다.
            color = wakerAlertContainer(),
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = BorderStroke(0.5.dp, scheme.onSurface.copy(alpha = 0.12f)),
        ) {
            // ⚠ **알럿 안에서도 입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시).
            // 알럿은 **자기 창**이라 `AlarmTalkApp` 의 Scaffold 제스처가 닿지 않는다 —
            // 제목·여백을 눌러도 키보드가 그대로 떠 있었다(실기기 확인).
            //
            // 알럿은 **자기 창**이라 `AlarmTalkApp` 의 제스처가 닿지 않아 여기 따로 건다.
            Column(modifier = Modifier.fillMaxWidth().clearFocusOnOutsideTap()) {
                val hasContent = !title.isNullOrBlank() || !message.isNullOrBlank()
                if (hasContent) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(
                                start = ALERT_TEXT_INSET,
                                end = ALERT_TEXT_INSET,
                                top = 22.dp,
                                // 입력이 있으면 아래 여백은 입력 블록이 갖는다.
                                bottom = if (content == null) 20.dp else 0.dp,
                            ),
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
                        //
                        // ⚠ **입력이 있는 알럿은 줄 수와 무관하게 왼쪽이다**(2026-08-17 지시).
                        // 입력칸 안의 글자는 언제나 왼쪽에서 시작하는데 그 위의 제목·본문만
                        // 가운데면, 한 모달 안에 시작점이 두 개가 된다. 알럿보다 **폼**에
                        // 가까운 물건이라 폼처럼 왼쪽 한 줄로 세운다.
                        val longMessage = messageLineCount >= 2
                        val blockAlign = if (longMessage || content != null) TextAlign.Start else TextAlign.Center
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
                    }
                }
                if (content != null) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            // ⚠ **글자 여백(30)이 아니라 버튼 여백(16)이다**(2026-08-17 지시).
                            // 예전에는 입력칸이 글자 블록 **안에** 있어서 30 을 물려받았고,
                            // 그래서 바로 아래 버튼보다 좌우로 14dp 씩 좁았다 — 세로로 맞닿은
                            // 두 상자의 폭이 다르면 그 어긋남만 눈에 걸린다.
                            .padding(
                                start = ALERT_INSET,
                                end = ALERT_INSET,
                                // 본문이 있으면 그 문단과 입력 사이 간격(14). 제목뿐이면 조금 더
                                // 띄운다(10) — 4dp 로 두면 입력창이 제목에 달라붙어, 제목이
                                // 입력창의 라벨처럼 읽힌다(폰에서 확인).
                                // 제목·본문이 아예 없는 알럿은 위 여백을 직접 갖는다(22).
                                top = when {
                                    !hasContent -> 22.dp
                                    message.isNullOrBlank() -> 10.dp
                                    else -> 14.dp
                                },
                                bottom = 20.dp,
                            ),
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
 * 기본 48dp 인 이유는 액션 행([ACTION_ROW_HEIGHT])과 같다 — **Android 최소 터치 타깃**이면서
 * 동시에 **iOS 실측값**이다(2026-08-11: `UIAlertController` 의 입력칸 컨테이너 h=48).
 * 모양도 iOS 와 같은 **캡슐**이다(r=24 = 48/2).
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
    /// 모서리. 알럿 안에서는 캡슐이지만, **알럿 밖에서도 쓴다** — 코드 등록 행처럼
    /// 옆에 버튼이 서는 자리는 M3 `OutlinedTextField`(최소 56)로는 높이를 맞출 수 없다.
    ///
    /// ⚠ **캡슐은 한 줄일 때만이다**(2026-08-20). 캡슐 반경은 999 라 실제 반경이 높이의
    /// 절반으로 잘리는데, 직접 입력처럼 `minHeight = 108` 인 여러 줄 칸에서는 그게 **반경
    /// 54** 가 되어 좌우가 통째로 반원이 된다 — 아래 실측 근거(h=48·r=24)는 한 줄 칸의
    /// 것이고, 여러 줄에 그대로 쓰면 근거 없는 모양이 나온다. 여러 줄은 앱 표준 입력
    /// 반경(`WakerInputShape`)을 쓴다.
    shape: Shape = if (singleLine) WakerPillShape else WakerInputShape,
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
        modifier = Modifier.textInputTapTarget().then(modifier.fillMaxWidth()),
        decorationBox = { inner ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = minHeight)
                    // ⚠ **캡슐이다 — 8dp 같은 각진 값으로 되돌리지 말 것**(2026-08-11 실측).
                    // iOS `UIAlertController` 를 띄워 계층을 훑어 보니 입력칸 컨테이너는
                    // **h=48, cornerRadius=24** 즉 완전한 캡슐이었다(액션 버튼도 h=48·r=24,
                    // 알럿 컨테이너는 r=34). 예전 주석은 "컨테이너(14)보다 작은 반경" 이라
                    // 적었는데 **컨테이너가 14였던 적이 없다** — 34다. 근거가 틀렸으니
                    // 거기서 나온 8도 틀렸다.
                    .border(0.5.dp, scheme.onSurface.copy(alpha = 0.22f), shape)
                    .background(scheme.surface.copy(alpha = 0.5f), shape)
                    // 캡슐이라 좌우가 둥글게 파고들어, 10 이면 글자가 모서리에 닿는다.
                    .padding(horizontal = 16.dp, vertical = 8.dp),
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
 * 알럿 컨테이너 색 — 아이폰 실측 #111623 에 맞춘 어두운 중성 남색.
 * 라이트 테마에서도 알럿은 어두운 패널이라 테마와 무관하게 고정이다(아이폰도 그렇다).
 */
private val WakerAlertContainerDark = Color(0xFF141A2B)

/**
 * 라이트 테마의 알럿 컨테이너 — iOS 라이트 알럿과 같은 밝은 회백(#F2F2F7).
 *
 * ⚠ **이게 없던 시절이 버그였다**(2026-08-18 실기기 확인). 컨테이너만 다크로 고정해 두고
 * 글자·테두리는 `MaterialTheme.colorScheme` 에서 가져오는데, **라이트에서 `onSurface` 는
 * 거의 검정**이라 어두운 패널 위에 검은 글자가 얹혀 **제목이 보이지 않았다.**
 *
 * ⚠ 그리고 "아이폰도 알럿은 항상 어둡다" 는 옛 주석의 근거는 **틀렸다.** 아이폰 알럿은
 * 시스템 외관을 따르고(라이트면 밝은 알럿), **우리 iOS 앱은 시스템 `.alert` 를 쓴다.**
 * 즉 고정 다크는 아이폰을 닮은 게 아니라 **라이트에서 아이폰과 어긋나게** 만들고 있었다.
 * 실측 #111623 은 다크 모드 아이폰에서 잰 값으로 보인다.
 */
private val WakerAlertContainerLight = Color(0xFFF2F2F7)

/** 지금 스킴에 맞는 알럿 컨테이너. 판정은 [LocalIsDarkTheme] — 앱 자체 테마 설정까지 반영한다. */
@Composable
private fun wakerAlertContainer(): Color =
    if (LocalIsDarkTheme.current) WakerAlertContainerDark else WakerAlertContainerLight

/** 알럿 버튼의 기본 채움 — 아이폰 실측 #2A2F39. */
private val WakerAlertButtonFillDark = Color(0xFF2A2F3A)

/** 라이트 알럿의 버튼 채움 — 위 컨테이너(#F2F2F7)보다 한 단계 진한 회색이라야 칸이 보인다. */
private val WakerAlertButtonFillLight = Color(0xFFE4E5EB)

/** 지금 스킴에 맞는 버튼 채움. 그 위 글자는 `scheme.onSurface` 라 저절로 짝이 맞는다. */
@Composable
private fun wakerAlertButtonFill(): Color =
    if (LocalIsDarkTheme.current) WakerAlertButtonFillDark else WakerAlertButtonFillLight

/**
 * 기본 액션의 채움 — **아이폰과 같은 쨍한 파랑**(iOS 시스템 블루 #0A84FF)에 흰 글자.
 *
 * ⚠ **테마 `primary` 로 되돌리지 말 것**(2026-08-17 지시 "아이폰 쪽이 더 마음에 든다").
 * 다크 테마의 `primary` 는 **하늘색(#A6D2FF)** 이고 그 위 글자는 진남색이라, 같은 알럿이
 * 아이폰에서는 파란 버튼에 흰 글자인데 안드로이드에서는 하늘색 버튼에 검은 글자였다.
 * 알럿은 **플랫폼 알럿을 흉내 내는 껍데기**라(이 파일의 존재 이유) 여기서는 브랜드
 * 색보다 그 규격을 따른다 — 화면 본문의 채움 버튼은 계속 `primary` 다.
 *
 * 흰 글자 대비 3.65:1 — 알럿 액션은 17sp SemiBold(큰 글자)라 기준 3:1 을 넘는다.
 */
private val WakerAlertAccent = Color(0xFF0A84FF)

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
    // ⚠ **강조 액션은 '채워진' 버튼이다**(2026-08-17 실측). 아이폰 알럿에서 기본 액션은
    // **파란 채움 + 흰 글자**(#089CFF)이고 나머지는 중성 회색 채움(#2A2F39)이다.
    // 우리는 모든 버튼이 같은 채움이고 글자색만 달랐다 — 어느 것이 기본 액션인지
    // 한눈에 안 보였다.
    // ⚠ 파괴적 액션은 **채우지 않는다.** 아이폰도 회색 채움 + 빨간 글자다 — 빨간 채움은
    // 우리만 튄다.
    val filled = action.emphasized && !action.destructive
    val contentColor = when {
        action.destructive -> scheme.error
        filled -> Color.White
        else -> scheme.onSurface
    }
    Box(
        modifier = modifier
            // 높이 48 의 캡슐(반경 24) — 실측값이다.
            .clip(WakerPillShape)
            .background(if (filled) WakerAlertAccent else wakerAlertButtonFill())
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
