import SwiftUI

/// 「약관 및 개인정보 처리 동의」 — 동의 내역 화면.
///
/// 안드로이드 `ui/settings/ConsentHistoryScreen.kt` 를 그대로 옮긴 것.
/// ⚠ **이 화면이 없으면 음성 생체정보 동의를 철회할 경로가 앱에 하나도 없다.**
/// iOS 에는 통째로 빠져 있었다(설정에 약관·처리방침 웹 링크 두 개뿐).
///
/// 구성:
/// - 필수 동의 4종(약관·개인정보·만14세·국외이전) — 동의 **일자**만 보여주는 읽기 전용.
/// - 선택 동의 2종 — 음성 생체정보(**단방향 철회 액션**) + 마케팅(양방향 토글).
struct ConsentHistoryView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var alarmStore: LocalAlarmStore

    let onOpenTerms: () -> Void
    let onOpenPrivacy: () -> Void

    @State private var records: [String: ConsentRecord] = [:]
    @State private var loadFailed = false
    @State private var reloadTick = 0
    @State private var withdrawConfirmOpen = false
    @State private var withdrawBusy = false
    @State private var marketingBusy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if loadFailed {
                    Button {
                        reloadTick += 1
                    } label: {
                        Text("동의 내역을 불러오지 못했어요. 눌러서 다시 시도해 주세요.")
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                }

                requiredSection
                overseasNotice
                optionalSection
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .homeGradientBackground()
        .navigationTitle("약관 및 개인정보 처리 동의")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: reloadTick) { await load() }
        // iOS 에서는 시스템 알럿이 곧 표준이다 — 안드로이드의 `IosAlertDialog` 은
        // 그 시스템 알럿을 Compose 로 흉내 낸 것이므로, 여기서 커스텀 껍데기를 만들면
        // 오히려 원본에서 멀어진다.
        .alert("철회하면 등록한 목소리가 모두 삭제돼요", isPresented: $withdrawConfirmOpen) {
            Button("취소", role: .cancel) { }
            Button("철회하고 삭제", role: .destructive) {
                Task { await withdraw() }
            }
        } message: {
            Text("지금까지 만든 목소리와 녹음 원본, 생성된 음성 파일, 저장한 알람 문구가 즉시 삭제되고 되돌릴 수 없어요. 이 목소리로 울리던 알람은 가족에게 공유한 알람까지 기본 알람음으로 바뀌어요. 다시 쓰려면 처음부터 새로 녹음해야 해요.")
        }
    }

    // MARK: - 섹션

    private var requiredSection: some View {
        ConsentSectionCard(title: "필수 동의 내용") {
            ConsentRow(label: "서비스 이용약관", record: records["terms"], onOpen: onOpenTerms)
            Divider().overlay(theme.palette.outlineVariant)
            ConsentRow(label: "개인정보 처리방침", record: records["privacy"], onOpen: onOpenPrivacy)
            Divider().overlay(theme.palette.outlineVariant)
            ConsentRow(label: "만 14세 이상 확인", record: records["age14"], onOpen: nil)
            Divider().overlay(theme.palette.outlineVariant)
            // 국외 이전은 서비스 이용에 필수라 철회 액션을 두지 않는다. 철회하면 등록
            // 데이터가 지워지는 데다 다음 실행에 동의 게이트로 앱이 잠긴다 — 30일 유예로
            // 되돌릴 수 있는 회원 탈퇴가 더 안전하고 정직한 경로라 그쪽으로 안내한다.
            ConsentRow(label: "음성 AI 국외 이전 동의", record: records["overseas_transfer"], onOpen: onOpenPrivacy)
        }
    }

    private var overseasNotice: some View {
        Text("국외 이전 동의는 서비스 이용에 반드시 필요해요. 철회하려면 더보기에서 회원 탈퇴를 진행해 주세요.")
            .font(theme.typography.bodySmall)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            .padding(.horizontal, 4)
    }

    private var optionalSection: some View {
        ConsentSectionCard(title: "선택 동의") {
            // 음성 생체정보는 백엔드에서도 '선택'(FEATURE_CONSENT_TYPES)이다. 필수 섹션에
            // 두면 가입 화면의 '[선택]' 표기와 어긋나고, 이 동의를 이용 조건처럼 보이게 한다.
            ConsentRow(
                label: "음성 생체정보 처리 동의",
                record: records["voice_biometric"],
                onOpen: onOpenPrivacy,
                // 재동의는 이 화면이 아니라 목소리를 다시 등록할 때 받는다 — 그래서 토글이
                // 아니라 단방향 '철회' 액션이다(켜지지 않는 스위치는 버그로 보인다).
                onWithdraw: withdrawBusy ? nil : { withdrawConfirmOpen = true }
            )
            Divider().overlay(theme.palette.outlineVariant)
            // 읽기 전용 이력이 아니라 실제로 켜고 끄는 토글 — 설정에 있던 마케팅 카드를
            // 이 법적 정보 화면으로 통합했다(안드로이드와 같은 위치).
            ConsentToggleRow(
                label: "광고성 정보 수신 동의",
                agreed: auth.marketingConsentLoadFailed ? nil : auth.marketingConsentAgreed,
                busy: marketingBusy,
                loadFailed: auth.marketingConsentLoadFailed,
                onRetry: { Task { await auth.loadMarketingConsent() } },
                onChange: { next in
                    Task {
                        marketingBusy = true
                        await auth.updateMarketingConsent(next)
                        marketingBusy = false
                    }
                }
            )
        }
    }

    // MARK: - 데이터

    private func load() async {
        loadFailed = false
        await auth.loadMarketingConsent()
        guard let token = auth.session?.token else { return }
        do {
            let response = try await AlarmTalkAPI.shared.listConsents(token: token)
            records = Dictionary(response.consents.map { ($0.consentType, $0) }) { _, last in last }
        } catch {
            loadFailed = true
        }
    }

    private func withdraw() async {
        withdrawBusy = true
        let ok = await auth.withdrawVoiceBiometricConsent(
            voiceStudio: voiceStudio,
            alarmStore: alarmStore,
            audioCache: nil
        )
        withdrawBusy = false
        // 성공했으면 기록을 다시 읽어 '미동의' 로 바뀐 것을 그 자리에서 보여준다.
        if ok { reloadTick += 1 }
    }
}

// MARK: - 조각

private struct ConsentSectionCard<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(theme.typography.titleSmall)
                .fontWeight(.bold)
                .foregroundStyle(theme.palette.onSurface)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            content()
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            theme.palette.surface,
            in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }
}

private struct ConsentRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let label: String
    let record: ConsentRecord?
    let onOpen: (() -> Void)?
    var onWithdraw: (() -> Void)?

    private var statusText: String {
        guard let record else { return "—" }
        guard record.agreed else { return "미동의" }
        return Self.formatConsentDate(record.agreedAt) ?? "—"
    }

    var body: some View {
        let row = HStack(spacing: 12) {
            Text(label)
                .font(theme.typography.bodyLarge)
                .fontWeight(.semibold)
                .foregroundStyle(theme.palette.onSurface)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(statusText)
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)

            // 철회는 동의한 상태에서만 뜻이 있다.
            if let onWithdraw, record?.agreed == true {
                Button("동의 철회", action: onWithdraw)
                    .font(theme.typography.bodyMedium)
                    .fontWeight(.semibold)
                    .tint(theme.palette.error)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.error)
            }

            if onOpen != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 52)

        if let onOpen {
            Button(action: onOpen) { row }
                .buttonStyle(.plain)
        } else {
            row
        }
    }

    /// "2026-07-06 04:12:33"(UTC) → "26. 07. 06." (KST 보정, 안드로이드와 같은 표기)
    static func formatConsentDate(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let normalized = String(value.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "T").prefix(19))
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: normalized) else { return nil }
        let out = DateFormatter()
        out.dateFormat = "yy. MM. dd."
        out.timeZone = TimeZone(identifier: "Asia/Seoul")
        out.locale = Locale(identifier: "en_US_POSIX")
        return out.string(from: date)
    }
}

/// 동의 이력 행과 같은 레이아웃이되, 우측이 날짜·화살표 대신 스위치다(선택 동의 켜고 끄기).
private struct ConsentToggleRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let label: String
    /// nil = 아직 못 읽음. **false 로 뭉뚱그리지 말 것** — 안 읽힌 값을 '거절' 로 그리면
    /// 동의해 둔 사람에게 꺼진 스위치를 보여주게 된다.
    let agreed: Bool?
    let busy: Bool
    let loadFailed: Bool
    let onRetry: () -> Void
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(theme.typography.bodyLarge)
                .fontWeight(.semibold)
                .foregroundStyle(theme.palette.onSurface)
                .frame(maxWidth: .infinity, alignment: .leading)

            if loadFailed && agreed == nil {
                // 값을 못 읽었으면 'off' 로 오인되지 않게 스위치 대신 다시 시도 행을 보여준다.
                Button("불러오지 못했어요 · 다시 시도", action: onRetry)
                    .font(theme.typography.bodyMedium)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            } else {
                Toggle("", isOn: Binding(get: { agreed == true }, set: onChange))
                    .labelsHidden()
                    .tint(theme.palette.primary)
                    // 로드 전(nil)엔 비활성, 쓰기 중(busy)엔 연속 토글로 인한 opt-out 유실 방지.
                    .disabled(agreed == nil || busy)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 52)
    }
}
