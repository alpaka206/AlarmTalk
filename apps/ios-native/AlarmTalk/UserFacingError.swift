import Foundation

/// API/네트워크 에러를 사용자에게 보여줄 한국어 메시지로 변환한다.
///
/// AuthViewModel / RemoteAlarmSyncViewModel / SocialFeatureViewModel 에 동일하게
/// 복붙돼 있던 구현을 단일 출처로 통합한 것.
///
/// ⚠ **`localizedDescription` 을 무조건 믿지 말 것.** 스위프트 에러가 `LocalizedError`
/// 없이 `NSError` 로 브리지되면 Foundation 이 **일반 문구를 기기 언어로** 만들어 준다 —
/// 한국어 기기에서는 `"작업을 완료할 수 없습니다.(MyModule.Boom 오류 1.)"` 처럼 나온다.
/// 예전 구현은 "한국어면 보여준다" 였기에 이게 그대로 통과해서, 사용자에게 **맹글링된
/// 내부 타입 이름**을 띄웠다(회귀 테스트를 쓰다 발견). 한국어 여부는 *번역됐는가* 를
/// 알려줄 뿐 *사람이 읽으라고 쓴 문장인가* 를 알려주지 않는다.
///
/// 그래서 판정을 **출처**로 바꾼다 — 아래 두 갈래만 사람이 쓴 문장이 보장된다.
func userFacingErrorMessage(_ error: Error, fallback: String) -> String {
    if let apiError = error as? APIError {
        switch apiError {
        case .invalidResponse:
            return fallback
        case .server(_, let message, _):
            // 서버 메시지는 영어인 갈래가 많다(`voucher-redemption.ts` 등).
            return message.containsKorean ? message : fallback
        }
    }

    // 1) 우리가 직접 문장을 써 넣은 에러.
    if let localized = error as? LocalizedError, let description = localized.errorDescription {
        return description.containsKorean ? description : fallback
    }

    // 2) 누군가 **실제로 문장을 채워 넣은** NSError. URLSession 이 주는
    //    "인터넷 연결이 오프라인 상태입니다." 류는 폴백("불러오지 못했어요")보다
    //    원인을 정확히 짚어 준다.
    //
    //    ⚠ 판정은 `userInfo[NSLocalizedDescriptionKey]` **유무**로 한다. 타입으로
    //    거르면(예: `error is URLError`) 뚫린다 — `URLError(.notConnectedToInternet)`
    //    처럼 코드로 만든 것은 userInfo 가 비어 있어 결국 같은 일반 문구가 나오고,
    //    한국어 기기에서는 그게 한국어라 통과해 버린다. userInfo 검사는 기기 언어와
    //    무관하게 "사람이 쓴 문장인가" 만 본다.
    let nsError = error as NSError

    // ⚠ **취소는 오류가 아니다 — 문구를 만들지 말 것.**
    // 요청이 취소되면 URLSession 이 `NSURLErrorCancelled`(-999) 를 주는데, 여기에도
    // `NSLocalizedDescription` 이 채워져 있어 아래 검사를 그대로 통과한다. 그 값의
    // 한국어가 정확히 **"취소됨"** 이라, 사용자는 자기가 취소한 적도 없는데 알람 목록에
    // "취소됨" 이 떠 있는 걸 보게 된다(2026-08-10 사용자 보고).
    //
    // 취소는 대개 **우리가 스스로 만든다** — 화면이 사라지거나 `.task(id:)` 의 id 가
    // 바뀌면 SwiftUI 가 진행 중이던 task 를 접는다. 사용자에게 알릴 사건이 아니다.
    // 호출부는 이 값을 받으면 아무것도 표시하지 않아야 한다.
    // 여기서는 폴백을 돌려준다(문구를 만들 수는 있어야 하므로). **표시할지 말지는
    // 호출부가 정한다** — 동기화처럼 사용자가 시작하지 않은 작업은 `isCancellation`
    // 으로 걸러 아무것도 띄우지 않는다.
    if isCancellation(error) { return fallback }

    if nsError.userInfo[NSLocalizedDescriptionKey] != nil {
        let message = nsError.localizedDescription
        return message.containsKorean ? message : fallback
    }

    // 그 밖의 에러는 사람이 읽을 문장을 가지고 있다는 보장이 없다.
    return fallback
}



/// 이 오류가 **취소**인가. `Task` 취소와 URLSession 취소를 함께 본다.
///
/// ⚠ 둘 다 봐야 한다. `Task.isCancelled` 를 호출부에서 검사해도, 이미 날아간
/// URLSession 요청은 `NSURLErrorCancelled` 로 돌아오지 취소 예외로 돌아오지 않는다.
func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError { return true }
    let nsError = error as NSError
    return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
}
