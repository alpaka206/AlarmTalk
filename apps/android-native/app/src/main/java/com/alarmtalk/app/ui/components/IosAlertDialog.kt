package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
    val Title = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = (-0.4).sp, fontWeight = FontWeight.SemiBold)
    val Message = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, letterSpacing = (-0.08).sp)
    val Field = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, letterSpacing = (-0.2).sp)
    val Action = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = (-0.4).sp)
}

internal data class IosAlertAction(
    val label: String,
    val emphasized: Boolean = false,
    val destructive: Boolean = false,
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
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = 40.dp)
                .widthIn(max = 300.dp),
            shape = RoundedCornerShape(14.dp),
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
                            .padding(start = 16.dp, end = 16.dp, top = 19.dp, bottom = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        if (!title.isNullOrBlank()) {
                            Text(
                                text = title,
                                color = scheme.onSurface,
                                textAlign = TextAlign.Center,
                                style = IosAlertType.Title,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        if (!title.isNullOrBlank() && !message.isNullOrBlank()) {
                            Spacer(Modifier.height(4.dp))
                        }
                        if (!message.isNullOrBlank()) {
                            Text(
                                text = message,
                                color = scheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                style = IosAlertType.Message,
                                modifier = Modifier.fillMaxWidth(),
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
                            .padding(start = 16.dp, end = 16.dp, top = 19.dp, bottom = 16.dp),
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
 * 액션 행 높이. iOS 원본은 44dp 지만 그건 **Android 최소 터치 타깃(48dp)보다 작다** —
 * 폰에서 눌러 보면 실제로 빠듯하다. 52dp 로 두면 접근성 기준을 넘기면서도 알럿의
 * 납작한 느낌은 유지된다(세로로 3개 쌓여도 과하지 않다).
 */
private val ACTION_ROW_HEIGHT = 52.dp

@Composable
private fun IosAlertActionRow(actions: List<IosAlertAction>, scheme: ColorScheme) {
    val separator = scheme.onSurface.copy(alpha = 0.20f)
    if (actions.size == 2) {
        Column(modifier = Modifier.fillMaxWidth()) {
            HorizontalDivider(thickness = 0.5.dp, color = separator)
            Row(modifier = Modifier.fillMaxWidth().height(ACTION_ROW_HEIGHT)) {
                IosAlertButton(
                    action = actions[0],
                    scheme = scheme,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
                VerticalDivider(thickness = 0.5.dp, color = separator)
                IosAlertButton(
                    action = actions[1],
                    scheme = scheme,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
            }
        }
    } else {
        Column(modifier = Modifier.fillMaxWidth()) {
            actions.forEach { action ->
                HorizontalDivider(thickness = 0.5.dp, color = separator)
                IosAlertButton(
                    action = action,
                    scheme = scheme,
                    modifier = Modifier.fillMaxWidth().height(ACTION_ROW_HEIGHT),
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
    val color = if (action.destructive) scheme.error else scheme.primary
    Box(
        modifier = modifier.clickable(onClick = action.onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = action.label,
            color = color,
            style = IosAlertType.Action,
            fontWeight = if (action.emphasized) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
