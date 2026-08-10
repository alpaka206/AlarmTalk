import Foundation
@preconcurrency import CoreLocation

/// 날씨 깨움말에 채울 "현재 위치" 1회 조회 결과.
/// Android `WeatherLocationProvider.WeatherLocationFix` 와 동일한 의도(나라/도시 채우기)의 iOS 대응.
struct WeatherLocationFix: Equatable {
    let country: String
    let city: String
}

/// 현재 위치를 1회 조회해 역지오코딩으로 나라/도시를 채우는 제공자.
///
/// - Android `com.alarmtalk.app.location.WeatherLocationProvider` 와 동일한 역할이지만,
///   iOS 에서는 권한 요청 → 위치 1회 수신이 모두 비동기 델리게이트 콜백이라
///   `@StateObject` 로 진행 상태(`isBusy`)와 사용자 안내 문구(`statusMessage`)를
///   뷰에 노출하는 `ObservableObject` 로 구현한다.
/// - `NSLocationWhenInUseUsageDescription` 는 Info.plist 에 이미 존재한다.
/// - 권한 거부/제한 시 크래시 없이 안내 문구만 갱신하고 `nil` 을 돌려준다.
/// - 위치/주소 권한·서비스는 OS 가 소유한다. 여기서는 "현재 위치로 지역 칸을 채우는" 것만 하며,
///   그 이상의 위치 추적/백그라운드 사용은 하지 않는다.
@MainActor
final class WeatherLocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var isBusy = false
    @Published var statusMessage: String?

    private var manager: CLLocationManager?
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private var timeoutTask: Task<Void, Never>?
    private let geocoder = CLGeocoder()

    /// 권한 프롬프트를 띄운 채 사용자가 아무 선택 없이 닫으면(특히 `.notDetermined`)
    /// 델리게이트 콜백이 영영 오지 않아 continuation 이 재개되지 않고 isBusy 가 계속
    /// true 로 잠긴다. 안전망으로 이 시간이 지나면 nil 로 1회 재개한다.
    private static let locationTimeoutNanos: UInt64 = 20 * 1_000_000_000

    /// 현재 위치를 1회 조회한 뒤 역지오코딩으로 나라/도시를 채워 돌려준다.
    /// 실패(권한 거부/제한, 위치 서비스 꺼짐, 주소 미확인)면 `statusMessage` 만 갱신하고 `nil`.
    func resolveCurrentLocation() async -> WeatherLocationFix? {
        guard !isBusy else { return nil }
        isBusy = true
        // ⚠ **리터럴을 두 번 적어 비교하지 말 것.** 아래에서 "아직 아무도 사유를 안 채웠다"
        // 를 이 문구와의 일치로 판정하는데, 번역되면 두 리터럴이 서로 다른 언어로 풀려
        // 비교가 영영 false 가 된다(= 실패했는데 '가져오는 중...' 이 남는다).
        // 같은 상수를 양쪽에서 쓴다.
        let progressMessage = String(localized: "현재 위치를 가져오는 중...")
        statusMessage = progressMessage
        defer { isBusy = false }

        guard let location = await requestLocation() else {
            // requestLocation 내부에서 사유별 안내를 이미 채웠다면 그대로 두고,
            // 안내가 비어 있는 경로(예: 좌표 nil)만 일반 실패 문구로 보강한다.
            if statusMessage == nil || statusMessage == progressMessage {
                statusMessage = String(localized: "위치를 가져오지 못했어요. 위치 서비스가 켜져 있는지 확인하거나 직접 입력해 주세요.")
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
        // locationServicesEnabled() 는 메인 스레드에서 호출 시 UI 블록 경고가 떠
        // 백그라운드로 빼서 확인한다. 결과만 메인 액터로 가져온다.
        let servicesEnabled = await Self.locationServicesEnabled()
        guard servicesEnabled else {
            statusMessage = "위치 서비스가 꺼져 있어요. 직접 입력해 주세요."
            return nil
        }

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            let manager = CLLocationManager()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyKilometer
            self.manager = manager

            // 권한 프롬프트를 닫고 응답이 오지 않는 교착을 끊기 위한 타임아웃.
            // finishLocationRequest 가 continuation 을 nil 로 만들어 이중 재개를 막는다.
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: Self.locationTimeoutNanos)
                guard !Task.isCancelled else { return }
                guard let self, self.continuation != nil else { return }
                self.statusMessage = "위치 응답이 없어요. 직접 입력해 주세요."
                self.finishLocationRequest(with: nil)
            }

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

    private static func locationServicesEnabled() async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: CLLocationManager.locationServicesEnabled())
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
        // continuation 을 먼저 nil 로 만들어, 타임아웃/델리게이트 동시 진입 시
        // 이중 resume 을 막는다(모두 MainActor 직렬 실행이라 안전한 1회 보장).
        guard let continuation else { return }
        self.continuation = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        continuation.resume(returning: location)
        manager?.delegate = nil
        manager = nil
    }
}
