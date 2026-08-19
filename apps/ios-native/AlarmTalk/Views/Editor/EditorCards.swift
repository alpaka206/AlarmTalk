import SwiftUI

/// 편집기 섹션 제목 — 카드 **밖** 위쪽. 안드로이드 `EditorSectionTitle`.
struct EditorSectionTitle: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(theme.typography.titleSmall)
            .fontWeight(.bold)
            .foregroundStyle(theme.palette.onSurface)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 편집기 카드 표면 — `WakerCardShape`(22) + surface + outlineVariant 1pt.
///
/// ⚠ **iOS 기본 `Form`/`Section` 으로 돌아가지 말 것.** `Form` 은 iOS 표준 그룹 목록
/// 모양을 강제해(회색 배경 위 흰 그룹, 자체 여백·구분선) 안드로이드의 Waker 카드와
/// 나란히 놓으면 다른 앱이 된다. 편집기는 카드 목록이지 설정 폼이 아니다.
struct EditorCard<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    var horizontalPadding: CGFloat = 16
    var verticalPadding: CGFloat = 4
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            theme.palette.surface,
            in: RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }
}

/// 세부 설정 카드의 한 행 — 제목 + 요약 부제 + (선택) 스위치. 탭하면 상세 pane 으로.
///
/// 안드로이드 `AlarmSettingRow`. **요약이 핵심이다** — 값을 보려고 매번 열어 볼 필요가
/// 없어야 카드 하나로 네 가지 설정이 한눈에 읽힌다.
struct AlarmSettingRow<Trailing: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: String
    let subtitle: String
    var showsChevron: Bool = true
    let onTap: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onTap) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(theme.typography.bodyLarge)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    Text(subtitle)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            trailing()

            if showsChevron {
                Button(action: onTap) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .frame(width: 44, height: 44)
                        // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 12)
        .frame(minHeight: 56)
    }
}

extension AlarmSettingRow where Trailing == EmptyView {
    init(title: String, subtitle: String, showsChevron: Bool = true, onTap: @escaping () -> Void) {
        self.init(title: title, subtitle: subtitle, showsChevron: showsChevron, onTap: onTap, trailing: { EmptyView() })
    }
}

/// 세부 설정 카드 행 사이 구분선. 카드 좌우 패딩 안쪽으로만 긋는다.
struct AlarmSettingDivider: View {
    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        Rectangle()
            .fill(theme.palette.outlineVariant)
            .frame(height: 1)
    }
}

/// 편집기 하단 **고정** 액션 바 — [취소] [저장].
///
/// ⚠ **스크롤에 딸려 보내지 말 것.** 저장 버튼이 본문 맨 아래에 있으면, 설정을 다 만진
/// 뒤 저장하려고 다시 끝까지 스크롤해야 한다. 안드로이드는 상단바를 없애고 취소·저장을
/// 하단에 고정했다(`AlarmEditorScreen.kt:1269-1271` 주석).
///
/// ⚠ **저장 중에는 취소도 함께 잠근다.** 저장만 잠그면 사용자가 X 를 눌러 취소한 줄
/// 아는데 몇 초 뒤 알람이 저장·예약되고 탭이 튄다.
struct EditorActionBar: View {
    @Environment(\.voiceAlarmTheme) private var theme

    // ⚠ **`saveTitle` 만 `String` 이다.** 가족 알람일 때 "저장 · <받는 사람 이름>" 처럼
    // **사용자 데이터가 섞이므로** 키가 될 수 없다 — 번역은 넘기는 쪽(`saveButtonTitle`)이
    // `String(localized:)` 로 끝내 온다. `savingLabel` 은 항상 리터럴이라 키로 받는다.
    let saveTitle: String
    let saving: Bool
    let savingLabel: LocalizedStringKey
    let saveEnabled: Bool
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // ⚠ 프레임을 **label 안에** 준다. `.buttonStyle` 뒤에 붙이면 버튼 자체는
            // 내용 크기로 잡히고 바깥 프레임만 넓어져, 두 버튼이 5:5 로 안 나뉜다.
            Button(action: onCancel) {
                Text("취소")
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, minHeight: 30)
            }
            .font(theme.typography.titleMedium)
            .buttonStyle(.bordered)
            .tint(theme.palette.onSurfaceVariant)
            .frame(maxWidth: .infinity)
            .disabled(saving)

            Button(action: onSave) {
                // ⚠ **큰 글꼴에서 라벨이 잘리지 않게 줄어들게 한다**(`minimumScaleFactor`).
                // 가족 알람 라벨은 "저장 · {이름}" 이라 길고, 접근성 글꼴을 키운 기기에서
                // 그냥 두면 버튼이 두 줄로 번지거나 이름이 통째로 잘린다.
                // 안드로이드도 같은 자리를 줄인다 — `ui/editor/AlarmSnoozeSettings.kt` 의
                // `EditorActionButtons` 가 `fitToWidthScale(..., minimumScale = 0.7f)` 을 쓴다.
                // 그리고 두 앱 모두 **동사를 앞에** 둔다(`editor_save_for` = "저장 · %1$s") —
                // 그래도 잘리는 경우 무슨 버튼인지는 남는다.
                if saving {
                    HStack(spacing: 8) {
                        ProgressView().tint(theme.palette.onPrimary)
                        Text(savingLabel)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity, minHeight: 30)
                } else {
                    // ⚠ 아이콘을 붙이지 않는다 — 안드로이드는 글자만이고, 캘린더 아이콘은
                    // '일정에 추가' 라는 다른 동작을 연상시킨다.
                    Text(saveTitle)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
            }
            // ⚠ **라벨 높이는 30 이다(52·40 아님).** `.bordered*` 스타일이 라벨 **바깥에**
            // 제 패딩을 더하므로 실제로 그려지는 높이는 그보다 약 14 크다 — 실측으로
            // 52 → 66pt, 40 → 54pt 였다. 안드로이드 Material Button 이 **40dp** 라
            // 거기에 맞추려고 30 으로 둔다(≈44pt, iOS 최소 터치 타깃과 같다).
            // (2026-08-10 "버튼 크기는 안드로이드 정도가 젤 적당해 보인다")
            // ⚠ 두 버튼의 값은 **항상 같아야 한다** — 다르면 취소·저장 높이가 어긋난다.
            // ⚠ 바깥에 `.frame(minHeight:)` 를 붙이지 않는다 — 위 주석이 말한 그대로,
            // `.buttonStyle` 뒤 프레임은 **버튼이 아니라 그 바깥 상자**만 키운다.
            // 그래서 취소(52)보다 저장이 낮게 그려졌고, 눌리는 영역도 44pt 를 밑돌았다.
            .font(theme.typography.titleMedium)
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .frame(maxWidth: .infinity)
            .disabled(!saveEnabled || saving)
        }
        .padding(.horizontal, 20)
        // ⚠ **위아래 여백을 다시 늘리지 말 것.** 버튼 자체가 이미 크다 —
        // `.borderedProminent` 가 라벨(minHeight 52) 바깥에 제 패딩을 더해 실제 높이가
        // **66pt** 로 그려진다(실측). 여기에 상단 10 + 하단 8 을 얹고 그 아래로 홈
        // 인디케이터 안전영역(약 34)이 또 붙어서, 버튼 아래만 42pt 가 비었다
        // (2026-08-10 사용자 지적 "위아래 여분이 너무 크다").
        // 안드로이드는 이 영역이 상하 10dp 다 — 하단은 안전영역이 대신하므로 0 으로 둔다.
        .padding(.top, 6)
        .background(theme.palette.background)
    }
}
