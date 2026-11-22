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
/// 가입 화면에 선택 항목으로 두어 대부분은 한 번에 끝내고 **여기서 거절한 사람만** 목소리를
/// 등록할 때 동의 시트로 다시 만난다(`consentSensitiveMissing` → `VoiceConsentSheet`).
///
/// ⚠ **`collect` 에 든 유형만 그린다.** 서버가 유형별 최소 정책 버전으로 계산해 내려주며,
/// 이미 유효한 동의는 목록에 없다 — 개정 때 필요한 것만 다시 묻고, 묻지 않은 항목의 기존
/// 선택(특히 마케팅 수신)은 그대로 유지된다. 6종을 항상 그리면 재동의 화면이 묻지도 않은
/// marketing 을 화면 초기값(false)으로 제출해 **기존 동의를 조용히 철회한다.**
///
/// Android `ConsentScreen.kt` 의 1:1 포팅.
struct ConsentView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let busy: Bool
    /// 이번에 받아야 하는 유형. 비어 있으면 호출자가 가입 필수로 폴백한 상태다.
    let collect: [String]
    /// `collect` 중 체크 없이 통과하는 유형.
    let optional: [String]
    /// 개정에 따른 재동의인가(이미 동의한 적 있는 계정).
    let isReconsent: Bool
    /// **이미 동의해 둔** 유형 — 초기 체크 상태로 쓴다(서버 `prechecked`).
    var prechecked: [String] = []
    /// 직전 제출이 실패한 이유 — 버튼 바로 위에 빨간 글자로 그린다(`AuthViewModel.actionErrorMessage`).
    var errorMessage: String? = nil
    /// 사용자가 실제로 체크한 **선택** 유형만 넘긴다.
    let onAgree: (_ agreedOptional: Set<String>) -> Void

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
        // 두 `filter` 가 각자 `consentRowOrder` 순서를 그대로 지킨다.
        let optionalTypes = optionalTypes
        let shown = consentRowOrder.filter { collect.contains($0) }
        return shown.filter { !optionalTypes.contains($0) } + shown.filter { optionalTypes.contains($0) }
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

    /// **'전체 동의' 는 선택까지 포함한다**(2026-08-18 변경. 그전에는 필수 전용이었다).
    ///
    /// 라벨이 `필수 약관 전체 동의` 라 **'전체' 라고 써 놓고 일부만 켜는** 화면이었고,
    /// 눌러도 선택 항목이 남아 사용자가 목록을 다시 훑어야 했다. 법이 정해 주는 부분이
    /// 아니라 **제품 결정**이다 — 전체 동의 버튼이 선택 항목까지 켜는 것을 금지하는 조문은
    /// 없고(`docs/spec/consent.md`), 제22조제5항이 요구하는 것은 **선택을 따로 끌 수 있을 것**
    /// 이다. 그래서 `[필수]`/`[선택]` 표기와 개별 체크박스는 그대로 둔다.
    ///
    /// 이 범위가 「한 번 받은 동의는 다시 묻지 않는다」를 돕는다 — 여기서 생체정보까지 한 번에
    /// 켠 사람은 **첫 목소리 등록에서도 묻지 않는다**(`docs/spec/consent.md`).
    ///
    /// ⚠ `setAll` 과 `allChecked` 는 **반드시 같은 집합**을 봐야 한다(한쪽만 바꾸면 전체 동의
    /// 표시가 영영 안 켜지거나, 켜져 있는데 아무것도 안 하는 행이 된다).
    private var masterTypes: [String] { shownTypes }

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
        // 간격·글자·색은 안드로이드 `ConsentScreen` 그대로다(장면 고정색 `AuthSceneColors` — 배경이 늘 어두운 인증 배경이다).
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 24)

            // ⚠ `\n` 으로 줄을 **강제하지 않는다**(2026-08-18). 두 줄로 못 박으면 글자 크기
            // 설정·기기 폭과 무관하게 항상 두 줄을 차지해 목록이 그만큼 밀린다.
            Text(isReconsent ? String(localized: "약관이 업데이트되었어요") : String(localized: "서비스 이용을 위해\n약관에 동의해 주세요"))
                .font(theme.typography.headlineSmall)
                .fontWeight(.bold)
                .foregroundStyle(AuthSceneColors.text)
                .fixedSize(horizontal: false, vertical: true)

            // 제목 아래 안내는 두지 않는다(2026-11-16 오너) — 신규 가입·재동의 모두 제목 하나다. 예전의 '서비스를 이용하려면
            // 아래 약관에 동의해야 해요.'·'변경된 내용을 확인하고 동의해 주세요…' 는 제목과 아래 목록이 이미 하는 말이었다.
            // 안드로이드 `ConsentScreen` 과 같다.

            // '전체 동의' 는 **스크롤 밖에 고정**한다 — 항목을 펼쳐 읽다가도 한 번에 동의할 수 있어야 한다(안드로이드와 같다).
            // 필수가 하나뿐이면 같은 말을 두 번 시키는 것이라 그리지 않는다.
            if masterTypes.count > 1 {
                Spacer().frame(height: 24)
                ConsentRow(
                    checked: allChecked,
                    onToggle: { setAll(!allChecked) },
                    label: String(localized: "전체 동의"),
                    emphasized: true
                )
                Spacer().frame(height: 4)
                Rectangle()
                    .fill(AuthSceneColors.lineSoft)
                    .frame(height: 1)
            }

            ScrollView {
                // 행 사이는 띄우지 않는다 — 행마다 위아래 4 를 갖고(체크 칸 48 과 합쳐 56), 펼친 설명은 그 행 바로 아래에 붙는다.
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 4)
                    ForEach(shownTypes, id: \.self) { type in
                        row(for: type)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(AuthSceneColors.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
            }
            // 주 버튼은 인증 화면군의 `GradientCta`(하늘색 바탕·남색 글자) — 안드로이드 `ConsentScreen` 도 같은 버튼이다.
            // '확인' 하나다(2026-11-15 오너: "확인으로 통일해") — 목소리 등록 동의 시트와 같다. 동의는 체크가 하고 이 버튼은
            // 그 체크를 낸다(선택 항목은 체크 없이 눌러도 거절로 기록되니 '동의하고…' 는 기록과 어긋났다).
            // ⚠ **그릴 것이 하나도 없으면 눌리지 않아야 한다.** `requiredTypes` 가 비면
            // `allSatisfy` 가 true 라 CTA 가 켜지는데, 그 상태로 누르면 제출 폴백이
            // **본 적 없는 가입 필수 4종을 동의로 기록**한다(안드로이드는 같은 자리에서
            // `shownCount > 0` 을 함께 본다).
            GradientCta(
                title: busy ? "처리 중…" : "확인",
                enabled: !shownTypes.isEmpty && allRequiredChecked && !busy
            ) {
                // 화면에서 실제로 체크한 '선택' 유형만 넘긴다.
                onAgree(checked.intersection(optionalTypes))
            }
            .padding(.vertical, 16)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(AuthBackdrop { Color.clear })
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
        let toggle = { toggleChecked(type) }
        switch type {
        case "age14":
            ConsentRow(checked: checked.contains(type), onToggle: toggle, label: isOptional ? String(localized: "[선택] 만 14세 이상입니다") : String(localized: "[필수] 만 14세 이상입니다"))
        case "terms":
            ConsentRow(checked: checked.contains(type), onToggle: toggle, label: isOptional ? String(localized: "[선택] 이용약관 동의") : String(localized: "[필수] 이용약관 동의"), document: .terms)
        case "privacy":
            ConsentRow(checked: checked.contains(type), onToggle: toggle, label: isOptional ? String(localized: "[선택] 개인정보 처리방침 동의") : String(localized: "[필수] 개인정보 처리방침 동의"), document: .privacy)
        case "voice_biometric":
            ConsentRow(
                checked: checked.contains(type),
                onToggle: toggle,
                label: isOptional ? String(localized: "[선택] 음성 생체정보 처리 동의") : String(localized: "[필수] 음성 생체정보 처리 동의"),
                // ⚠ 안드로이드 `auth_consent_voice_biometric_desc` 와 **같은 세 문장**이다.
                // "안 해도 기본 목소리는 그대로 쓸 수 있다" 는 안심시키는 맥락이 빠지면 선택 동의가 필수처럼 읽힌다.
                // 약관 제7조(권리 보증) 문장은 여기 두지 않는다 — 목소리를 등록할 때 생체정보 동의를 받는 시트에만 있다
                // (`VoiceConsentSheet`, `docs/spec/consent.md`). 마침표마다 줄을 바꿔 문장이 한눈에 끊기게 한다.
                detail: String(localized: "내 목소리를 알람에 쓰고 싶을 때만 필요해요.\n녹음하거나 업로드한 목소리를 음성 프로필 생성·클론·TTS 생성에 쓰고, 개인을 식별·재현할 수 있는 생체정보로 처리해요.\n지금 동의하지 않아도 기본 목소리 알람은 그대로 쓸 수 있고, 나중에 목소리를 등록할 때 다시 여쭤봐요.")
            )
        case "overseas_transfer":
            ConsentRow(
                checked: checked.contains(type),
                onToggle: toggle,
                label: isOptional ? String(localized: "[선택] 음성 AI 처리를 위한 국외 이전 동의") : String(localized: "[필수] 음성 AI 처리를 위한 국외 이전 동의"),
                detail: String(localized: "음성 AI, 번역, 동적 문구 처리를 위해 음성·알람 문구·운세 입력값이 ElevenLabs, Google Vertex 등 국외 처리자에게 전송될 수 있습니다.")
            )
        case "marketing":
            ConsentRow(
                checked: checked.contains(type),
                onToggle: toggle,
                label: isOptional ? String(localized: "[선택] 광고성 정보 수신 동의") : String(localized: "[필수] 광고성 정보 수신 동의"),
                // 무엇을 언제 보내는지·끌 수 있는지를 펼쳐 읽는다 — 안드로이드 `auth_consent_marketing_detail` 과 같은 문장이다.
                detail: String(localized: "새 기능, 이벤트, 혜택 소식을 앱 푸시나 이메일로 보내드려요. 동의하지 않아도 가입과 이용에 아무 제한이 없고, 언제든 더보기에서 끌 수 있어요. 광고는 오전 8시~오후 9시에만 보내고, 직접 맞춘 알람은 광고가 아니라서 설정한 시각에 그대로 울려요.")
            )
        default:
            EmptyView()
        }
    }

    private func toggleChecked(_ type: String) {
        if checked.contains(type) { checked.remove(type) } else { checked.insert(type) }
    }
}

/// 동의 항목 한 줄 — 안드로이드 `ConsentScreen` 의 `ConsentRow` 와 같은 모양이다.
///
/// - 체크 칸 48(상자는 그 가운데) + 이름, 행 위아래 4 — 한 줄이면 높이 56 이다. 이름은 체크 칸 오른쪽(화면 끝에서 72)에서 시작한다.
/// - [detail]·[document] 가 있으면 오른쪽에 펼침 화살표(48 칸)가 붙고, 누르면 **이 행 바로 아래에서** 읽는다.
///   들여쓰기는 체크 칸 폭(48)만큼이라 이름과 같은 선에서 시작한다.
///
/// ⚠ **체크와 펼침은 다른 동작이다**(`docs/spec/consent.md`). 설명·전문은 체크 버튼 **밖**(행 아래)에 그린다 — 안에 두면
/// 읽으려고 누른 것이 곧 동의가 된다. 설명은 기본으로 접혀 있다(제목과 `[선택]` 표기는 접어도 보인다).
private struct ConsentRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let checked: Bool
    let onToggle: () -> Void
    // 호출부에서 필수/선택을 포함한 완성 문장을 현재 언어로 조회한다.
    let label: String
    var emphasized: Bool = false
    /// 접어 둔 설명 — 화살표로 이 행 아래에 편다(국외 이전·생체정보·광고성 정보).
    var detail: String? = nil
    /// 약관·처리방침 전문 — 화살표로 **그 자리에서** 펼친다(2026-11-16 오너 "보기로 바꾸든 아래로 펼치는 걸로 하든 통일해").
    /// 높이 260 안에서 스크롤한다(안드로이드 `ConsentRow` 의 `scrollableDetail`).
    /// ⚠ 번들본을 읽는다 — 동의 기록에 싣는 버전이 이 빌드의 문서다(`BundledLegalDocument` 주석).
    var document: BundledLegalDocument? = nil

    @State private var expanded = false

    /// 화살표가 있는가 — 설명이나 문서 전문이 있을 때.
    private var expandable: Bool { detail != nil || document != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            row
            if expanded {
                if let document {
                    documentBody(document)
                } else if let detail {
                    detailBody(detail)
                }
            }
        }
    }

    private var row: some View {
        HStack(alignment: .center, spacing: 0) {
            Button(action: onToggle) {
                HStack(alignment: .center, spacing: 0) {
                    checkbox
                        .frame(width: 48, height: 48)
                    Text(label)
                        .font(emphasized ? theme.typography.titleMedium : theme.typography.bodyLarge)
                        .fontWeight(emphasized ? .bold : .regular)
                        .foregroundStyle(AuthSceneColors.text)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(checked ? .isSelected : [])

            // ⚠ **펼침은 체크 영역 밖이다.** 안에 두면 설명을 읽으려고 누른 것이 곧 동의가 된다.
            if expandable {
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) { expanded.toggle() }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 15, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                        .foregroundStyle(AuthSceneColors.textMuted)
                        .frame(width: 48, height: 48)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // 안드로이드 `auth_consent_expand`·`auth_consent_collapse` 와 같은 이름이다.
                .accessibilityLabel(Text(expanded ? String(localized: "항목 접기") : String(localized: "항목 펼치기")))
            }
        }
        .padding(.vertical, 4)
    }

    /// 체크 상자 — 고르면 하늘색(`AuthSceneColors.accent`) 바탕에 남색 체크, 비면 흰색 24% 테두리. 안드로이드 `ConsentRow` 의
    /// `Checkbox`(`BrandAccentOnScene`·`TextOnBrandAccent`·`AuthLine`)와 같은 색이다. 글리프는 iOS 것(SF 심볼)이다.
    @ViewBuilder
    private var checkbox: some View {
        if checked {
            Image(systemName: "checkmark.square.fill")
                .font(.system(size: 20, weight: .medium))
                .symbolRenderingMode(.palette)
                .foregroundStyle(AuthSceneColors.onAccent, AuthSceneColors.accent)
        } else {
            Image(systemName: "square")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(AuthSceneColors.line)
        }
    }

    /// 접어 둔 설명 — 행 아래, 이름과 같은 시작선(체크 칸 48)에서. 안드로이드 `ConsentRow` 의 `detail`(시작 48 · 끝 8 · 아래 12).
    private func detailBody(_ text: String) -> some View {
        Text(text)
            .font(theme.typography.bodySmall)
            .foregroundStyle(AuthSceneColors.textMuted)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 48)
            .padding(.trailing, 8)
            .padding(.bottom, 12)
    }

    /// 문서 전문 — 체크 칸 밖, 제목 줄 아래에 둔다. 길어서 **최대 높이 260** 안에서 스크롤하고, 바깥 목록 스크롤과 섞이지 않는다.
    @ViewBuilder
    private func documentBody(_ document: BundledLegalDocument) -> some View {
        ScrollView {
            Group {
                if let markdown = document.markdown() {
                    Text(renderLegalMarkdown(markdown))
                } else {
                    Text("문서를 불러오지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.")
                }
            }
            .font(theme.typography.bodySmall)
            .foregroundStyle(AuthSceneColors.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 260)
        .padding(.leading, 48)
        .padding(.trailing, 8)
        .padding(.bottom, 12)
    }
}

#if DEBUG
private let previewCollect = ["age14", "terms", "privacy", "overseas_transfer", "voice_biometric", "marketing"]
private let previewOptional = ["voice_biometric", "marketing"]

#Preview("Consent — 신규 가입") {
    ConsentView(
        busy: false, collect: previewCollect, optional: previewOptional, isReconsent: false,
        onAgree: { _ in }
    )
    .voiceAlarmPreviewEnvironment()
}

#Preview("Consent — 개정 재동의(마케팅만)") {
    ConsentView(
        busy: false, collect: ["marketing"], optional: ["voice_biometric", "marketing"], isReconsent: true,
        onAgree: { _ in }
    )
    .voiceAlarmPreviewEnvironment()
}

#Preview("Consent (dark)") {
    ConsentView(
        busy: false, collect: previewCollect, optional: previewOptional, isReconsent: false,
        onAgree: { _ in }
    )
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
