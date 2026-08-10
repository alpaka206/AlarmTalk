package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// ─────────────────────────────────────────────────────────────────────────────
// 통일 모달 컴포넌트 — "선택형" 모달의 단일 스타일.
//
// 앱 안의 선택 UI(테마 모드, 공휴일 국가, 가족 수신자 …)는 전부 이
// WakerSelectionSheet + WakerSheetOptionRow 조합을 쓴다. 다이얼로그·시트가
// 화면마다 다른 헤더/버튼/모서리를 갖지 않도록 하는 단일 출처.
//
// 기본 동작은 "탭 = 선택 + dismiss()" 지만, 미리듣기가 딸린 선택(기본 목소리)은
// 여러 옵션을 이어 들어볼 수 있게 탭해도 시트를 닫지 않는다 — 재생 표시는
// trailing 슬롯에 넣고, 닫기는 드래그/스크림에 맡긴다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 선택형 바텀시트의 공통 껍데기: 드래그 핸들 + 좌측 타이틀 + 콘텐츠.
 * content 람다에 전달되는 dismiss() 는 시트를 애니메이션으로 접은 뒤
 * onDismiss 를 호출한다 — 옵션 선택 직후 닫을 때 이걸 쓴다.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun WakerSelectionSheet(
    title: String,
    onDismiss: () -> Unit,
    subtitle: String? = null,
    content: @Composable ColumnScope.(dismiss: () -> Unit) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val dismiss: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = WakerSheetShape,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        scrimColor = WakerScrimColor,
        dragHandle = { WakerSheetDragHandle() },
    ) {
        Column(
            // 옵션 목록이 시트 최대 높이를 넘으면(서버가 주는 동적 목록) 스크롤로 닿게 한다.
            // 좌우 패딩은 타이틀 블록에만 준다 — 옵션 행(WakerSheetOptionRow)은 시트 폭 전체로
            // 퍼지는 민짜 행(iOS 액션시트 문법)이라 리플/구분선이 가장자리까지 이어져야 한다.
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            content(dismiss)
        }
    }
}

@Composable
private fun WakerSheetDragHandle() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp, bottom = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier
                .width(36.dp)
                .height(4.dp),
            shape = WakerPillShape,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f),
        ) {}
    }
}

/**
 * 옵션 행들을 묶는 그룹 — 박스(테두리/틴트) 없이 민짜 행 + 헤어라인만 둔다. 시트 자체가 이미
 * 둥근 컨테이너라 안에 카드를 또 두면 이중 컨테이너가 된다(페이지=그룹 카드, 오버레이 시트=민짜 행).
 * 행은 시트 폭 전체로 퍼져 리플/구분선이 가장자리까지 이어진다(iOS 액션시트 문법).
 */
@Composable
internal fun WakerSheetOptionGroup(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth()) { content() }
}

/**
 * 선택형 시트의 공통 옵션 행: [아이콘 배지] 제목/설명 … [trailing] 선택 표시.
 * 선택 표시는 '선택된 행에만' 체크(✓) — 미선택 행은 아무 표시 없음(iOS 정석). 선택 상태가 없는
 * 액션 시트(예: 누구를 깨울까요, selected=false 고정)는 자연히 표시가 없다.
 * trailing 은 선택 표시 바로 앞의 상태 슬롯 — 기본 목소리 시트의 재생 이퀄라이저 등.
 * destructive=true 는 되돌릴 수 없는 액션(삭제)의 제목을 error 색으로 — IosAlertAction 과 같은 문법.
 * 반드시 [WakerSheetOptionGroup] 안에서 쓰고, 마지막 행이 아니면 divider=true 로 헤어라인을 잇는다.
 */
@Composable
internal fun WakerSheetOptionRow(
    title: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
    icon: ImageVector? = null,
    /**
     * 아이콘을 **배지(둥근 상자 + 배경)** 로 감쌀지. 기본은 감싼다.
     *
     * ⚠ 테마 시트는 `false` 다 — iOS 는 맨몸 심볼이고 배지를 두지 않는다
     * (2026-08-10 "아이콘에 박스랑 배경 안 깔아줘도 돼"). 배지는 아이콘이 여러 종류의
     * 대상을 구분해야 할 때 쓰는 표현이라, 세 항목뿐인 테마에는 과하다.
     */
    iconBadged: Boolean = true,
    /**
     * 구분선을 **텍스트 시작선까지 들여쓸지**. 기본은 들여쓴다(아이콘이 있을 때).
     *
     * ⚠ 테마 시트는 `false` 다 — iOS 선택 시트의 구분선은 좌우 끝까지 간다.
     */
    dividerInset: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    divider: Boolean = false,
    destructive: Boolean = false,
) {
    val scheme = MaterialTheme.colorScheme
    val hasLeading = leading != null || icon != null
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .heightIn(min = 56.dp)
                .padding(horizontal = 20.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when {
                leading != null -> leading()
                icon != null && iconBadged -> WakerIconBadge(
                    icon = icon,
                    containerColor = if (selected) scheme.primary else scheme.surface,
                    contentColor = if (selected) scheme.onPrimary else scheme.primary,
                    bordered = !selected,
                )
                icon != null -> Icon(
                    imageVector = icon,
                    contentDescription = null,
                    // iOS 는 선택 여부와 무관하게 항상 primary 색이다.
                    tint = scheme.primary,
                    // iOS `frame(width: 32)` 과 같은 자리를 차지한다(아이콘 24 + 여유).
                    modifier = Modifier.size(32.dp),
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = if (destructive) scheme.error else scheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!description.isNullOrBlank()) {
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = scheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            trailing?.invoke()
            // 선택 표시는 '선택된 행에만' 체크(✓) — iOS 정석. 미선택 행의 빈 링은 라디오 문법의
            // 노이즈이고, 선택 상태가 없는 액션 시트(누구를 깨울까요)에선 표시 자체가 무의미하다
            // (그 시트는 selected=false 라 자연히 아무 표시 없음).
            if (selected) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = scheme.primary,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        if (divider) {
            // 아이콘 배지가 있으면 텍스트 시작선(40+12+20=72)까지 들여쓰고, 아니면
            // **좌우 끝까지** 긋는다 — iOS 선택 시트가 그렇다(2026-08-10 "구분선을 더 길게").
            Box(
                modifier = Modifier
                    .padding(start = if (hasLeading && dividerInset) 72.dp else 0.dp)
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(scheme.outlineVariant),
            )
        }
    }
}

/**
 * 틴트 배경 위 아이콘 배지 — 리스트 행/카드의 "맨몸 아이콘"을 대체하는 표준.
 * 배경은 WakerTileShape(12dp) 라운드 사각형으로 통일한다.
 */
@Composable
internal fun WakerIconBadge(
    icon: ImageVector,
    containerColor: Color,
    contentColor: Color,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    iconSize: Dp = 21.dp,
    bordered: Boolean = false,
) {
    Surface(
        modifier = modifier.size(size),
        shape = WakerTileShape,
        color = containerColor,
        contentColor = contentColor,
        border = if (bordered) wakerCardBorder() else null,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(iconSize),
            )
        }
    }
}
