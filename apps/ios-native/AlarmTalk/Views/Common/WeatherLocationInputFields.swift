import SwiftUI

struct WeatherLocationInputFields: View {
    @Binding var country: String
    @Binding var city: String

    var submitted: Bool = false
    var helperText: String = "직접 입력하거나 현재 위치로 채울 수 있어요."

    // 현재 위치 조회/역지오코딩 로직은 WeatherLocationProvider 에 분리되어 있다
    // (Android com.alarmtalk.app.location.WeatherLocationProvider 대응).
    @StateObject private var locator = WeatherLocationProvider()

    private var countryValue: String { Self.clean(country) }
    private var cityValue: String { Self.clean(city) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                Text("날씨 문구에 사용할 지역")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.text)
                Text(helperText)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                Button {
                    Task { await fillFromCurrentLocation() }
                } label: {
                    HStack(spacing: 8) {
                        if locator.isBusy {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "location")
                        }
                        Text(locator.isBusy ? "위치 가져오는 중" : "현재 위치 사용")
                            .font(.subheadline.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                }
                .buttonStyle(.bordered)
                .disabled(locator.isBusy)
            }
            .padding(14)
            .background(AlarmTalkTheme.surfaceVariant.opacity(0.62))
            .overlay(
                RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.extraSmall, style: .continuous)
                    .stroke(AlarmTalkTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.extraSmall, style: .continuous))

            if let message = locator.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }

            inputField(
                title: "나라",
                placeholder: "예: 대한민국",
                text: $country,
                showError: submitted && countryValue.isEmpty
            )
            inputField(
                title: "도시",
                placeholder: "예: 서울",
                text: $city,
                showError: submitted && cityValue.isEmpty
            )
        }
    }

    private func fillFromCurrentLocation() async {
        guard let fix = await locator.resolveCurrentLocation() else { return }
        if !fix.country.isEmpty { country = fix.country }
        if !fix.city.isEmpty { city = fix.city }
    }

    private func inputField(
        title: String,
        placeholder: String,
        text: Binding<String>,
        showError: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                if showError {
                    Text("필수")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.error)
                }
            }
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .onChange(of: text.wrappedValue) { _, newValue in
                    let cleaned = InputSanitizer.clampDisplayName(newValue)
                    if cleaned != newValue { text.wrappedValue = cleaned }
                }
                .alarmTalkFieldStyle()
        }
    }

    static func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
