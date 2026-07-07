package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
            modifier = Modifier
                .fillMaxWidth()
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
 * 선택형 시트의 공통 옵션 행: [아이콘 배지] 제목/설명 … 선택 표시.
 * 선택 표시는 체크 원(선택) / 빈 링(미선택)으로 통일한다.
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
) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = if (selected) {
            scheme.primaryContainer.copy(alpha = 0.55f)
        } else {
            scheme.surfaceVariant.copy(alpha = 0.34f)
        },
        border = BorderStroke(
            width = 1.dp,
            color = if (selected) scheme.primary.copy(alpha = 0.5f) else scheme.outlineVariant,
        ),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
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
