import SwiftUI
@preconcurrency import CoreLocation

struct WeatherLocationInputFields: View {
    @Binding var country: String
    @Binding var city: String

    var submitted: Bool = false
    var helperText: String = "직접 입력하거나 현재 위치로 채울 수 있어요."

    @StateObject private var locator = WeatherLocationLookupModel()

    private var countryValue: String { Self.clean(country) }
    private var cityValue: String { Self.clean(city) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                Text("날씨 문구에 사용할 지역")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text(helperText)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
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
            .background(VoiceAlarmTheme.surfaceVariant.opacity(0.62))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(VoiceAlarmTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            if let message = locator.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
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
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                if showError {
                    Text("필수")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.error)
                }
            }
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .onChange(of: text.wrappedValue) { _, newValue in
                    if newValue.count > 30 {
                        text.wrappedValue = String(newValue.prefix(30))
                    }
                }
        }
    }

    static func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct WeatherLocationFix: Equatable {
    let country: String
    let city: String
}

@MainActor
final class WeatherLocationLookupModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var isBusy = false
    @Published var statusMessage: String?

    private var manager: CLLocationManager?
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private let geocoder = CLGeocoder()

    func resolveCurrentLocation() async -> WeatherLocationFix? {
        guard !isBusy else { return nil }
        isBusy = true
        statusMessage = "현재 위치를 가져오는 중..."
        defer { isBusy = false }

        guard let location = await requestLocation() else {
            if statusMessage == nil || statusMessage == "현재 위치를 가져오는 중..." {
                statusMessage = "위치를 가져오지 못했어요. 위치 서비스가 켜져 있는지 확인하거나 직접 입력해 주세요."
            }
            return nil
        }

        do {
            let placemarks = try await geocoder.reverseGeocodeLocation(
                location,
                preferredLocale: Locale(identifier: "ko_KR")
            )
            let placemark = placemarks.first
            let country = placemark?.country?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let city = (placemark?.administrativeArea ?? placemark?.locality ?? placemark?.subLocality ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            statusMessage = country.isEmpty && city.isEmpty
                ? "위치는 가져왔지만 주소 정보를 찾지 못했어요. 직접 입력해 주세요."
                : "현재 위치로 채웠어요."
            return WeatherLocationFix(country: country, city: city)
        } catch {
            statusMessage = "주소 정보를 찾지 못했어요. 직접 입력해 주세요."
            return nil
        }
    }

    private func requestLocation() async -> CLLocation? {
        guard CLLocationManager.locationServicesEnabled() else {
            statusMessage = "위치 서비스가 꺼져 있어요. 직접 입력해 주세요."
            return nil
        }

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            let manager = CLLocationManager()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyKilometer
            self.manager = manager

            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .authorizedAlways, .authorizedWhenInUse:
                manager.requestLocation()
            case .denied, .restricted:
                statusMessage = "위치 권한이 거부됐어요. 직접 입력해 주세요."
                finishLocationRequest(with: nil)
            @unknown default:
                statusMessage = "위치 권한 상태를 확인하지 못했어요. 직접 입력해 주세요."
                finishLocationRequest(with: nil)
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard self.continuation != nil else { return }
            switch status {
            case .authorizedAlways, .authorizedWhenInUse:
                self.manager?.requestLocation()
            case .denied, .restricted:
                self.statusMessage = "위치 권한이 거부됐어요. 직접 입력해 주세요."
                self.finishLocationRequest(with: nil)
            case .notDetermined:
                break
            @unknown default:
                self.finishLocationRequest(with: nil)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let latitude = locations.last?.coordinate.latitude
        let longitude = locations.last?.coordinate.longitude
        Task { @MainActor in
            guard let latitude, let longitude else {
                self.finishLocationRequest(with: nil)
                return
            }
            self.finishLocationRequest(with: CLLocation(latitude: latitude, longitude: longitude))
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError _: Error) {
        Task { @MainActor in
            self.statusMessage = "위치를 가져오지 못했어요. 직접 입력해 주세요."
            self.finishLocationRequest(with: nil)
        }
    }

    private func finishLocationRequest(with location: CLLocation?) {
        continuation?.resume(returning: location)
        continuation = nil
        manager?.delegate = nil
        manager = nil
    }
}
