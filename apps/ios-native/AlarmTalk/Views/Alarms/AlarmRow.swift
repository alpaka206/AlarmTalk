import SwiftUI

/// 알람 리스트의 한 줄.
///
/// ContentView 의 `alarmRow(_:)` 헬퍼를 옮긴 것. 본문은 알람 편집 진입,
/// 토글과 삭제 액션은 부모(AlarmsListView)에 위임해 본 컴포넌트는 순수 표시 +
/// 콜백 호출만 책임진다.
struct AlarmRow: View {
    let alarm: LocalAlarmRecord
    let onTap: () -> Void
    let onToggleEnabled: (Bool) -> Void
    let onCopy: () -> Void
    let onDelete: () -> Void

    /// 삭제 확인 알림 표시 여부. 스와이프·오버플로 메뉴 두 경로 모두 이 상태를 통해
    /// 동일한 확인 알림(`회원 탈퇴` 알림 패턴)을 거치게 한다.
    @State private var confirmingDelete = false
    /// 트레일링 스와이프로 드러난 삭제 버튼의 가로 오프셋(px). 음수일수록 카드가 왼쪽으로
    /// 밀려 삭제 버튼이 보인다. Android `ControlsAndPermissions` 의 draggable reveal 과 동치.
    @State private var dragOffset: CGFloat = 0
    /// 스와이프로 삭제 버튼이 고정 노출된 상태.
    @State private var deleteRevealed = false

    /// 드러나는 삭제 버튼 폭. 이 값을 넘겨 밀면 버튼이 고정 노출된다.
    private let deleteRevealWidth: CGFloat = 88

    var body: some View {
        // SwiftUI `.swipeActions(edge:)` 는 `List` 행에서만 동작하는데, 알람 리스트는
        // 카드 스타일(`sectionSurface`) 유지를 위해 ScrollView+VStack 구조라 `List` 가
        // 아니다. 따라서 Android `draggable` reveal 과 동일하게 DragGesture 기반 트레일링
        // 스와이프를 직접 구현한다. 스와이프·오버플로 메뉴 모두 `confirmingDelete` 단일
        // 확인 경로로 모인다.
        ZStack(alignment: .trailing) {
            swipeDeleteBackground
            rowContent
                // deleteRevealed 동안엔 내부 Button(편집)/Toggle 로 탭이 새지 않도록
                // 본문 히트테스트를 끄고, 같은 영역을 덮는 투명 탭-캐처(아래 overlay)가
                // 탭을 받아 행을 닫게 한다. (열린 상태에서 본문 탭 = 닫기)
                .allowsHitTesting(!deleteRevealed)
                .background(AlarmTalkTheme.surfaceVariant)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay {
                    if deleteRevealed {
                        // 행이 열려 있을 때 본문 위를 덮어 탭을 가로채 행을 닫는다.
                        // 투명하지만 contentShape 로 전체 영역이 탭에 반응한다.
                        Color.clear
                            .contentShape(RoundedRectangle(cornerRadius: 8))
                            .onTapGesture {
                                withAnimation(.snappy(duration: 0.2)) { resetSwipe() }
                            }
                    }
                }
                .offset(x: dragOffset)
                // 스와이프 드래그가 내부 Button(onTap)/Toggle 보다 우선하도록
                // highPriorityGesture 로 부착한다. 탭이 드래그에 먹히거나, 스와이프가
                // onTap 으로 새지 않게 한다.
                .highPriorityGesture(swipeGesture)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        // `회원 탈퇴` 알림과 동일한 .alert + role:.destructive 패턴.
        // 의도적 누락: 서버 측 소프트 삭제(휴지통)가 없어 양 플랫폼 모두 실행취소/스낵바를
        // 제공하지 않는다. 비가역 삭제이므로 이 확인 알림이 유일한 안전장치다.
        .alert("알람 삭제", isPresented: $confirmingDelete) {
            Button("삭제", role: .destructive) {
                resetSwipe()
                onDelete()
            }
            Button("취소", role: .cancel) { resetSwipe() }
        } message: {
            Text("이 알람을 삭제할까요? 알람과 음성·서버 데이터가 함께 영구 삭제되며 되돌릴 수 없어요.")
        }
    }

    private var rowContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                Button(action: onTap) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(alarm.timeString)
                            .font(.title2.weight(.regular))
                            .foregroundStyle(alarm.enabled ? AlarmTalkTheme.text : AlarmTalkTheme.textSecondary)
                        Text(alarm.label)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(alarm.enabled ? AlarmTalkTheme.text : AlarmTalkTheme.textSecondary)
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

                // 오버플로 메뉴는 접근성 대체 경로(Android 길게 누르기 의도와 일치)로 유지.
                Menu {
                    Button("복사", action: onCopy)
                    Divider()
                    Button("삭제", role: .destructive) { confirmingDelete = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }

            if let warningText {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold))
                    Text(warningText)
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(AlarmTalkTheme.error)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AlarmTalkTheme.error.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(12)
    }

    /// 스와이프로 드러나는 삭제 버튼. 탭하면 카드 메뉴와 동일한 확인 알림을 띄운다.
    private var swipeDeleteBackground: some View {
        HStack {
            Spacer(minLength: 0)
            Button {
                confirmingDelete = true
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "trash")
                        .font(.title3)
                    Text("삭제")
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(.white)
                .frame(width: deleteRevealWidth)
                .frame(maxHeight: .infinity)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("알람 삭제"))
        }
        .background(AlarmTalkTheme.error)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
        onTap: {}, onToggleEnabled: { _ in }, onCopy: {}, onDelete: {}
    )
    .padding()
}

#Preview("AlarmRow (dark)") {
    AlarmRow(
        alarm: .previewSample,
        onTap: {}, onToggleEnabled: { _ in }, onCopy: {}, onDelete: {}
    )
    .padding()
    .preferredColorScheme(.dark)
}
#endif
