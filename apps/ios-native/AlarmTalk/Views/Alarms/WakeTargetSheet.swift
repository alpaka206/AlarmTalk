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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("누구를 깨울까요?")
                .font(.title3.weight(.bold))
                .foregroundStyle(theme.palette.onSurface)
                .padding(.bottom, 20)

            Button(action: onSelectSelf) {
                Text("내 알람 맞추기")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurface)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 14)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            ForEach(recipients) { recipient in
                Divider()
                Button {
                    onSelectRecipient(recipient)
                } label: {
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
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
