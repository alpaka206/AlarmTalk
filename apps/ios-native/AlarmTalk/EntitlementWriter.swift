import Foundation
import os

/// 권한 스냅샷을 쓰려면 **요청을 시작할 때** 뜨는 표.
///
/// 여기 담긴 두 값이 "누구 것이고 언제 것인가" 의 전부다 — 지금까지 호출부마다
/// `activeUserID` / `refreshGeneration` / `isCurrentSessionToken` / `entitlementOwner` /
/// `persistGeneration` 다섯 가지로 흩어져 있던 것이 이 타입 하나로 접힌다.
///
/// ⚠ **에폭이 토큰인 이유**: iOS 에는 안드로이드의 세션 세대 카운터가 없다. 같은 계정으로
/// 로그아웃→재로그인하면 계정 id 는 그대로이므로 id 만으로는 못 거른다 — 토큰이 바뀌는
/// 것으로 그 창을 닫는다(안드로이드 `AccessTicket.epoch` 의 짝).
struct AccessTicket: Equatable {
    let userID: String
    let token: String
}

/// `EntitlementWriter.write` 의 결과. **`.applied` 가 아니면 아무것도 쓰이지 않았다.**
enum EntitlementWrite {
    /// 반영됐다. 화면 상태(`@Published` 사본)도 이때만 같이 갱신한다.
    case applied
    /// 밀려났다 — 그 사이 로그아웃·계정전환·재로그인이 있었다. 조용히 버린다.
    case superseded
    /// 세션이 없다. 표를 뜰 수조차 없었다.
    case noSession
}

/**
 * **권한 스냅샷에 쓰는 유일한 문**(2026-09-02). 안드로이드 `EntitlementWriter` 의 짝이다.
 *
 * ## 왜 문이 하나여야 하는가
 *
 * 그전에는 스냅샷을 쓰는 곳이 iOS 8곳·안드로이드 9곳이었고, **각자 자기 가드를 손으로**
 * 들고 있었다. PR #709 에서 그 가드를 82줄 붙였는데 국소 가드끼리 어긋나면서 리뷰가
 * 37회·119건까지 갔다. iOS 에서 실제로 일어난 것들:
 *
 * - 토큰 에폭 가드를 넣었더니 **바로 앞에서 토큰을 굴려** 그 가드가 항상 거짓이 됐다.
 * - 세션 CAS 를 넣었는데 스냅샷 쓰기가 **락 밖**이라 창이 그대로 남았다.
 * - 캐시 쓰기 순서표를 공유했더니 배경 경로가 **전경의 화면 상태까지** 버렸다.
 *
 * 전역 불변식이 어디에도 없는 시스템에 국소 불변식을 하나씩 붙이면 이렇게 된다.
 * 그래서 판단을 **여기 한 곳**으로 옮긴다.
 *
 * ## 규칙
 *
 * 1. 네트워크·StoreKit 호출 **전에** `ticket()` 을 뜬다.
 * 2. 응답이 오면 `write(_:_:_:)` 에 그 표와 함께 넘긴다.
 * 3. 결과가 `.applied` 일 때만 화면 상태를 갱신한다.
 *
 * ⚠ **`write` 밖에서 스냅샷을 쓰지 말 것.** `AccessSnapshotStore.patchWithoutOwnershipCheck`
 * 는 소유권 판단이 없다 — `scripts/check-entitlement-writer.py` 가 CI 에서 우회를 막는다.
 */
struct EntitlementWriter {
    private let snapshots = AccessSnapshotStore()

    init() {}

    /// 지금 세션으로 표를 뜬다. 세션이 없으면 nil.
    ///
    /// 근거는 **키체인**이다 — `AuthViewModel.session` 은 화면용 사본이라 배경 경로에서
    /// 비어 있을 수 있고, 실제 쓰기 대조도 키체인이 한다(`runIfCurrentSession`).
    func ticket() -> AccessTicket? {
        guard let session = KeychainStore.readSession(),
              !session.user.id.isEmpty,
              !session.token.isEmpty
        else { return nil }
        return AccessTicket(userID: session.user.id, token: session.token)
    }

    /// 이 표가 가리키는 계정의 스냅샷을 읽는다.
    func read(_ ticket: AccessTicket) -> AccessSnapshot {
        snapshots.read(userID: ticket.userID)
    }

    /**
     * 표가 아직 유효할 때만 [transform] 을 반영한다.
     *
     * 세 가지를 **한 덩어리로** 본다(세션 쓰기와 같은 잠금 안에서):
     * 1. 계정이 표의 계정과 같은가 — 계정 전환이 없었는가
     * 2. 토큰이 표의 토큰과 같은가 — 로그아웃→재로그인이 없었는가
     * 3. 스냅샷 갱신 자체의 직렬화 — 필드끼리 서로를 지우지 않는가
     *
     * 검사와 쓰기가 나뉘면 그 사이가 창이다. 그래서 나누지 않는다.
     */
    @discardableResult
    func write(
        _ ticket: AccessTicket,
        _ reason: String,
        _ transform: (inout AccessSnapshot) -> Void
    ) -> EntitlementWrite {
        let applied = KeychainStore.runIfCurrentSession(userID: ticket.userID, token: ticket.token) {
            snapshots.patchWithoutOwnershipCheck(ticket.userID, transform)
        }
        if applied { return .applied }
        Self.logger.info("Dropping entitlement write (\(reason, privacy: .public)): session changed")
        return .superseded
    }

    /**
     * 세션(토큰·plan)을 갱신하면서 판정 스냅샷까지 **한 잠금 안에서** 함께 쓴다.
     *
     * ⚠ **이 메서드가 따로 있는 이유**: 배경 갱신은 세션 저장과 스냅샷 쓰기를 **둘 다** 해야
     * 하는데, 둘을 따로 하면 그 사이의 재로그인에서 짝이 어긋난다. 그렇다고 세션 저장
     * 콜백 안에서 `write` 를 부르면 **같은 `NSLock` 을 두 번 잡아 데드락**이다
     * (`NSLock` 은 재진입이 아니다). 그래서 조합을 문 안쪽으로 올렸다.
     *
     * **plan 만 갈아 끼운다** — 프로필 전체를 덮으면 그 사이 바꾼 닉네임이 되돌아간다.
     */
    @discardableResult
    func renewSession(
        _ ticket: AccessTicket,
        rolledToken: String?,
        plan: String
    ) -> EntitlementWrite {
        let applied = (try? KeychainStore.saveSessionIfCurrent(
            expectedUserID: ticket.userID,
            expectedToken: ticket.token,
            transform: { current in
                var next = current
                next.user.plan = plan
                if let rolledToken, !rolledToken.isEmpty { next.token = rolledToken }
                return next
            },
            onSaved: { saved in
                snapshots.patchWithoutOwnershipCheck(saved.user.id) { $0.userPlan = plan }
            }
        )) ?? false
        return applied ? .applied : .superseded
    }

    /// 표를 뜨는 것과 반영을 한 번에 — **중단점이 없는** 동기 경로용.
    ///
    /// ⚠ `await` 를 거치는 경로에는 쓰지 말 것. 그 경우 표는 **요청 전에** 떠야 한다.
    @discardableResult
    func writeNow(_ reason: String, _ transform: (inout AccessSnapshot) -> Void) -> EntitlementWrite {
        guard let ticket = ticket() else { return .noSession }
        return write(ticket, reason, transform)
    }

    private static let logger = Logger(subsystem: "com.alarmtalk.app", category: "Entitlement")
}
