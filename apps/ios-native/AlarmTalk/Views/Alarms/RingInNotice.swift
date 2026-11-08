import SwiftUI

/// **알람을 켜면 화면 아래에 "N 후에 울려요." 를 잠깐 띄운다**(2026-11-09, 스펙 `docs/spec/alarm-editor.md` §7).
///
/// 휴대폰 기본 시계 앱처럼, 켠 순간 **그 알람이** 얼마 뒤에 우는지 알려 준다. 띄우는 곳은 둘뿐이다 — 편집기의 저장 성공
/// (`AlarmEditorSheet.finishScheduling` — `runAlarmSaveSteps` 가 `.completed` 일 때만)과 목록 스위치의 켜기(`AlarmsListView` —
/// `AlarmToggleCoalescer` 가 연타를 합친 마지막 값을 반영한 뒤 `RingInNoticePresenter.listToggleSettled`). 끄기·삭제는 띄우지
/// 않고, 떠 있던 **그 알람의** 안내를 거둔다(`withdraw`). 다시 울림은 부르지 않는다.
///
/// 안드로이드 짝은 스펙 §7 대로 스낵바(`PrettySnackbar` — 안내, 액션 없음)로 같은 문장을 띄운다.
///
/// 메인 액터에 둔다 — 헤드라인의 계산(`NextAlarmHeadline.remainingLabel`)이 뷰의 것이라 메인 액터에 묶여 있고, 부르는 곳(표시
/// 객체·편집기·목록)도 모두 메인 액터다.
@MainActor
enum RingInNotice {
    /// 띄울 문장. 띄우지 않을 때는 nil 이다.
    ///
    /// - 문장·계산은 **홈 헤드라인과 같다**(`NextAlarmHeadline.remainingLabel` + "%@ 후에 울려요.") — 남은 시간을 새로 세지
    ///   않는다. 기준은 **이 알람의 예약 시각**이다(전체의 다음 알람이 아니다). 올림이라 1분 미만도 "1분 후에 울려요." 다.
    /// - AlarmKit 권한이 없으면 띄우지 않는다 — iOS 는 그때 예약 자체가 안 돼 정말 안 울린다(헤드라인과 같은 판단).
    /// - 켜지지 않았거나 예약 시각이 이미 지났으면(지난 날짜의 날짜 지정 알람) 띄우지 않는다 — 그 경우의 알럿이 따로 있다.
    static func text(for record: LocalAlarmRecord?, alarmAuthorized: Bool, now: Date) -> String? {
        guard alarmAuthorized, let record, record.enabled else { return nil }
        let remaining = record.nextFireDate.timeIntervalSince(now)
        guard remaining > 0 else { return nil }
        let label: String = NextAlarmHeadline.remainingLabel(seconds: remaining)
        // 헤드라인과 같은 카탈로그 키("%@ 후에 울려요.")다 — 번역도 그 한 줄을 같이 쓴다.
        return String(localized: "\(label) 후에 울려요.")
    }
}

/// 안내를 띄우고 **약 3초 뒤 스스로 걷는다.** 편집기와 목록이 같은 길(`present`)로 부른다.
///
/// - 새 안내가 오면 앞 것을 곧바로 바꾼다(줄 세워 기다리게 하지 않는다) — 알려야 할 것은 방금 켠 알람이다.
/// - 안내는 **알람 하나의 것**이다(`Notice.alarmID`). 그 알람을 끄거나 지우면 그 안내만 거두고, 다른 알람의 안내는 둔다.
/// - **하단 탭이 보일 때만 띄운다**(스펙 §7 — 하단 탭 위). 편집기·설정·이용권으로 옮기면 떠 있던 것을 걷고 버린다
///   (`hostHidden`). 가려진 동안 켠 것은 — 저장하면 편집기가 닫히며 탭이 돌아오는 그 사이도 여기다 — 탭이 다시 보일 때
///   **그때의 행**으로 다시 판정해 띄운다(`hostShown`). 안드로이드도 하단바가 있는 화면에서만 띄우고 같은 규칙으로 기다린다.
/// - 스크린 리더에는 같은 문장을 알린다. 캡슐 자체는 접근성 트리에서 뺀다 — 3초 뒤 사라지는 요소에 초점이 가 있으면
///   사라질 때 초점이 튄다.
@MainActor
final class RingInNoticePresenter: ObservableObject {
    static let shared = RingInNoticePresenter()

    struct Notice: Equatable, Identifiable {
        let id: UUID
        /// 이 안내가 말하는 알람 — 그 알람을 끄거나 지우면 이 안내만 거둔다(`withdraw`).
        let alarmID: String
        let text: String
    }

    @Published private(set) var current: Notice?
    /// 하단 탭이 가려진 동안 켠 알람 — 탭이 다시 보이면 그때의 행으로 다시 판정해 띄운다(`hostShown`).
    private(set) var waitingAlarmID: String?
    /// 하단 탭이 보이는가 — `MainTabsView` 가 하위 화면을 열고 닫을 때마다 알린다(`hostHidden`·`hostShown`).
    private var hostVisible = true

    private var dismissal: Task<Void, Never>?
    private let visibleDuration: @Sendable () async -> Void
    private let announce: @MainActor (String) -> Void

    init(
        visibleDuration: @escaping @Sendable () async -> Void = { try? await Task.sleep(for: .seconds(3)) },
        announce: @escaping @MainActor (String) -> Void = { RingInNoticePresenter.announceToScreenReader($0) }
    ) {
        self.visibleDuration = visibleDuration
        self.announce = announce
    }

    /// 방금 켠 알람의 안내를 띄운다. 띄울 것이 없으면(`RingInNotice.text` 가 nil) 떠 있는 안내도 건드리지 않는다.
    /// 하단 탭이 가려져 있으면 띄우지 않고 기다린다 — 탭이 다시 보일 때 그때의 행으로 띄운다(`hostShown`).
    func present(for record: LocalAlarmRecord?, alarmAuthorized: Bool, now: Date = Date()) {
        guard let record, let text = RingInNotice.text(for: record, alarmAuthorized: alarmAuthorized, now: now) else { return }
        guard hostVisible else {
            waitingAlarmID = record.id
            return
        }
        show(Notice(id: UUID(), alarmID: record.id, text: text))
    }

    /// 편집기 저장 뒤 — **끝까지 성공했을 때만**(예약, 같은 시각 교체면 충돌 정리까지) 방금 저장한 그 알람의 안내를 띄운다.
    /// 예약이 실패했거나 교체 정리가 실패해 롤백했으면 아무것도 띄우지 않는다 — 남지 않은 알람의 남은 시간을 말하게 된다.
    func present(after outcome: AlarmSaveOutcome, for saved: LocalAlarmRecord?, alarmAuthorized: Bool, now: Date = Date()) {
        guard outcome == .completed else { return }
        present(for: saved, alarmAuthorized: alarmAuthorized, now: now)
    }

    /// 목록 스위치의 연타를 다 반영한 뒤(`AlarmToggleCoalescer` 의 `settled`) — `enabled` 는 연타가 끝난 값, `row` 는 반영된
    /// 뒤의 행이다.
    ///
    /// - 행이 꺼졌거나 없어졌으면(끄기 성공·켜기 실패·그 사이 지움) 떠 있던 **그 알람의** 안내를 거둔다.
    /// - 켜져 있고 켬으로 끝났으면 그 알람의 안내를 띄운다 — 이미 켜져 있던 알람을 껐다 도로 켠 것도 한 번 띄운다(스펙 §7).
    /// - 켜져 있는데 끔으로 끝났으면 끄기가 실패한 것이다 — 그 알람은 그대로 우니 떠 있는 안내도 그대로 둔다(안드로이드도
    ///   끄기가 성공했을 때만 거둔다).
    func listToggleSettled(alarmID: String, enabled: Bool, row: LocalAlarmRecord?, alarmAuthorized: Bool, now: Date = Date()) {
        guard let row, row.enabled else {
            withdraw(alarmID: alarmID)
            return
        }
        if enabled { present(for: row, alarmAuthorized: alarmAuthorized, now: now) }
    }

    /// 그 알람을 끄거나 지웠다 — 떠 있던(또는 기다리던) **그 알람의** 안내만 거둔다. 다른 알람의 안내는 둔다.
    /// 남기면 꺼졌거나 없는 알람을 두고 "N 후에 울려요." 라고 말해, 방금 끈 사람이 안 꺼졌나 하고 도로 켠다.
    func withdraw(alarmID: String) {
        if waitingAlarmID == alarmID { waitingAlarmID = nil }
        guard current?.alarmID == alarmID else { return }
        clearCurrent()
    }

    /// 하단 탭이 가려졌다(편집기·설정·이용권으로 옮겼다) — 떠 있던 안내는 걷고 버린다. 하위 화면 위에 남으면 어느 알람의
    /// 것인지 표시가 없어 지금 고치는 알람의 시각처럼 읽힌다. 다시 돌아와도 되살리지 않는다.
    func hostHidden() {
        hostVisible = false
        clearCurrent()
    }

    /// 하단 탭이 다시 보인다 — 가려진 동안 켠 알람이 있으면 **지금의 행·지금의 남은 시간**으로 다시 판정해 띄운다. 그사이
    /// 꺼졌거나 지워졌거나 시각이 지났으면 띄우지 않는다.
    func hostShown(currentRecord: (String) -> LocalAlarmRecord?, alarmAuthorized: Bool, now: Date = Date()) {
        hostVisible = true
        guard let id = waitingAlarmID else { return }
        waitingAlarmID = nil
        present(for: currentRecord(id), alarmAuthorized: alarmAuthorized, now: now)
    }

    /// 탭 화면이 통째로 사라졌다(로그아웃·계정 전환·차단 화면) — 떠 있던 것도 기다리던 것도 버린다. 하단 탭이 보이는지는
    /// 건드리지 않는다 — 그것은 탭 화면이 나타날 때마다 다시 알린다(`hostShown`·`hostHidden`). 여기서 '보인다' 로 되돌리면
    /// 전체 화면 덮개가 편집기 위에서 이걸 불렀을 때 편집기가 떠 있는데도 안내가 뜬다.
    func reset() {
        waitingAlarmID = nil
        clearCurrent()
    }

    private func show(_ notice: Notice) {
        current = notice
        announce(notice.text)
        dismissal?.cancel()
        let wait = visibleDuration
        dismissal = Task { [weak self] in
            await wait()
            guard !Task.isCancelled else { return }
            self?.dismiss(notice.id)
        }
    }

    private func clearCurrent() {
        dismissal?.cancel()
        dismissal = nil
        current = nil
    }

    private func dismiss(_ id: UUID) {
        // 그 사이 새 안내가 왔으면 그것은 자기 시계로 걷힌다.
        guard current?.id == id else { return }
        current = nil
    }

    static func announceToScreenReader(_ text: String) {
        var announcement = AttributedString(text)
        // 편집기에서 저장하면 화면이 바뀌며 스크린 리더가 새 화면을 읽기 시작한다 — 그 소리에 끊기지 않게 높은 우선순위로 낸다.
        announcement.accessibilitySpeechAnnouncementPriority = .high
        AccessibilityNotification.Announcement(announcement).post()
    }
}

/// 하단 탭 위의 캡슐 — `MainTabsView` 가 내비게이션 스택 **밖에** 단다. 편집기에서 저장하면 편집기가 닫히는 동안에도 보이고,
/// 탭을 옮겨도 남는다. 하위 화면(편집기·설정·이용권)으로 옮기면 프레젠터가 걷는다(`hostHidden`) — 그 화면 위에는 뜨지 않는다.
/// **누르는 것을 막지 않는다** — 히트 테스트를 받지 않아 아래의 목록·버튼이 그대로 눌린다.
struct RingInNoticeHost: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject private var presenter = RingInNoticePresenter.shared

    var body: some View {
        ZStack {
            if let notice = presenter.current {
                capsule(notice.text)
                    // 새 안내는 새 캡슐로 올라온다 — 같은 자리에서 글자만 바뀌면 바뀐 줄 모른다.
                    .id(notice.id)
                    .transition(transition)
            }
        }
        // ＋FAB **위**에 가운데로 띄운다(자리 값은 `FloatingChrome` — FAB 와 같은 곳에서 읽는다).
        .frame(maxWidth: .infinity)
        .padding(.horizontal, FloatingChrome.noticeSideInset)
        .padding(.bottom, FloatingChrome.noticeBottomInset)
        // 자리는 하단 탭 위 하나다 — 키보드가 올라와도 따라 올라가 화면 가운데에 뜨지 않는다.
        .ignoresSafeArea(.keyboard)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func capsule(_ text: String) -> some View {
        HStack(spacing: 8) {
            // 안드로이드 스낵바의 '안내' 결(아이콘 + 보조 컨테이너 색)이다. 글리프는 iOS 것을 쓴다
            // (CLAUDE.md 「글리프와 글자 크기 동작은 각 OS 것을 쓴다」 — 맞추는 것은 뜻과 자리다).
            Image(systemName: "info.circle")
                .font(.title3)
            // 이미 번역한 문장이다(`String(localized:)`) — `Text(String)` 은 받은 글자를 그대로 그린다.
            Text(text)
                .font(theme.typography.labelLarge)
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(theme.palette.onSecondaryContainer)
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(theme.palette.secondaryContainer, in: Capsule())
        .floatingChromeShadow()
    }

    /// 진입은 살짝 올라오며 감속하고, 퇴장은 그보다 빠르게 걷힌다(CLAUDE.md 「동작(애니메이션) 원칙」 — 퇴장이 더 빨라야 한다).
    /// 동작 줄이기를 켰으면 움직이지 않고 나타나기만 한다.
    private var transition: AnyTransition {
        let insertion: AnyTransition = reduceMotion ? .opacity : .offset(y: 12).combined(with: .opacity)
        return .asymmetric(
            insertion: insertion.animation(.smooth(duration: 0.28)),
            removal: .opacity.animation(.easeIn(duration: 0.18))
        )
    }
}

// MARK: - 하단 탭 위에 떠 있는 것들의 자리

/// ＋FAB(`MainTabsView`)와 켜면 뜨는 안내(`RingInNoticeHost`)가 **같은 값**을 본다 — 한쪽만 옮기면 안내가 FAB 에 겹친다.
enum FloatingChrome {
    /// 하단바 위로 띄우는 아래 여백 — ＋FAB 의 아래 끝이다.
    static let bottomInset: CGFloat = 92
    /// ＋FAB 의 지름.
    static let fabSize: CGFloat = 56
    /// ＋FAB 의 오른쪽 여백.
    static let fabTrailingInset: CGFloat = 20
    /// 안내의 아래 여백 — ＋FAB **위**(사이 12)다.
    ///
    /// ⚠ **FAB 와 같은 띠에 두지 말 것.** 가운데 정렬을 지키려면 양옆을 FAB 폭만큼 똑같이 비워야 해서 쓸 폭이 반쯤 준다
    /// (402pt 기기 226pt · 375pt 기기 199pt). 글자만 재도(Pretendard Medium 14, 2026-11-09) 영어
    /// "Rings in 9 hours 21 minutes." 가 178pt, 일본어 "9時間21分後に鳴ります。" 가 150pt 다 — 아이콘·여백(약 65pt)을 더하면
    /// 402pt 에서 영어가, 375pt 에서는 일본어도 두 줄로 꺾인다. 안내를 띄우는 두 자리(저장 뒤 목록·목록의 켜기)에는 언제나 FAB 가
    /// 있다 — 떠 있는 사이 다른 탭으로 옮겨도 남은 몇 초는 자리를 옮기지 않는다(뛰지 않게).
    static let noticeBottomInset: CGFloat = bottomInset + fabSize + 12
    /// 안내의 양옆 여백 — 알람 목록의 좌우 여백과 같은 20.
    static let noticeSideInset: CGFloat = 20
}

extension View {
    /// 하단 탭 위에 떠 있는 것의 그림자 — ＋FAB 와 안내는 같은 층(목록 위)에 뜨니 같은 그림자를 쓴다.
    func floatingChromeShadow() -> some View {
        shadow(color: .black.opacity(0.18), radius: 8, y: 4)
    }
}
