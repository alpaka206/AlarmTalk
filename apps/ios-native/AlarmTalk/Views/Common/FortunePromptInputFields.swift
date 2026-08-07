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

    static let timeChoices: [FortuneBirthTimeChoice] = [
        .init(value: unknownTime, label: "시간 모름"),
        .init(value: "05:00", label: "새벽"),
        .init(value: "09:00", label: "오전"),
        .init(value: "15:00", label: "오후"),
        .init(value: "20:00", label: "저녁")
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

    static func isValidBirthTime(_ value: String) -> Bool {
        let normalized = normalizedBirthTime(value)
        if normalized == unknownTime { return true }
        return normalized.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil
    }

    static func isComplete(gender: String, birthDate: String, birthTime: String) -> Bool {
        !normalizedGender(gender).isEmpty &&
            isValidBirthDate(birthDate) &&
            isValidBirthTime(birthTime)
    }

    static func birthDate(from value: String) -> Date? {
        dateFormatter.date(from: normalizedBirthDate(value))
    }

    static func birthDateString(from date: Date) -> String {
        dateFormatter.string(from: date)
    }

    static func birthDateDisplay(_ value: String) -> String {
        let normalized = normalizedBirthDate(value)
        let digits = String(normalized.filter { $0.isNumber })
        guard digits.count == 8 else { return value }
        let year = digits.prefix(4)
        let month = String(digits.dropFirst(4).prefix(2)).trimmingCharacters(in: CharacterSet(charactersIn: "0"))
        let day = String(digits.dropFirst(6).prefix(2)).trimmingCharacters(in: CharacterSet(charactersIn: "0"))
        return "\(year)년 \(month.isEmpty ? "0" : month)월 \(day.isEmpty ? "0" : day)일"
    }

    static func timeDate(from value: String) -> Date {
        let normalized = normalizedBirthTime(value)
        let parts = normalized.split(separator: ":")
        let hourText = parts.first.map(String.init) ?? ""
        let minuteText = parts.dropFirst().first.map(String.init) ?? ""
        let hour = Int(hourText) ?? 9
        let minute = Int(minuteText) ?? 0
        var components = DateComponents()
        components.year = 2000
        components.month = 1
        components.day = 1
        components.hour = min(max(hour, 0), 23)
        components.minute = min(max(minute, 0), 59)
        return Calendar.current.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }

    static func birthTimeString(from date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 9, parts.minute ?? 0)
    }

    static func birthTimeDisplay(_ value: String) -> String {
        let normalized = normalizedBirthTime(value)
        if normalized == unknownTime { return normalized }
        let parts = normalized.split(separator: ":")
        let hourText = parts.first.map(String.init) ?? ""
        let minuteText = parts.dropFirst().first.map(String.init) ?? ""
        guard let hour = Int(hourText),
              let minute = Int(minuteText) else {
            return value
        }
        let suffix = hour < 12 ? "오전" : "오후"
        let displayHour = hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour)
        return "\(suffix) \(displayHour)시 \(String(format: "%02d", minute))분"
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

    @State private var datePickerOpen = false
    @State private var timePickerOpen = false

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

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
                selectorButton(
                    title: birthDate.isEmpty ? "탭하여 생년월일 선택" : FortunePromptInputFormat.birthDateDisplay(birthDate),
                    placeholder: birthDate.isEmpty,
                    systemImage: "calendar"
                ) {
                    datePickerOpen = true
                }
            }

            fieldSection(
                title: "태어난 시간",
                subtitle: "정확히 모르면 가까운 시간대나 시간 모름을 골라도 돼요.",
                hasError: submitted && !FortunePromptInputFormat.isValidBirthTime(birthTime)
            ) {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(FortunePromptInputFormat.timeChoices) { choice in
                        choiceButton(
                            label: choice.label,
                            selected: FortunePromptInputFormat.normalizedBirthTime(birthTime) == choice.value
                        ) {
                            birthTime = choice.value
                        }
                    }
                }

                selectorButton(
                    title: customTimeTitle,
                    placeholder: birthTime.isEmpty || FortunePromptInputFormat.normalizedBirthTime(birthTime) == FortunePromptInputFormat.unknownTime,
                    systemImage: "clock"
                ) {
                    timePickerOpen = true
                }
            }
        }
        .onAppear(perform: normalizeInitialValues)
        .sheet(isPresented: $datePickerOpen) {
            FortuneBirthDatePickerSheet(
                initialDate: FortunePromptInputFormat.birthDate(from: birthDate),
                onDismiss: { datePickerOpen = false },
                onSelect: { date in
                    birthDate = FortunePromptInputFormat.birthDateString(from: date)
                    datePickerOpen = false
                }
            )
        }
        .sheet(isPresented: $timePickerOpen) {
            FortuneBirthTimePickerSheet(
                initialTime: FortunePromptInputFormat.timeDate(from: birthTime),
                onDismiss: { timePickerOpen = false },
                onSelect: { date in
                    birthTime = FortunePromptInputFormat.birthTimeString(from: date)
                    timePickerOpen = false
                }
            )
        }
    }

    private var customTimeTitle: String {
        let normalized = FortunePromptInputFormat.normalizedBirthTime(birthTime)
        guard !normalized.isEmpty, normalized != FortunePromptInputFormat.unknownTime else {
            return "정확한 시간 선택"
        }
        return FortunePromptInputFormat.birthTimeDisplay(normalized)
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

    private func selectorButton(
        title: String,
        placeholder: Bool,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .foregroundStyle(AlarmTalkTheme.primary)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(placeholder ? AlarmTalkTheme.textSecondary : AlarmTalkTheme.text)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            .frame(minHeight: 44)
            .padding(.horizontal, 12)
            .background(AlarmTalkTheme.surfaceVariant.opacity(0.7))
            .overlay(
                RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small, style: .continuous)
                    .stroke(AlarmTalkTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct FortuneBirthDatePickerSheet: View {
    @State private var selectedDate: Date

    let onDismiss: () -> Void
    let onSelect: (Date) -> Void

    init(initialDate: Date?, onDismiss: @escaping () -> Void, onSelect: @escaping (Date) -> Void) {
        _selectedDate = State(initialValue: initialDate ?? Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date())
        self.onDismiss = onDismiss
        self.onSelect = onSelect
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                DatePicker("생년월일", selection: $selectedDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                Button {
                    onSelect(selectedDate)
                } label: {
                    Label("선택", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                Spacer(minLength: 0)
            }
            .padding(20)
            .background(AlarmTalkTheme.background)
            .navigationTitle("생년월일")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("닫기")
                }
            }
        }
    }
}

private struct FortuneBirthTimePickerSheet: View {
    @State private var selectedTime: Date

    let onDismiss: () -> Void
    let onSelect: (Date) -> Void

    init(initialTime: Date, onDismiss: @escaping () -> Void, onSelect: @escaping (Date) -> Void) {
        _selectedTime = State(initialValue: initialTime)
        self.onDismiss = onDismiss
        self.onSelect = onSelect
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                DatePicker("태어난 시간", selection: $selectedTime, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.wheel)
                    .labelsHidden()
                Button {
                    onSelect(selectedTime)
                } label: {
                    Label("선택", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                Spacer(minLength: 0)
            }
            .padding(20)
            .background(AlarmTalkTheme.background)
            .navigationTitle("태어난 시간")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("닫기")
                }
            }
        }
    }
}
