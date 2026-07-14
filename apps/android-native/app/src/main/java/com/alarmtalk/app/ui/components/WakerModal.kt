package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.filled.CheckCircle
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
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
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
 * 옵션 행들을 담는 그룹 컨테이너 — 시트의 옵션 목록을 pane 카드(SnoozeOptionSection)와 같은
 * '한 카드 안 행 + 헤어라인 구분선' 문법으로 통일한다. 행마다 테두리 버튼을 두지 않는다
 * (버튼 크로마가 겹치면 시트가 무겁고, 편집기 카드·세부 pane 과 문법이 어긋난다).
 */
@Composable
internal fun WakerSheetOptionGroup(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
        border = wakerCardBorder(),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) { content() }
    }
}

/**
 * 선택형 시트의 공통 옵션 행: [아이콘 배지] 제목/설명 … [trailing] 선택 표시.
 * 선택 표시는 체크 원(선택) / 빈 링(미선택)으로 통일한다.
 * trailing 은 선택 표시 바로 앞의 상태 슬롯 — 기본 목소리 시트의 재생 이퀄라이저 등.
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
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    divider: Boolean = false,
) {
    val scheme = MaterialTheme.colorScheme
    val hasLeading = leading != null || icon != null
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .heightIn(min = 56.dp)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when {
                leading != null -> leading()
                icon != null -> WakerIconBadge(
                    icon = icon,
                    containerColor = if (selected) scheme.primary else scheme.surface,
                    contentColor = if (selected) scheme.onPrimary else scheme.primary,
                    bordered = !selected,
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
                    color = scheme.onSurface,
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
            if (selected) {
                Icon(
                    imageVector = Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = scheme.primary,
                    modifier = Modifier.size(22.dp),
                )
            } else {
                Box(
                    modifier = Modifier.size(22.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        modifier = Modifier.size(20.dp),
                        shape = androidx.compose.foundation.shape.CircleShape,
                        color = Color.Transparent,
                        border = BorderStroke(1.5.dp, scheme.outline),
                    ) {}
                }
            }
        }
        if (divider) {
            // 텍스트 시작선까지 들여쓴 헤어라인 — pane(SnoozeOptionDivider)과 동일 문법.
            // 아이콘 배지(40) + 간격(12) + 좌패딩(14) = 66, 배지 없으면 좌패딩만.
            Box(
                modifier = Modifier
                    .padding(start = if (hasLeading) 66.dp else 14.dp)
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
