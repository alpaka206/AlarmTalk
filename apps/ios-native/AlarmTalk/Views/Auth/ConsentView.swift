import SwiftUI

/// 이 화면이 그릴 수 있는 동의 유형과 **같은 그룹 안에서의** 나열 순서.
///
/// 필수/선택 그룹 자체는 서버가 내려준 `optional` 로 갈린다 — 여기 순서는 그룹 안에서만
/// 쓰인다. 목록에 없는 유형(서버가 새 유형을 먼저 추가한 구간)은 그리지 않고, 그게 필수면
/// 아래 통과 판정이 막는다.
private let consentRowOrder = [
    "age14",
    "terms",
    "privacy",
    "overseas_transfer",
    "voice_biometric",
    "marketing",
]

/// 로그인 후 약관/개인정보 동의를 받는 게이트 화면.
/// 신규 가입자뿐 아니라 기존 가입자도 미동의 시 이 화면을 통과해야 앱을 쓸 수 있다.
///
/// 필수: 만14세 이상 / 이용약관 / 개인정보 처리방침 / 국외 이전
/// 선택: 음성 생체정보(내 목소리 등록) / 광고성 정보 수신(마케팅)
///
/// ⚠ **음성 생체정보를 필수로 만들지 말 것.** 내 목소리를 등록하지 않아도 기본 목소리
/// 알람으로 앱을 온전히 쓸 수 있으므로, 가입 조건으로 강제하면 개인정보보호법 제22조제5항에
/// 걸린다. 그렇다고 등록하려는 순간에만 모달로 띄우면 그때가 가장 거부감이 큰 자리라,
/// 가입 화면에 선택 항목으로 두어 대부분은 한 번에 끝내고 **여기서 거절한 사람만** 목소리
/// 등록 화면에서 인라인으로 다시 만난다(`consentSensitiveMissing`).
///
/// ⚠ **`collect` 에 든 유형만 그린다.** 서버가 유형별 최소 정책 버전으로 계산해 내려주며,
/// 이미 유효한 동의는 목록에 없다 — 개정 때 필요한 것만 다시 묻고, 묻지 않은 항목의 기존
/// 선택(특히 마케팅 수신)은 그대로 유지된다. 6종을 항상 그리면 재동의 화면이 묻지도 않은
/// marketing 을 화면 초기값(false)으로 제출해 **기존 동의를 조용히 철회한다.**
///
/// Android `ConsentScreen.kt` 의 1:1 포팅.
struct ConsentView: View {
    let busy: Bool
    /// 이번에 받아야 하는 유형. 비어 있으면 호출자가 가입 필수로 폴백한 상태다.
    let collect: [String]
    /// `collect` 중 체크 없이 통과하는 유형.
    let optional: [String]
    /// 개정에 따른 재동의인가(이미 동의한 적 있는 계정).
    let isReconsent: Bool
    /// **이미 동의해 둔** 유형 — 초기 체크 상태로 쓴다(서버 `prechecked`).
    var prechecked: [String] = []
    /// 사용자가 실제로 체크한 **선택** 유형만 넘긴다.
    let onAgree: (_ agreedOptional: Set<String>) -> Void
    let onOpenTerms: () -> Void
    let onOpenPrivacy: () -> Void

    @State private var checked: Set<String> = []
    /// `prechecked` 를 한 번만 반영하기 위한 표시. 매 렌더마다 덮으면 사용자가 해제한 것이
    /// 곧바로 되살아나 체크를 끌 수 없다.
    @State private var didApplyPrechecked = false

    /// 구버전 서버(`optional` 없음)와 섞여 돌 수 있다. 비어 있으면 마케팅만 선택으로 본다 —
    /// 그쪽이 안전한 폴백이다(선택을 필수로 잘못 그리면 사용자가 화면을 못 벗어난다).
    private var optionalTypes: Set<String> {
        Set(optional.isEmpty ? ["marketing"] : optional)
    }

    /// 실제로 그릴 항목과 순서. **필수를 먼저 세우고 선택을 뒤로 민다** — 통과 조건이 되는
    /// 항목이 선택 아래로 밀리면 무엇을 체크해야 버튼이 켜지는지 스크롤해야 알 수 있다.
    private var shownTypes: [String] {
        let optionalTypes = optionalTypes
        return consentRowOrder
            .filter { collect.contains($0) }
            .sorted { lhs, rhs in
                // 안정 정렬이 아니므로 그룹이 같으면 원래 순서를 명시적으로 유지한다.
                let l = optionalTypes.contains(lhs), r = optionalTypes.contains(rhs)
                if l != r { return !l }
                let li = consentRowOrder.firstIndex(of: lhs) ?? 0
                let ri = consentRowOrder.firstIndex(of: rhs) ?? 0
                return li < ri
            }
    }

    /// 통과 판정은 **그리는 목록이 아니라 `collect` 원본**으로 한다.
    /// 이 앱이 모르는 필수 유형(서버가 새 유형을 먼저 추가한 구간)은 그려지지 않지만
    /// 여기서 막혀 CTA 가 켜지지 않아야 한다 — 목록을 좁히면 그 방어가 사라진다.
    private var requiredTypes: [String] {
        let optionalTypes = optionalTypes
        return collect.filter { !optionalTypes.contains($0) }
    }

    private var allRequiredChecked: Bool {
        requiredTypes.allSatisfy { type in
            // 모르는 유형은 그리지 못했으므로 통과시키지 않는다 — 통과시키면 사용자가
            // 본 적 없는 동의가 '체크됨' 으로 기록된다.
            consentRowOrder.contains(type) && checked.contains(type)
        }
    }

    /// ⚠ **'전체 동의' 는 필수 유형만 다룬다.**
    /// 선택 동의(마케팅·생체정보)까지 한 탭에 켜면, 명시적으로 거절했던 사람이 필수 재동의
    /// 화면에서 **한 번의 탭으로 마케팅을 켜게 되는 화면**이 된다 — 개인정보보호법 제22조의
    /// 선택 동의 구분 수령 취지에 어긋나는 다크패턴이다.
    /// `setAll` 과 `allChecked` 는 **반드시 같은 집합**을 봐야 한다(한쪽만 바꾸면 전체 동의
    /// 표시가 영영 안 켜지거나, 켜져 있는데 아무것도 안 하는 행이 된다).
    private var masterTypes: [String] {
        let optionalTypes = optionalTypes
        return shownTypes.filter { !optionalTypes.contains($0) }
    }

    private var allChecked: Bool {
        !masterTypes.isEmpty && masterTypes.allSatisfy { checked.contains($0) }
    }

    private func setAll(_ value: Bool) {
        if value {
            checked.formUnion(masterTypes)
        } else {
            checked.subtract(masterTypes)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 24)

            Text(isReconsent ? "약관이 개정되어\n다시 동의가 필요해요" : "서비스 이용을 위해\n약관에 동의해 주세요")
                .font(.title2.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.text)

            // 이미 동의했던 사람에게는 '왜 또 묻는지' 를 먼저 말해 준다.
            // 신규 가입자에게는 제목만으로 충분해 덧붙이지 않는다.
            if isReconsent {
                Spacer().frame(height: 8)
                Text("변경된 내용을 확인하고 동의해 주세요. 이전에 동의하신 항목 중 바뀐 것만 다시 여쭤봐요.")
                    .font(.subheadline)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            } else {
                Spacer().frame(height: 8)
                Text("원활한 서비스 제공을 위해 아래 약관에 대한 동의가 필요해요.")
                    .font(.subheadline)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 24)
                    // 필수가 하나뿐이면 같은 말을 두 번 시키는 것이라 그리지 않는다.
                    // (선택 항목은 마스터가 다루지 않으므로 개수에 넣지 않는다.)
                    if masterTypes.count > 1 {
                        ConsentRow(
                            checked: allChecked,
                            onToggle: { setAll(!allChecked) },
                            label: "필수 약관 전체 동의",
                            emphasized: true
                        )
                        Spacer().frame(height: 4)
                        Divider()
                        Spacer().frame(height: 4)
                    }
                    ForEach(shownTypes, id: \.self) { type in
                        row(for: type)
                    }
                }
            }

            Button {
                // 화면에서 실제로 체크한 '선택' 유형만 넘긴다.
                onAgree(checked.intersection(optionalTypes))
            } label: {
                Text(busy ? "처리 중…" : "동의하고 시작하기")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .disabled(!allRequiredChecked || busy)
            .padding(.vertical, 16)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(AlarmTalkTheme.background)
        .task(id: prechecked) {
            // ⚠ **이미 동의해 둔 것을 초기 체크로 보여준다.** 안 하면 이미 동의한 사용자가
            // 화면을 그냥 지나가는 순간 그 동의가 `false` 로 제출돼 조용히 사라진다.
            // 미리 눌러 주는 게 아니라 **가진 것을 보여주는 것**이다(필수 유형은 서버가
            // prechecked 에 담지 않으므로 여기 들어오지 않는다).
            guard !didApplyPrechecked, !prechecked.isEmpty else { return }
            didApplyPrechecked = true
            checked.formUnion(prechecked)
        }
    }

    @ViewBuilder
    private func row(for type: String) -> some View {
        let isOptional = optionalTypes.contains(type)
        let prefix = isOptional ? "[선택] " : "[필수] "
        let toggle = { toggleChecked(type) }
        switch type {
        case "age14":
            ConsentRow(checked: checked.contains(type), onToggle: toggle, label: prefix + "만 14세 이상입니다")
        case "terms":
            ConsentRow(checked: checked.contains(type), onToggle: toggle, label: prefix + "이용약관 동의", onOpenDetail: onOpenTerms)
        case "privacy":
            ConsentRow(checked: checked.contains(type), onToggle: toggle, label: prefix + "개인정보 처리방침 동의", onOpenDetail: onOpenPrivacy)
        case "voice_biometric":
            ConsentRow(
                checked: checked.contains(type),
                onToggle: toggle,
                label: prefix + "음성 생체정보 처리 동의",
                description: "녹음하거나 업로드한 목소리를 음성 프로필 생성·클론·TTS 생성에 사용하며, 개인을 식별·재현할 수 있는 생체정보로 처리합니다."
            )
        case "overseas_transfer":
            ConsentRow(
                checked: checked.contains(type),
                onToggle: toggle,
                label: prefix + "음성 AI 처리를 위한 국외 이전 동의",
                description: "음성 AI, 번역, 동적 문구 처리를 위해 음성·알람 문구·운세 입력값이 ElevenLabs, Google Vertex 등 국외 처리자에게 전송될 수 있습니다."
            )
        case "marketing":
            ConsentRow(checked: checked.contains(type), onToggle: toggle, label: prefix + "광고성 정보 수신 동의")
        default:
            EmptyView()
        }
    }

    private func toggleChecked(_ type: String) {
        if checked.contains(type) { checked.remove(type) } else { checked.insert(type) }
    }
}

private struct ConsentRow: View {
    let checked: Bool
    let onToggle: () -> Void
    let label: String
    var description: String? = nil
    var emphasized: Bool = false
    var onOpenDetail: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onToggle) {
                HStack(spacing: 8) {
                    Image(systemName: checked ? "checkmark.square.fill" : "square")
                        .font(.title3)
                        .foregroundStyle(checked ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label)
                            .font(emphasized ? .body.weight(.bold) : .body)
                            .foregroundStyle(AlarmTalkTheme.text)
                            .multilineTextAlignment(.leading)
                        if let description {
                            Text(description)
                                .font(.footnote)
                                .foregroundStyle(AlarmTalkTheme.textSecondary)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if let onOpenDetail {
                Button("보기", action: onOpenDetail)
                    .font(.subheadline)
                    .foregroundStyle(AlarmTalkTheme.primary)
            }
        }
        .padding(.vertical, 4)
    }
}

#if DEBUG
private let previewCollect = ["age14", "terms", "privacy", "overseas_transfer", "voice_biometric", "marketing"]
private let previewOptional = ["voice_biometric", "marketing"]

#Preview("Consent — 신규 가입") {
    ConsentView(
        busy: false, collect: previewCollect, optional: previewOptional, isReconsent: false,
        onAgree: { _ in }, onOpenTerms: {}, onOpenPrivacy: {}
    )
    .voiceAlarmPreviewEnvironment()
}

#Preview("Consent — 개정 재동의(마케팅만)") {
    ConsentView(
        busy: false, collect: ["marketing"], optional: ["voice_biometric", "marketing"], isReconsent: true,
        onAgree: { _ in }, onOpenTerms: {}, onOpenPrivacy: {}
    )
    .voiceAlarmPreviewEnvironment()
}

#Preview("Consent (dark)") {
    ConsentView(
        busy: false, collect: previewCollect, optional: previewOptional, isReconsent: false,
        onAgree: { _ in }, onOpenTerms: {}, onOpenPrivacy: {}
    )
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
