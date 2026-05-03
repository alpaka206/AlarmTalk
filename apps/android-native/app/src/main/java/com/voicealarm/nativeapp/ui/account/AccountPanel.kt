package com.voicealarm.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.VoiceProfile

@Composable
internal fun StepperField(
    label: String,
    valueLabel: String,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text(text = label, fontWeight = FontWeight.Medium)
            Text(
                text = valueLabel,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            IconButton(onClick = onDecrease) {
                Icon(Icons.Outlined.Remove, contentDescription = "$label 줄이기")
            }
            IconButton(onClick = onIncrease) {
                Icon(Icons.Outlined.Add, contentDescription = "$label 늘리기")
            }
        }
    }
}

@Composable
internal fun OptionSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                content()
            },
        )
    }
}

@Composable
internal fun DayRows(
    repeatDaysMask: Int,
    onToggleDay: (Int) -> Unit,
) {
    val days = listOf(
        0 to "일",
        1 to "월",
        2 to "화",
        3 to "수",
        4 to "목",
        5 to "금",
        6 to "토",
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            days.take(4).forEach { (index, label) ->
                DayChip(index, label, repeatDaysMask, onToggleDay)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            days.drop(4).forEach { (index, label) ->
                DayChip(index, label, repeatDaysMask, onToggleDay)
            }
        }
        Text(
            text = repeatLabel(repeatDaysMask),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun DayChip(
    dayIndex: Int,
    label: String,
    repeatDaysMask: Int,
    onToggleDay: (Int) -> Unit,
) {
    FilterChip(
        selected = repeatDaysMask and (1 shl dayIndex) != 0,
        onClick = { onToggleDay(dayIndex) },
        label = { Text(label) },
    )
}

@Composable
internal fun OptionChips(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, label) ->
                FilterChip(
                    selected = selected == value,
                    onClick = { onSelect(value) },
                    label = { Text(label) },
                )
            }
        }
    }
}

@Composable
internal fun AccountPanel(
    authSession: AuthSession?,
    authBusy: Boolean,
    syncBusy: Boolean,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
) {
    var mode by remember { mutableStateOf("login") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "계정",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )

            if (authSession != null) {
                Text(
                    text = authSession.user.email.ifBlank { authSession.user.name.ifBlank { authSession.provider } },
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "로그인 방식 ${providerLabel(authSession.provider)} - 플랜 ${planTypeLabel(authSession.user.plan)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = onSyncNow,
                        enabled = !syncBusy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (syncBusy) "동기화 중" else "지금 동기화")
                    }
                    OutlinedButton(
                        onClick = onLogout,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("로그아웃")
                    }
                }
                if (voiceProfileBusy) {
                    MutedText("음성 프로필을 불러오는 중이에요")
                }
                if (voiceProfiles.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        voiceProfiles.take(3).forEach { profile ->
                            Text(
                                text = "${profile.name} (${voiceStatusLabel(profile.status)})",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (voiceProfiles.size > 3) {
                            Text(
                                text = "외 ${voiceProfiles.size - 3}개 더",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            } else {
                OptionChips(
                    options = listOf(
                        "login" to "로그인",
                        "register" to "가입",
                    ),
                    selected = mode,
                    onSelect = { mode = it },
                )

                if (mode == "register") {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("이름") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Text,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("이메일") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("비밀번호") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        if (mode == "register") {
                            onRegister(email, password, name)
                        } else {
                            onLogin(email, password)
                        }
                    },
                    enabled = !authBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            authBusy -> "처리 중"
                            mode == "register" -> "계정 만들기"
                            else -> "로그인"
                        },
                    )
                }

                GoogleSignInButton(
                    enabled = !authBusy,
                    onClick = onGoogleSignIn,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
internal fun GoogleSignInButton(
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val contentAlpha = if (enabled) 1f else 0.38f
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(40.dp),
        shape = RoundedCornerShape(999.dp),
        color = Color.White,
        contentColor = Color(0xFF1F1F1F),
        border = BorderStroke(1.dp, Color(0xFF747775)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.ic_google_g),
                contentDescription = null,
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .size(18.dp)
                    .padding(0.dp),
                alpha = contentAlpha,
            )
            Text(
                text = "Google로 계속하기",
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = 32.dp),
                color = Color(0xFF1F1F1F).copy(alpha = contentAlpha),
                fontFamily = FontFamily.Default,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                lineHeight = 20.sp,
                maxLines = 1,
            )
        }
    }
}
