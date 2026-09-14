import SwiftUI

/// ＋ 를 눌렀을 때 먼저 뜨는 "누구를 깨울까요?" 시트.
///
/// 안드로이드는 알람 탭의 FAB 이 **편집기보다 먼저** 이 시트를 띄운다 — 내 알람인지 상대
/// 알람인지가 그 뒤 화면의 내용을 통째로 바꾸기 때문이다.
///
/// ⚠ **구성원이 없으면 띄우지 않는다.** 선택지가 '내 알람 맞추기' 하나뿐인 시트는
/// 탭을 한 번 더 받을 뿐 아무것도 묻지 않는다 — 호출부가 그때는 곧바로 편집기를 연다.
struct WakeTargetSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let recipients: [FamilyGroupMember]
    let onSelectSelf: () -> Void
    let onSelectRecipient: (FamilyGroupMember) -> Void

    /// 목적지 — 나 또는 구성원.
    private enum Target: Identifiable {
        case myself
        case member(FamilyGroupMember)

        var id: String {
            switch self {
            case .myself: return "__self__"
            case .member(let m): return m.userId
            }
        }
    }

    private var targets: [Target] { [.myself] + recipients.map(Target.member) }

    var body: some View {
        // 껍데기는 다른 선택 시트와 공유한다 — 제목 스타일·행 높이·구분선이 화면마다
        // 다르지 않게(`SelectionSheet` 주석). 여기는 '지금 고른 값' 이 없는 목적지
        // 고르기라 `selectedID` 를 비워 체크마크가 뜨지 않는다.
        SelectionSheet(
            title: "누구를 깨울까요?",
            items: targets,
            selectedID: nil,
            onSelect: { target in
                switch target {
                case .myself: onSelectSelf()
                case .member(let m): onSelectRecipient(m)
                }
            }
        ) { target in
            switch target {
            case .myself:
                Text("내 알람 맞추기")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurface)
            case .member(let recipient):
                VStack(alignment: .leading, spacing: 2) {
                    Text(recipient.name?.nilIfBlank ?? recipient.email ?? "구성원")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(theme.palette.onSurface)
                    // 상대가 알람을 받지 않는 시간대를 **고르기 전에** 보여준다.
                    // 편집기에서야 막히면 시각을 다 정한 뒤에 되돌아와야 한다.
                    let quiet = FamilyAlarmScheduleRules.quietScheduleLabel(recipient)
                    if !quiet.isEmpty {
                        Text("받지 않는 시간: \(quiet)")
                            .font(.footnote)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
