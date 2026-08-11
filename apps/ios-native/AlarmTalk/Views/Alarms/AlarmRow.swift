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
    /// 둘째 줄에 붙는 '누구 목소리로 울리는지'. 이 앱에서 알람을 구분하는 고유 정보라
    /// 라벨 없는 목록에서 구분자 역할도 겸한다(안드로이드 `AlarmRow(voiceName=)`).
    var voiceName: String?
    /// 다중 선택 모드인가. 켜지면 스위치 자리에 선택 표시가 들어간다.
    var selectionMode: Bool = false
    var selected: Bool = false
    /// 길게 눌러 선택 모드로 들어간다(그 행을 첫 선택으로).
    var onEnterSelection: () -> Void = {}
    var onToggleSelected: () -> Void = {}
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
                // ⚠ **탭은 행 전체가 받는다.** `contentShape` 로 빈 자리까지 히트영역에
                // 넣는다. 토글 스위치는 자식이라 제 탭을 먼저 가져가므로, 스위치를 눌러
                // 알람을 켜고 끄는 것과 충돌하지 않는다.
                .contentShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
                .onTapGesture {
                    guard !deleteRevealed else { return }
                    if selectionMode { onToggleSelected() } else { onTap() }
                }
                // ⚠ **`highPriorityGesture` 로 되돌리지 말 것 — 그러면 탭이 죽는다.**
                // 그건 자식보다 **먼저** 터치를 claim 하는데, `minimumDistance 12` 라
                // 손가락이 안 움직이면 제스처가 실패한다. 그 순간 아래 탭으로 **되돌아가지
                // 않아**, 행의 빈 자리를 눌러도 아무 일이 없었다(2026-08-11 실측: 탭 지점
                // x=226 은 글자 끝 139 와 스위치 313 사이의 확실한 빈 자리인데 무반응).
                // `simultaneousGesture` 면 탭과 드래그가 공존한다 — 12pt 넘게 끌면 스와이프,
                // 안 움직이면 탭. 토글 스위치는 여전히 제 탭을 먼저 가져간다.
                .simultaneousGesture(swipeGesture)
                // 길게 눌러 선택 모드로. 선택 모드에서는 이미 탭이 '고르기' 라 필요 없다.
                .onLongPressGesture {
                    guard !selectionMode else { return }
                    onEnterSelection()
                }
        }
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
    }

    private var timeColor: Color {
        alarm.enabled ? theme.palette.onSurface : theme.palette.onSurfaceVariant
    }

    /// "8월 7일 (금) · 엄마 목소리" — 목소리를 모르면 날짜만.
    private var secondLine: String {
        let date = alarm.nextFireDateLabel()
        guard let voiceName, !voiceName.trimmingCharacters(in: .whitespaces).isEmpty else { return date }
        return "\(date) · \(voiceName) 목소리"
    }

    private var rowContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                // ⚠ **여기에 `Button` 을 다시 두지 말 것.** 예전에는 이 블록을 `Button`
                // 으로 감쌌는데 그 버튼의 실제 폭이 **글자 폭에서 멈춰**(실측 x=38..197,
                // 행은 380 폭) **오른쪽 빈 자리가 죽어 있었다** — 시각 숫자를 정확히
                // 겨냥해야만 열렸다(2026-08-11 지적). 라벨 안팎 어디에
                // `.frame(maxWidth:.infinity)`·`.contentShape` 를 걸어도 넓어지지 않았다.
                // 탭은 **행 전체**가 받는다(아래 `onTapGesture`) — 안드로이드도 카드
                // 전체에 `combinedClickable` 을 건다.
                VStack(alignment: .leading, spacing: 2) {
                        // 시각 앞에 오전/오후를 **작게** 붙이고 12시간제로 쓴다.
                        // 24시간제("19:30")로 되돌리지 말 것 — 안드로이드와 읽는 방식이 갈린다.
                        HStack(alignment: .lastTextBaseline, spacing: 6) {
                            Text(alarm.meridiemLabel)
                                .font(.pretendard(.semibold, size: 16))
                            Text(alarm.clockLabel12h)
                                .font(.pretendard(.regular, size: 32))
                                // 분이 바뀔 때 숫자 폭이 흔들리지 않게(안드로이드 tnum).
                                .monospacedDigit()
                        }
                        .foregroundStyle(timeColor)

                        // 라벨(알람 이름)이 아니라 **다음 울릴 날짜 · 목소리**다.
                        // 기본 시계 앱의 라벨보다 '언제 · 누구 목소리로' 가 실용적이라는 판단.
                        Text(secondLine)
                            .font(.pretendard(.semibold, size: 15))
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                .frame(maxWidth: .infinity, alignment: .leading)
                // 행 전체가 하나의 버튼으로 읽히게 한다(VoiceOver).
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)

                if selectionMode {
                    // 선택 모드에선 켜기/끄기 대신 선택 표시를 **같은 자리**에 둔다 —
                    // 스위치가 남아 있으면 고르려다 알람을 꺼뜨린다.
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24))
                        .foregroundStyle(selected ? theme.palette.primary : theme.palette.outline)
                } else {
                    Toggle(
                        "",
                        isOn: Binding(
                            get: { alarm.enabled },
                            set: { onToggleEnabled($0) }
                        )
                    )
                    .labelsHidden()
                    // ⚠ `.tint` 로 직접 칠하지 말 것 — 그건 트랙만 바꾸고 손잡이는 흰색
                    // 그대로라 옅은 하늘색 트랙 위에서 바래 보인다. 공용 스타일이 트랙·
                    // 손잡이를 **둘 다** 안드로이드와 같은 규칙으로 정한다.
                    .alarmTalkSwitch()
                    .accessibilityLabel(Text(alarm.enabled ? "알람 끄기" : "알람 켜기"))
                }
            }

            if let notice = rowNotice {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: notice.isError ? "exclamationmark.circle" : "info.circle")
                        .font(.system(size: 18))
                    Text(notice.text)
                        .font(.pretendard(.semibold, size: 12))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(
                    notice.isError ? theme.palette.onErrorContainer : theme.palette.onSecondaryContainer
                )
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    (notice.isError ? theme.palette.errorContainer : theme.palette.secondaryContainer)
                        .opacity(0.72),
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

    /// 행 아래에 붙이는 안내. 에러(빨강)와 정보(중립)를 가른다.
    private struct RowNotice {
        let text: String
        let isError: Bool
    }

    /// 안드로이드 `ui/components/ControlsAndPermissions.kt` 의 `alarmRowNotice` 와 같은 판정.
    ///
    /// ⚠ **여기 넣기 전 기준은 "사용자가 할 일이 있는가" 다.** 없으면 넣지 않는다 —
    /// 동기화 실패를 뺀 이유가 그것이다(아래 주석).
    ///
    /// ⚠ 무료 강등 안내가 iOS 에만 없었다. 강등은 `playMode` 를 알람음으로 바꾸면서
    /// `voiceProfileId` 는 남기므로, 행에는 **목소리 이름이 그대로 보이는데 실제로는
    /// 알람음이 울린다** — 왜 목소리가 안 나오는지 알 방법이 없었다.
    private var rowNotice: RowNotice? {
        if alarm.runtimeStateEnum == .failed {
            // 예약 자체가 실패해 **정말 안 울린다.** 다시 저장해 달라고 해야 한다.
            return RowNotice(
                text: "알람을 다시 예약하지 못했어요. 시간을 확인하고 다시 저장해 주세요.",
                isError: true
            )
        }
        // ⚠ **강등 안내를 여기에 되살리지 말 것**(2026-08-11 제거, 안드로이드와 같은 조치).
        // `preLockPlayMode` 는 **영구 마커**라(다시 유료가 되면 복원하려고 남긴다) 이 행에
        // 걸면 무료로 지내는 내내 **알람마다** 경고가 붙는다. 그런데 **알람은 정상 작동
        // 중이다** — 기본 알람음으로 울린다. 고장난 앱처럼 읽힐 뿐이고, 상태는 이용권
        // 화면에서 언제든 확인된다.
        // 이제 `DowngradeNoticeStore` 대기표 → **1회성 모달**이 이 일을 맡는다.
        // ⚠ **동기화 실패(syncFailed)는 행에 띄우지 않는다.** 기준은 안드로이드
        // `ControlsAndPermissions.kt:577-582` 그대로다 — "사용자가 할 일이 있는가.
        // 없으면 넣지 않는다." 서버 저장 실패는 다음 sync 가 알아서 재시도하므로
        // 사용자가 할 일이 없는데, 빨간 경고 톤이라 멀쩡한 알람이 '고장' 으로 읽힌다.
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

/// 선택 모드 상단 바 — 오른쪽에 [취소][삭제] 둘만.
///
/// 안드로이드 `AlarmListScreen.kt:382-407`. 선택 개수는 행마다 체크 표시로 이미 보이므로
/// 숫자를 따로 쓰지 않고, 취소·삭제를 오른쪽에 나란히 둬 엄지 이동을 줄인다
/// (되돌릴 수 없는 삭제가 바깥쪽).
struct AlarmSelectionBar: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let count: Int
    let onCancel: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Spacer(minLength: 0)
            Button("취소", action: onCancel)
                .font(theme.typography.titleMedium)
                .buttonStyle(.plain)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)

            Button("삭제", action: onDelete)
                .font(theme.typography.titleMedium.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(theme.palette.error)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .disabled(count == 0)
        }
        .frame(minHeight: 48)
    }
}

/// 알람 탭이 다중 선택 모드인지 부모(MainTabsView)에 알리는 신호 — ＋FAB 를 숨긴다.
struct AlarmSelectionActiveKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) {
        value = value || nextValue()
    }
}
