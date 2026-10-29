import SwiftUI

// AlarmEditorSheet 의 '날짜 지정(한 번)' — 스펙 `docs/spec/alarm-editor.md` §2-1, 규칙 전문은
// `docs/spec/alarm-lifecycle.md` §4.
extension AlarmEditorSheet {

    /// 날짜 지정 스위치 바인딩. 켜면 `enterDatedMode`(요일 해제·첫 날짜·지금 시간대), 끄면 날짜를 지운다.
    var datedModeBinding: Binding<Bool> {
        Binding(
            get: { draft.isDated },
            set: { on in
                if on { draft.enterDatedMode() } else { draft.leaveDatedMode() }
            }
        )
    }

    /// 날짜 알람의 시간대 — 저장값, 없으면 지금 기기 시간대.
    var datedTimeZone: TimeZone { DatedAlarmTime.timeZone(draft.targetTimezone) }

    /// 날짜 줄의 값 — "10월 27일 (화)". 그 알람의 시간대에서 읽는다.
    var datedDateLabel: String {
        guard let targetDate = draft.targetDate,
              let date = DatedAlarmTime.pickerDate(for: targetDate, in: datedTimeZone) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.timeZone = datedTimeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd EEE")
        return formatter.string(from: date)
    }

    /// 기기 시간대가 알람의 시간대와 다를 때만 붙는 안내(스펙 alarm-lifecycle.md §4-2).
    var datedTimezoneNote: String? {
        guard let targetDate = draft.targetDate else { return nil }
        return DatedAlarmTime.timezoneNote(
            targetDate: targetDate, hour: draft.hour, minute: draft.minute, timeZoneID: draft.targetTimezone
        )
    }

    /// 반복 카드 아래쪽 — 날짜 지정 스위치, 켜져 있으면 날짜 줄과 시간대 안내.
    @ViewBuilder
    var datedAlarmSection: some View {
        DatedAlarmToggle(isOn: datedModeBinding)
            .padding(.bottom, draft.isDated ? 0 : 10)
        if draft.isDated {
            AlarmSettingRow(title: String(localized: "날짜"), subtitle: datedDateLabel) {
                openDatedPicker()
            }
            if let note = datedTimezoneNote {
                Text(note)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 10)
            }
        }
    }

    func openDatedPicker() {
        let zone = datedTimeZone
        datedPickerDate = draft.targetDate.flatMap { DatedAlarmTime.pickerDate(for: $0, in: zone) } ?? Date()
        datedPickerOpen = true
    }

    /// 날짜 고르기 시트의 확정 — 시간대는 **바꾸지 않는다**(사용자가 확인한 저장값, 스펙 alarm-editor.md §2-1).
    func confirmDatedPicker() {
        draft.targetDate = DatedAlarmTime.dateString(for: datedPickerDate, in: datedTimeZone)
        if draft.targetTimezone == nil { draft.targetTimezone = datedTimeZone.identifier }
        datedPickerOpen = false
    }

    /// 날짜 고르기 본문 — 오늘(그 시간대)보다 앞의 날은 고를 수 없다.
    @ViewBuilder
    var datedPickerContent: some View {
        let zone = datedTimeZone
        let today: Date = {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = zone
            return calendar.startOfDay(for: Date())
        }()
        DatePicker(
            String(localized: "날짜"),
            selection: $datedPickerDate,
            in: today...,
            displayedComponents: .date
        )
        .datePickerStyle(.graphical)
        .labelsHidden()
        .environment(\.timeZone, zone)
        .tint(theme.palette.primary)
    }

    /// 저장 전에 막는 날짜 알람의 사유(스펙 alarm-lifecycle.md §4-3). 버튼은 죽이지 않고 누른 순간 알럿으로 말한다.
    /// 나머지 사유보다 앞, **음성을 만들기 전에** 본다 — 저장되지 않을 알람 때문에 직접 입력 한도를 쓰지 않게.
    ///
    /// ⚠ **날짜 알람은 같은 시각 알람을 교체하지 않는다** — 반복 알람의 '교체할까요?' 흐름(`confirmReplaceDuplicate`)을
    /// 타지 않고 여기서 끝낸다. 대상은 기존 '한 시각에 알람 하나' 판정(`conflictingAlarms`)과 같다.
    func datedSaveBlockAlert(nowMillis: Int64) -> ValidationAlertContent? {
        datedSaveBlock(nowMillis: nowMillis)?.alert
    }

    /// 막는 알럿과 **그 사유**(`alarm_save_blocked` 의 `reason` — 안드로이드 `SaveBlockReason` 이름을 소문자로). 누르는 순간의
    /// 판정은 사유도 기록한다(안드로이드 `datedSaveBlockReason` 짝 — 예전 iOS 는 이 두 갈래를 기록하지 않았다).
    func datedSaveBlock(nowMillis: Int64) -> (alert: ValidationAlertContent, reason: String)? {
        guard draft.isDated else { return nil }
        if draft.datedTimeHasPassed(nowMillis: nowMillis) {
            return (ValidationAlertContent(
                title: String(localized: "이미 지난 시각이에요"),
                message: String(localized: "날짜나 시각을 다시 골라 주세요.")
            ), "dated_time_passed")
        }
        let conflicts = store.conflictingAlarms(
            hour: draft.hour,
            minute: draft.minute,
            excludingID: editingAlarm?.id,
            ownerUserId: auth.session?.user.id
        )
        if !conflicts.isEmpty {
            return (ValidationAlertContent(
                title: String(localized: "같은 시각에 다른 알람이 있어요"),
                message: String(localized: "날짜 알람은 다른 알람을 바꾸지 않아요. 다른 시각을 골라 주세요.")
            ), "dated_time_conflict")
        }
        return nil
    }
}
