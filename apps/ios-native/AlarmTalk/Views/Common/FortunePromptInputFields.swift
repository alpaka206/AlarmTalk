import SwiftUI

struct FortuneBirthTimeChoice: Identifiable, Equatable {
    let value: String
    let label: String

    var id: String { value }
}

enum FortunePromptInputFormat {
    static let male = "남성"
    static let female = "여성"
    static let unknownTime = "시간 모름"

    /// 태어난 시간 선택지 — **사주 시진 경계(한국 표준시 +30분 보정)** 그대로.
    ///
    /// ⚠ 계약의 단일 출처는 `packages/shared/src/schemas/fortune.ts` 의
    /// `FORTUNE_BIRTH_TIME_CHOICES` 다. 안드로이드는
    /// `ui/editor/AlarmFortuneSettings.kt` 의 `FortuneBirthTimeChoices` 로 같은 값을 쓴다 —
    /// **세 곳이 같아야 한다**(회귀 테스트: `FortunePromptInputFormatTests`).
    ///
    /// ⚠ 예전 iOS 는 여기에 대략 시간대 4종(`"05:00"` 새벽 / `"09:00"` 오전 /
    /// `"15:00"` 오후 / `"20:00"` 저녁)을 두고 있었다. 사주는 두 시간짜리 시진 단위로
    /// 보는 것이라, **같은 사람이 두 기기에서 다른 사주를 갖게 된다** — 아이폰에서
    /// "오전"(09:00)을 고른 사람은 안드로이드의 07:31~09:30 과 09:31~11:30 어느 쪽에도
    /// 정확히 대응하지 않는다.
    ///
    /// ⚠ **라벨을 번역하지 말 것.** 이 문자열이 그대로 저장되고 프롬프트로 들어간다.
    /// 안드로이드도 같은 이유로 구간 문자열을 그대로 보여준다.
    static let timeChoices: [FortuneBirthTimeChoice] = [
        .init(value: unknownTime, label: unknownTime),
        .init(value: "00:00~01:30", label: "00:00~01:30"),
        .init(value: "01:31~03:30", label: "01:31~03:30"),
        .init(value: "03:31~05:30", label: "03:31~05:30"),
        .init(value: "05:31~07:30", label: "05:31~07:30"),
        .init(value: "07:31~09:30", label: "07:31~09:30"),
        .init(value: "09:31~11:30", label: "09:31~11:30"),
        .init(value: "11:31~13:30", label: "11:31~13:30"),
        .init(value: "13:31~15:30", label: "13:31~15:30"),
        .init(value: "15:31~17:30", label: "15:31~17:30"),
        .init(value: "17:31~19:30", label: "17:31~19:30"),
        .init(value: "19:31~21:30", label: "19:31~21:30"),
        .init(value: "21:31~23:30", label: "21:31~23:30"),
        .init(value: "23:31~24:00", label: "23:31~24:00")
    ]

    static func normalizedGender(_ value: String) -> String {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "남", "남자", "M", "m", "male", "Male", "MALE", male:
            return male
        case "여", "여자", "F", "f", "female", "Female", "FEMALE", female:
            return female
        default:
            return ""
        }
    }

    static func normalizedBirthDate(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        let digits = String(trimmed.filter { $0.isNumber })
        guard digits.count == 8 else { return trimmed }
        let year = digits.prefix(4)
        let month = digits.dropFirst(4).prefix(2)
        let day = digits.dropFirst(6).prefix(2)
        return "\(year)-\(month)-\(day)"
    }

    static func normalizedBirthTime(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if trimmed == unknownTime || trimmed == "모름" || trimmed == "알 수 없음" {
            return unknownTime
        }
        let digits = String(trimmed.filter { $0.isNumber })
        switch digits.count {
        case 4:
            let hour = digits.prefix(2)
            let minute = digits.dropFirst(2).prefix(2)
            return "\(hour):\(minute)"
        case 3:
            let hour = digits.prefix(1)
            let minute = digits.dropFirst(1).prefix(2)
            return "0\(hour):\(minute)"
        default:
            return trimmed
        }
    }

    static func isValidBirthDate(_ value: String) -> Bool {
        let normalized = normalizedBirthDate(value)
        guard normalized.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
            return false
        }
        let formatter = dateFormatter
        return formatter.date(from: normalized) != nil
    }

    /// ⚠ 판정은 서버(`packages/shared/src/schemas/fortune.ts` 의 `isValidFortuneBirthTime`)와
    /// **같은 규칙**이어야 한다. 여기가 더 빡빡하면 저장 버튼이 안 켜지고, 더 느슨하면
    /// 서버가 400 으로 거절한다 — 그리고 `PATCH /user/me` 는 운세와 날씨를 한 payload 로
    /// 보내므로, 거절되면 **날씨 지역까지 함께 날아간다.**
    ///
    /// 받는 것: 시진 구간(`HH:MM~HH:MM`, 끝값 `24:00` 허용) / 단일 시각(`HH:MM`, 옛 값) /
    /// '시간 모름'.
    static func isValidBirthTime(_ value: String) -> Bool {
        let normalized = normalizedBirthTime(value)
        if normalized == unknownTime { return true }
        let exact = #"^([01]\d|2[0-3]):[0-5]\d$"#
        let range = #"^([01]\d|2[0-3]):[0-5]\d~(([01]\d|2[0-3]):[0-5]\d|24:00)$"#
        return normalized.range(of: exact, options: .regularExpression) != nil
            || normalized.range(of: range, options: .regularExpression) != nil
    }

    static func isComplete(gender: String, birthDate: String, birthTime: String) -> Bool {
        !normalizedGender(gender).isEmpty &&
            isValidBirthDate(birthDate) &&
            isValidBirthTime(birthTime)
    }

    private static var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter
    }
}

struct FortunePromptInputFields: View {
    @Binding var gender: String
    @Binding var birthDate: String
    @Binding var birthTime: String

    var submitted: Bool = false
    var helperText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let helperText {
                Text(helperText)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }

            fieldSection(title: "성별", hasError: submitted && FortunePromptInputFormat.normalizedGender(gender).isEmpty) {
                HStack(spacing: 8) {
                    genderButton("남성", value: FortunePromptInputFormat.male)
                    genderButton("여성", value: FortunePromptInputFormat.female)
                }
            }

            fieldSection(title: "생년월일", hasError: submitted && !FortunePromptInputFormat.isValidBirthDate(birthDate)) {
                // ⚠ **그래픽 달력 시트로 되돌리지 말 것.** 안드로이드는 연·월·일 드롭다운
                // 3개다(`ui/editor/AlarmFortuneSettings.kt`). 달력은 1990년처럼 먼 해로 가려면
                // 여러 번 넘겨야 하고, 무엇보다 같은 입력이 두 앱에서 전혀 다른 화면이었다.
                // ⚠ **연 → 월 → 일 순서로만 고를 수 있다**(2026-08-11 요청, 안드로이드와 같다).
                // 앞을 안 고르면 뒤는 잠긴다 — 일(日) 목록은 연·월이 정해져야 **말일이
                // 결정되고**(2월 28/29), 그 전에는 무엇을 보여줘도 틀린 목록이다.
                HStack(spacing: 8) {
                    dropdown(display: yearText, isPlaceholder: yearValue == nil) {
                        ForEach(Self.selectableYears, id: \.self) { year in
                            Button("\(String(year))년") { setBirth(year: year) }
                        }
                    }
                    dropdown(
                        display: monthText,
                        isPlaceholder: monthValue == nil,
                        enabled: yearValue != nil
                    ) {
                        ForEach(1...12, id: \.self) { month in
                            Button("\(month)월") { setBirth(month: month) }
                        }
                    }
                    dropdown(
                        display: dayText,
                        isPlaceholder: dayValue == nil,
                        enabled: yearValue != nil && monthValue != nil
                    ) {
                        ForEach(1...daysInSelectedMonth, id: \.self) { day in
                            Button("\(day)일") { setBirth(day: day) }
                        }
                    }
                }
            }

            fieldSection(
                title: "태어난 시간",
                hasError: submitted && !FortunePromptInputFormat.isValidBirthTime(birthTime)
            ) {
                // ⚠ **14개를 펼치지 말 것.** 예전에는 시간대 버튼을 2열 그리드로 전부 펼치고
                // 그 아래 '정확한 시간 선택' 휠 시트까지 달아서, 카드가 화면을 꽉 채웠다
                // (2026-08-10 지적). 안드로이드는 드롭다운 **하나**다 — 선택지는 그대로 13종
                // + 시간 모름이고, 접혀 있을 뿐이다.
                dropdown(
                    display: birthTimeText,
                    isPlaceholder: FortunePromptInputFormat.normalizedBirthTime(birthTime).isEmpty
                ) {
                    ForEach(FortunePromptInputFormat.timeChoices) { choice in
                        Button(choice.label) { birthTime = choice.value }
                    }
                }
            }
        }
        .onAppear(perform: normalizeInitialValues)
    }


    // MARK: - 드롭다운 (안드로이드 ExposedDropdownMenuBox 대응)

    /// 고를 수 있는 연도. 안드로이드와 같은 범위(올해부터 120년 전까지, 최신이 위).
    static var selectableYears: [Int] {
        let thisYear = Calendar(identifier: .gregorian).component(.year, from: Date())
        return Array(stride(from: thisYear, through: thisYear - 120, by: -1))
    }

    private var birthParts: (year: Int, month: Int, day: Int)? {
        let v = FortunePromptInputFormat.normalizedBirthDate(birthDate)
        let p = v.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return (p[0], p[1], p[2])
    }

    private var yearValue: Int? { birthParts?.year }
    private var monthValue: Int? { birthParts?.month }
    private var dayValue: Int? { birthParts?.day }

    private var yearText: String { yearValue.map { "\(String($0))년" } ?? "연도" }
    private var monthText: String { monthValue.map { "\($0)월" } ?? "월" }
    private var dayText: String { dayValue.map { "\($0)일" } ?? "일" }

    private var birthTimeText: String {
        let v = FortunePromptInputFormat.normalizedBirthTime(birthTime)
        return v.isEmpty ? "선택" : v
    }

    /// 고른 연·월에 실제로 있는 날 수. ⚠ 윤년을 직접 계산하지 말 것 — `Calendar` 가 안다.
    private var daysInSelectedMonth: Int {
        var comps = DateComponents()
        comps.year = yearValue ?? 2000
        comps.month = monthValue ?? 1
        let cal = Calendar(identifier: .gregorian)
        guard let date = cal.date(from: comps),
              let range = cal.range(of: .day, in: .month, for: date) else { return 31 }
        return range.count
    }

    /// 연·월·일 중 하나만 바꿔 `yyyy-MM-dd` 로 다시 쓴다.
    ///
    /// ⚠ **저장 형식을 바꾸지 말 것.** `packages/shared` 의 `fortune.ts` 가 단일 출처이고
    /// 안드로이드도 같은 문자열을 보낸다 — 컨트롤만 바뀌었지 계약은 그대로다.
    /// ⚠ 달을 바꿔 그 달에 없는 날이 되면(1/31 → 2월) **말일로 당긴다.** 그냥 두면
    /// `2-31` 같은 값이 저장돼 서버에서 거절된다.
    private func setBirth(year: Int? = nil, month: Int? = nil, day: Int? = nil) {
        let cur = birthParts
        let y = year ?? cur?.year ?? Calendar(identifier: .gregorian).component(.year, from: Date())
        let m = month ?? cur?.month ?? 1
        var comps = DateComponents(); comps.year = y; comps.month = m
        let cal = Calendar(identifier: .gregorian)
        let maxDay = cal.date(from: comps).flatMap { cal.range(of: .day, in: .month, for: $0)?.count } ?? 31
        let d = min(day ?? cur?.day ?? 1, maxDay)
        birthDate = String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// 닫힌 상태 껍데기 — 안드로이드 `readOnly OutlinedTextField` + 우측 chevron 과 같다.
    /// 반경은 `theme.shapes.medium`(18 = `WakerInputShape`).
    @ViewBuilder
    private func dropdown<Content: View>(
        display: String,
        isPlaceholder: Bool,
        enabled: Bool = true,
        @ViewBuilder menu: () -> Content
    ) -> some View {
        Menu {
            menu()
        } label: {
            HStack(spacing: 6) {
                Text(display)
                    .lineLimit(1)
                    .foregroundStyle(isPlaceholder ? AlarmTalkTheme.textSecondary : AlarmTalkTheme.text)
                Spacer(minLength: 0)
                // ⚠ **누를 수 있는 자리라는 티를 내야 한다**(2026-08-11 지적 "드롭다운 티가
                // 잘 안 난다"). 흐린 chevron 하나로는 읽히지 않아, 아래위 화살표를 강조색
                // 알약 안에 넣는다 — 애플이 자기 폼에서 쓰는 표시와 같은 문법이다.
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(enabled ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                    .frame(width: 22, height: 22)
                    .background(
                        Circle().fill(
                            (enabled ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                                .opacity(0.14)
                        )
                    )
            }
            .padding(.leading, 12)
            .padding(.trailing, 8)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.button, style: .continuous)
                    .fill(AlarmTalkTheme.surfaceVariant.opacity(0.46))
            )
            .overlay(
                RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.button, style: .continuous)
                    .stroke(AlarmTalkTheme.outline, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .disabled(!enabled)
        // 잠긴 칸은 흐리게 — 왜 안 눌리는지 형태로 말한다.
        .opacity(enabled ? 1 : 0.45)
        // ⚠ **`layoutPriority` 로 폭 비율을 주지 말 것.** 그건 비율이 아니라 '먼저 자리를
        // 가져가는 순서'라, 연도가 거의 다 먹고 **월·일은 글자가 안 보일 만큼 찌그러졌다**
        // (2026-08-10 캡처로 확인). 안드로이드는 weight 1.2 : 1 : 1 인데, 셋을 같은 폭으로
        // 둬도 '연도' 네 글자가 충분히 들어간다 — 단순한 쪽을 택한다.
        .frame(maxWidth: .infinity)
    }

    private func normalizeInitialValues() {
        gender = FortunePromptInputFormat.normalizedGender(gender)
        birthDate = FortunePromptInputFormat.normalizedBirthDate(birthDate)
        birthTime = FortunePromptInputFormat.normalizedBirthTime(birthTime)
    }

    @ViewBuilder
    private func fieldSection<Content: View>(
        title: String,
        subtitle: String? = nil,
        hasError: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                if hasError {
                    Text("필수")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.error)
                }
            }
            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            content()
        }
    }

    private func genderButton(_ label: String, value: String) -> some View {
        choiceButton(label: label, selected: FortunePromptInputFormat.normalizedGender(gender) == value) {
            gender = value
        }
    }

    private func choiceButton(label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(selected ? AlarmTalkTheme.text : AlarmTalkTheme.textSecondary)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(selected ? AlarmTalkTheme.primary.opacity(0.18) : AlarmTalkTheme.surfaceVariant.opacity(0.7))
                .overlay(
                    RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small, style: .continuous)
                        .stroke(selected ? AlarmTalkTheme.primary.opacity(0.55) : AlarmTalkTheme.outline, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
