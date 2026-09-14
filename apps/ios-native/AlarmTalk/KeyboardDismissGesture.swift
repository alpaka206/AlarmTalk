import UIKit

extension Notification.Name {
    /// **입력창 밖을 눌렀다** — `@FocusState` 로 초점을 잡는 화면은 이걸 받아 상태를 푼다.
    ///
    /// ⚠ UIKit `resignFirstResponder` 만으로는 부족하다(2026-08-27 시뮬레이터 확인).
    /// SwiftUI 는 `@FocusState` 가 여전히 true 면 **곧바로 다시 focus** 해서 키보드가
    /// 내려가지 않는다 — 상태를 가진 뷰가 직접 풀어야 한다.
    static let alarmTalkEndEditing = Notification.Name("AlarmTalkEndEditing")
}

/**
 **입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시, 안드로이드 `clearFocusOnOutsideTap` 과 같은 규칙).

 ⚠ **SwiftUI 의 `simultaneousGesture` 로 만들지 말 것.** 그건 **모든 탭**에 함께 발화해,
 입력칸을 누르는 순간 방금 first responder 가 된 그 칸을 도로 내려놓는다 — 눌러도 키보드가
 뜨지 않는다(안드로이드에서 같은 방식으로 만들었다가 실기기에서 재현했다).

 그래서 창(window)에 탭 인식기를 하나 달고, **터치가 입력 컨트롤 위인지**를 델리게이트에서
 가른다. 입력칸·버튼 위의 터치는 아예 받지 않으므로 그 컨트롤은 그대로 동작하고,
 그 밖의 빈 자리를 누를 때만 편집을 끝낸다. `cancelsTouchesInView = false` 라 이 인식기가
 다른 탭을 삼키지도 않는다.
 */
final class KeyboardDismissGesture: NSObject, UIGestureRecognizerDelegate {
    static let shared = KeyboardDismissGesture()

    private weak var installedWindow: UIWindow?

    /// 창이 준비된 뒤 한 번만 부른다(여러 번 불러도 같은 창에는 다시 달지 않는다).
    @MainActor
    func install() {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow)
            ?? scenes.flatMap(\.windows).first
        else { return }
        guard installedWindow !== window else { return }
        installedWindow = window

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        // ⚠ 다른 탭을 삼키지 않는다 — 버튼·리스트 선택이 그대로 동작해야 한다.
        tap.cancelsTouchesInView = false
        tap.delegate = self
        window.addGestureRecognizer(tap)
    }

    @objc private func handleTap() {
        // 평범한 `TextField`(FocusState 없음)는 이걸로 내려간다.
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
        )
        // `@FocusState` 를 쓰는 화면은 상태를 직접 풀어야 한다(위 주석).
        NotificationCenter.default.post(name: .alarmTalkEndEditing, object: nil)
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldReceive touch: UITouch
    ) -> Bool {
        // 입력 컨트롤(그 안의 자식 포함) 위의 터치는 받지 않는다 — 그래야 칸을 눌러
        // 편집을 시작하거나 이어 갈 수 있다.
        var view: UIView? = touch.view
        while let current = view {
            if current is UITextField || current is UITextView { return false }
            view = current.superview
        }
        return true
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        true
    }
}
