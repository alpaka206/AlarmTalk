import SwiftUI

/// 비로그인 사용자를 위한 진입 컨테이너.
///
/// Phase 3-C3 에서 기존의 단순 Apple 버튼 화면이 본격적인 진입 퍼널로 교체됐다.
/// 이제 본 View 는 `NavigationStack` 만 제공하고, 실제 내용은
/// `LandingView` → `LoginView` 흐름이 담당한다.
///
/// 분해 매핑:
/// - 랜딩(브랜드/미리듣기/CTA): `Views/Auth/LandingView.swift`
/// - 로그인/회원가입 폼: `Views/Auth/LoginView.swift`
/// - 권한 게이트: `Views/Permission/LoginPermissionGateView.swift`
struct AuthGateView: View {
    var body: some View {
        NavigationStack {
            LandingView()
        }
    }
}
