import SwiftUI

/// 알람 리스트의 한 줄 — 독립 카드.
///
/// Android `ui/components/ControlsAndPermissions.kt:215-386` 의 `AlarmRow` 미러.
/// 본문 탭은 알람 편집 진입, 토글·삭제 액션은 부모(AlarmsListView)에 위임해 본
/// 컴포넌트는 순수 표시 + 콜백 호출만 책임진다. 표면은 surface + outlineVariant 테두리에
/// WakerCardShape(22) 라운드, 18 패딩으로 그 자체가 한 장의 카드다.
struct AlarmRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let alarm: LocalAlarmRecord
    let onTap: () -> Void
    let onToggleEnabled: (Bool) -> Void
    let onDelete: () -> Void

    /// 트레일링 스와이프로 드러난 삭제 버튼의 가로 오프셋(px). 음수일수록 카드가 왼쪽으로
    /// 밀려 삭제 버튼이 보인다. Android `ControlsAndPermissions` 의 draggable reveal 과 동치.
    @State private var dragOffset: CGFloat = 0
    /// 스와이프로 삭제 버튼이 고정 노출된 상태.
    @State private var deleteRevealed = false

    /// 드러나는 삭제 버튼 폭. 이 값을 넘겨 밀면 버튼이 고정 노출된다.
    private let deleteRevealWidth: CGFloat = 88

    var body: some View {
        // SwiftUI `.swipeActions(edge:)` 는 `List` 행에서만 동작하는데, 알람 리스트는
        // ScrollView+VStack 구조라 `List` 가 아니다. 따라서 Android `draggable` reveal 과
        // 동일하게 DragGesture 기반 트레일링 스와이프를 직접 구현한다. 삭제는 스와이프
        // 버튼/길게 누르기 메뉴 어느 쪽이든 즉시 실행된다(Android 즉시 삭제 미러 — 별도
        // 확인 다이얼로그 없음, 스와이프 제스처 자체가 안전장치).
        ZStack(alignment: .trailing) {
            swipeDeleteBackground
            rowContent
                // deleteRevealed 동안엔 내부 Button(편집)/Toggle 로 탭이 새지 않도록
                // 본문 히트테스트를 끄고, 같은 영역을 덮는 투명 탭-캐처(아래 overlay)가
                // 탭을 받아 행을 닫게 한다. (열린 상태에서 본문 탭 = 닫기)
                .allowsHitTesting(!deleteRevealed)
                .background(theme.palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                        .stroke(theme.palette.outlineVariant, lineWidth: 1)
                )
                .overlay {
                    if deleteRevealed {
                        // 행이 열려 있을 때 본문 위를 덮어 탭을 가로채 행을 닫는다.
                        Color.clear
                            .contentShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
                            .onTapGesture {
                                withAnimation(.snappy(duration: 0.2)) { resetSwipe() }
                            }
                    }
                }
                .offset(x: dragOffset)
                // 스와이프 드래그가 내부 Button(onTap)/Toggle 보다 우선하도록
                // highPriorityGesture 로 부착한다.
                .highPriorityGesture(swipeGesture)
        }
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
    }

    private var rowContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                Button(action: onTap) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(alarm.timeString)
                            .font(.pretendard(.regular, size: 32))
                            .foregroundStyle(alarm.enabled ? theme.palette.onSurface : theme.palette.onSurfaceVariant)
                        Text(alarm.label)
                            .font(.pretendard(.semibold, size: 14))
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .foregroundStyle(alarm.enabled ? theme.palette.onSurface : theme.palette.onSurfaceVariant)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                Toggle(
                    "",
                    isOn: Binding(
                        get: { alarm.enabled },
                        set: { onToggleEnabled($0) }
                    )
                )
                .labelsHidden()
                .accessibilityLabel(Text(alarm.enabled ? "알람 끄기" : "알람 켜기"))
            }

            if let warningText {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 18))
                    Text(warningText)
                        .font(.pretendard(.semibold, size: 12))
                }
                .foregroundStyle(theme.palette.onErrorContainer)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    theme.palette.errorContainer.opacity(0.72),
                    in: RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous)
                )
            }
        }
        .padding(18)
        // Android 길게 누르기 삭제 메뉴와 동치인 접근성 대체 경로(스와이프 외).
        .contextMenu {
            Button("삭제", role: .destructive, action: onDelete)
        }
    }

    /// 스와이프로 드러나는 삭제 버튼. 탭하면 즉시 삭제한다(Android DeleteRevealButton 미러).
    private var swipeDeleteBackground: some View {
        HStack {
            Spacer(minLength: 0)
            Button {
                resetSwipe()
                onDelete()
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "trash")
                        .font(.title3)
                    Text("삭제")
                        .font(.pretendard(.semibold, size: 12))
                }
                .foregroundStyle(theme.palette.onError)
                .frame(width: deleteRevealWidth)
                .frame(maxHeight: .infinity)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("알람 삭제"))
        }
        .background(theme.palette.error)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                let base = deleteRevealed ? -deleteRevealWidth : 0
                // 왼쪽(트레일링)으로만 끌리도록 0 이상은 막는다.
                dragOffset = min(0, max(-deleteRevealWidth, base + value.translation.width))
            }
            .onEnded { value in
                let projected = (deleteRevealed ? -deleteRevealWidth : 0) + value.translation.width
                withAnimation(.snappy(duration: 0.2)) {
                    if projected <= -deleteRevealWidth * 0.5 {
                        deleteRevealed = true
                        dragOffset = -deleteRevealWidth
                    } else {
                        resetSwipe()
                    }
                }
            }
    }

    private func resetSwipe() {
        deleteRevealed = false
        dragOffset = 0
    }

    private var warningText: String? {
        if alarm.runtimeStateEnum == .failed {
            return "알람을 다시 예약하지 못했어요. 시간을 확인하고 다시 저장해 주세요."
        }
        if alarm.syncStateEnum == .syncFailed {
            return "서버에 저장하지 못했어요. 이 기기의 알람은 그대로 울려요."
        }
        return nil
    }
}

#if DEBUG
private extension LocalAlarmRecord {
    /// Preview 전용 더미 인스턴스. snake_case 필드까지 모두 채워 화면 표시를 확인.
    static var previewSample: LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            id: "preview-1",
            label: "아침 알람",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 8 * 60 * 60 * 1000,
            repeatDaysMask: 0,
            holidayOff: false,
            snoozeEnabled: true,
            snoozeMinutes: 5,
            snoozeRepeatLimit: SnoozeRepeatLimit.three.rawValue,
            snoozeCount: 0,
            vibrationPattern: VibrationPattern.default.rawValue,
            playMode: AlarmPlayMode.alarmOnly.rawValue,
            defaultAlarmSoundId: DefaultAlarmSounds.bundledDefault,
            localAudioUri: nil,
            audioCacheKey: nil,
            rawAudioUri: nil,
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: nil,
            voiceText: nil,
            voiceCategory: nil,
            voiceLanguage: nil,
            voiceRandomPrompt: false,
            voiceRepeat: true,
            ttsMessageId: nil,
            remoteAlarmId: nil,
            lastSyncedAtMillis: nil,
            syncState: AlarmSyncState.localOnly.rawValue,
            origin: AlarmOrigin.localOwned.rawValue,
            alarmVolumePercent: 100,
            alarmSoundUri: nil,
            alarmSoundLabel: nil,
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now,
            alarmKitID: nil
        )
    }
}

#Preview("AlarmRow (light)") {
    AlarmRow(
        alarm: .previewSample,
        onTap: {}, onToggleEnabled: { _ in }, onDelete: {}
    )
    .padding()
}

#Preview("AlarmRow (dark)") {
    AlarmRow(
        alarm: .previewSample,
        onTap: {}, onToggleEnabled: { _ in }, onDelete: {}
    )
    .padding()
    .preferredColorScheme(.dark)
}
#endif
