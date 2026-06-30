package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerCardShape
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerPillShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

@Composable
internal fun HomeHeader() {
    val hour = java.time.LocalTime.now().hour
    val (greetingTop, greetingBottom) = when {
        hour < 6 -> stringResource(R.string.hs_greeting_voice_top) to stringResource(R.string.hs_greeting_voice_bottom)
        hour < 12 -> stringResource(R.string.hs_greeting_morning_top) to stringResource(R.string.hs_greeting_morning_bottom)
        hour < 17 -> stringResource(R.string.hs_greeting_tomorrow_top) to stringResource(R.string.hs_greeting_tomorrow_bottom)
        hour < 21 -> stringResource(R.string.hs_greeting_each_other_top) to stringResource(R.string.hs_greeting_each_other_bottom)
        else -> stringResource(R.string.hs_greeting_voice_top) to stringResource(R.string.hs_greeting_voice_bottom)
    }
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = greetingTop,
            modifier = Modifier.padding(end = 72.dp),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = greetingBottom,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
internal fun ProfileMenu(
    hasSharedPass: Boolean,
    onSelectTab: (NativeTab) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenMemberManagement: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Surface(
            modifier = Modifier
                .size(44.dp)
                .clickable { expanded = true },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shadowElevation = 4.dp,
        ) {
            Box(
                modifier = Modifier.size(44.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Person,
                    contentDescription = stringResource(R.string.hs_profile_content_desc),
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.width(232.dp),
            shape = WakerCardShape,
            containerColor = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 14.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Column(
                modifier = Modifier.padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (!hasSharedPass) {
                    ProfileMenuItem(
                        icon = Icons.Outlined.QrCode2,
                        label = stringResource(R.string.hs_profile_menu_invite_code),
                    ) {
                        expanded = false
                        onSelectTab(NativeTab.People)
                    }
                }
                ProfileMenuItem(
                    icon = Icons.Outlined.CreditCard,
                    label = stringResource(R.string.hs_profile_menu_pass),
                ) {
                    expanded = false
                    onSelectTab(NativeTab.Billing)
                }
                if (hasSharedPass) {
                    ProfileMenuItem(
                        icon = Icons.Outlined.People,
                        label = stringResource(R.string.hs_profile_menu_shared_pass),
                    ) {
                        expanded = false
                        onOpenMemberManagement()
                    }
                }
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                ProfileMenuItem(
                    icon = Icons.Outlined.Settings,
                    label = stringResource(R.string.hs_profile_menu_settings),
                ) {
                    expanded = false
                    onOpenSettings()
                }
            }
        }
    }
}

@Composable
internal fun ProfileMenuItem(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier.size(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(21.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}


enum class ThemeMode { System, Light, Dark }

internal fun themeModeLabel(context: android.content.Context, mode: ThemeMode): String = when (mode) {
    ThemeMode.System -> context.getString(R.string.misc2_theme_mode_system)
    ThemeMode.Light -> context.getString(R.string.misc2_theme_mode_light)
    ThemeMode.Dark -> context.getString(R.string.misc2_theme_mode_dark)
}

@Composable
internal fun ThemeModePickerDialog(
    current: ThemeMode,
    onDismiss: () -> Unit,
    onSelect: (ThemeMode) -> Unit,
) {
    val options = listOf(
        ThemeModeOption(
            mode = ThemeMode.System,
            title = stringResource(R.string.hs_theme_system_title),
            description = stringResource(R.string.hs_theme_system_desc),
            icon = Icons.Outlined.Settings,
        ),
        ThemeModeOption(
            mode = ThemeMode.Light,
            title = stringResource(R.string.hs_theme_light_title),
            description = stringResource(R.string.hs_theme_light_desc),
            icon = Icons.Outlined.LightMode,
        ),
        ThemeModeOption(
            mode = ThemeMode.Dark,
            title = stringResource(R.string.hs_theme_dark_title),
            description = stringResource(R.string.hs_theme_dark_desc),
            icon = Icons.Outlined.DarkMode,
        ),
    )

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .widthIn(max = 420.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ModalDialogTitle(stringResource(R.string.hs_theme_dialog_title), onDismiss = onDismiss)
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    options.forEach { option ->
                        ThemeModeOptionRow(
                            option = option,
                            selected = option.mode == current,
                            onClick = {
                                onSelect(option.mode)
                                onDismiss()
                            },
                        )
                    }
                }
            }
        }
    }
}

private data class ThemeModeOption(
    val mode: ThemeMode,
    val title: String,
    val description: String,
    val icon: ImageVector,
)

@Composable
private fun ThemeModeOptionRow(
    option: ThemeModeOption,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = if (selected) {
            scheme.primaryContainer.copy(alpha = 0.62f)
        } else {
            scheme.surfaceVariant.copy(alpha = 0.34f)
        },
        border = BorderStroke(
            width = 1.dp,
            color = if (selected) scheme.primary.copy(alpha = 0.52f) else scheme.outlineVariant,
        ),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = CircleShape,
                color = if (selected) scheme.primary else scheme.surface,
                contentColor = if (selected) scheme.onPrimary else scheme.primary,
                border = BorderStroke(1.dp, scheme.outlineVariant),
            ) {
                Box(
                    modifier = Modifier.size(42.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = option.icon,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = option.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = scheme.onSurface,
                )
                Text(
                    text = option.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                )
            }
            if (selected) {
                Surface(
                    shape = WakerPillShape,
                    color = scheme.primary,
                    contentColor = scheme.onPrimary,
                ) {
                    Text(
                        text = stringResource(R.string.hs_theme_selected),
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

@Composable
internal fun NicknameEditDialog(
    initial: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    val trimmedValue = value.trim()
    val canSave = !busy && trimmedValue.isNotEmpty() && trimmedValue != initial

    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .widthIn(max = 430.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ModalDialogTitle(
                    title = stringResource(R.string.hs_nickname_dialog_title),
                    onDismiss = onDismiss,
                    dismissEnabled = !busy,
                )
                Surface(
                    shape = WakerPanelShape,
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.34f),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surface,
                            contentColor = MaterialTheme.colorScheme.primary,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        ) {
                            Box(
                                modifier = Modifier.size(42.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Person,
                                    contentDescription = null,
                                    modifier = Modifier.size(22.dp),
                                )
                            }
                        }
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = stringResource(R.string.hs_nickname_display_name_title),
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                            Text(
                                text = stringResource(R.string.hs_nickname_display_name_desc),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it.take(30) },
                        label = { Text(stringResource(R.string.hs_nickname_field_label)) },
                        placeholder = { Text(stringResource(R.string.hs_nickname_field_placeholder)) },
                        singleLine = true,
                        enabled = !busy,
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = stringResource(R.string.hs_nickname_char_counter, value.length),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.End),
                    )
                }
                Button(
                    onClick = { onConfirm(value) },
                    enabled = canSave,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(if (busy) stringResource(R.string.hs_nickname_saving) else stringResource(R.string.hs_nickname_save))
                }
            }
        }
    }
}

@Composable
internal fun DeleteAccountConfirmDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            ModalDialogTitle(
                title = stringResource(R.string.hs_delete_account_title),
                onDismiss = onDismiss,
                dismissEnabled = !busy,
            )
        },
        text = {
            Text(
                stringResource(R.string.hs_delete_account_body),
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !busy) {
                Text(
                    text = stringResource(R.string.hs_delete_account_confirm),
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
    )
}

@Composable
internal fun ScreenHeader(
    title: String,
    subtitle: String? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        if (!subtitle.isNullOrBlank()) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
