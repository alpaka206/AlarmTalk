import SwiftUI

/// 웰컴 코드 안내의 **바텀시트 안**.
///
/// ⚠ **알럿형 카드로 되돌리지 말 것**(2026-08-18 지시). 세 가지가 알럿과 맞지 않았다:
///  1. **지나쳐도 되는 안내**다. 알럿은 "지금 답하라" 는 무게인데 이건 닫아도 그만이고,
///     시트는 쓸어내려 닫는 게 표준이라 그 성격이 몸에 익는다.
///  2. **입력 + 실패 사유 + 외부 링크**가 함께 있다. 시스템 알럿에는 오류를 그릴 자리가
///     없어서 예전에는 알럿을 **흉내 낸 자체 카드**를 썼다 — iOS 표준도 아니고 알럿도
///     아닌 중간 형태였다. 실패 자리가 필요한 이유는 이 안내가 **계정당 1회**라, 실패했다고
///     닫히면 고쳐 넣을 기회가 사라지기 때문이다.
///  3. 코드 등록 화면(`CodeRegisterRow`)이 이미 **"오류는 입력창 바로 밑"** 규칙을 쓴다
///     (2026-08-13 지시). 시트는 그 규칙을 그대로 지킬 수 있다.
///
/// ⚠ **액션 배치는 운세 정보 입력 시트와 같다**(2026-08-18 지시). 보조 액션 둘
/// (`닫기`·`코드 받으러 가기`)은 **상단 툴바**에 두고, 주행동(`등록`)만 본문 아래
/// 채움 버튼으로 남긴다 — 셋을 같은 크기로 쌓으면 무엇이 주행동인지 사라진다.
/// 같은 앱 안에서 '입력하고 확인하는 시트' 의 골격이 하나여야 한다.
struct WelcomePromoSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let busy: Bool
    let errorText: String?
    let onSubmitCode: (String) -> Void
    let onOpenInstagram: () -> Void
    let onDismiss: () -> Void

    @State private var code = ""

    private var trimmed: String { InputSanitizer.sanitizeRedeemCode(code) }

    var body: some View {
        // ⚠ **`NavigationStack` + `.presentationDetents([.medium])` 로 되돌리지 말 것**
        // (2026-08-18 되돌림). 그러면 내용이 짧아도 시트가 **화면 절반**을 차지해 아래가
        // 텅 빈다(실기기 확인). 게다가 안드로이드는 `WakerFormSheet` 로 **내용 높이만큼만**
        // 올라와서, 같은 모달이 두 앱에서 다른 물건처럼 보였다.
        //
        // `FormSheet` 이 그 짝이다 — 상단바(좌 액션 · 가운데 제목 · 우 액션)까지 같은
        // 규격이라 여기서 따로 만들 이유가 없었다. 껍데기(폭·모서리·손잡이·스크림)는
        // `BottomSheetHost` 가 그린다.
        FormSheet(
            title: "코드가 있으신가요?",
            // ⚠ 툴바 액션은 **짧아야** 한다 — '코드 받으러 가기' 는 제목을 밀어내 셋이 한
            // 줄에서 다툰다(실기기 확인). 무엇을 받는지는 제목이 이미 말한다.
            saveTitle: "코드 받기",
            // '취소' 가 아니라 '닫기' — 되돌릴 입력이 없고 지나치는 안내다(안드로이드와 같은 말).
            cancelTitle: "닫기",
            saveEnabled: !busy,
            onCancel: onDismiss,
            onSave: onOpenInstagram
        ) {
            VStack(alignment: .leading, spacing: 16) {
                // 강조는 완성된 문장 안에서 찾아 칠한다 — 조각을 이어붙이면 번역이 어색해진다.
                VStack(alignment: .leading, spacing: 2) {
                    highlighted("코드가 없어도 기본 기능은 무료로 쓸 수 있어요.", "무료")
                    highlighted("나중에 더보기의 코드 등록에서 언제든 넣을 수 있어요.", "더보기의 코드 등록")
                }
                // ⚠ **`bodySmall`(12) 로 되돌리지 말 것.** 안드로이드의 같은 문장은
                // `IosAlertType.Message` = **14.5sp** 라 두 앱이 눈에 띄게 달랐고, 시트 안에서
                // 입력창 글자(15)보다 한참 작아 균형도 깨졌다. 알럿의 잔글씨 규격을 시트에
                // 그대로 가져온 것이 원인이다 — 시트는 자리가 넉넉하다.
                .font(.pretendard(.regular, size: 14.5, relativeTo: .subheadline))
                .foregroundStyle(theme.palette.onSurfaceVariant)

                VStack(alignment: .leading, spacing: 6) {
                    TextField("초대·선물·프로모션 코드", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(theme.typography.bodyMedium)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 52)
                        .background(
                            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                                .fill(theme.palette.surfaceVariant.opacity(0.5))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                                .stroke(theme.palette.onSurface.opacity(0.18), lineWidth: 0.5)
                        )
                        .disabled(busy)
                        .onChange(of: code) { _, new in
                            let cleaned = InputSanitizer.sanitizeRedeemCode(new)
                            if cleaned != new { code = cleaned }
                        }

                    // ⚠ **오류는 입력창 바로 밑**이다(`CodeRegisterRow` 와 같은 규칙).
                    if let errorText {
                        Text(errorText)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.error)
                    }
                }

                // 주행동만 채움 버튼으로 남긴다 — 상단바의 둘과 무게를 가른다.
                Button {
                    onSubmitCode(trimmed)
                } label: {
                    Text(busy ? "등록 중…" : "등록")
                        .font(theme.typography.bodyMedium.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 52)
                        // ⚠ 없으면 **글자 모양만** 눌린다 — 좌우 여백이 죽는다.
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.palette.onPrimary)
                .background(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .fill(theme.palette.primary.opacity(busy || trimmed.isEmpty ? 0.4 : 1))
                )
                .disabled(busy || trimmed.isEmpty)
            }
        }
    }

    private func highlighted(_ text: String, _ emphasis: String) -> Text {
        guard let range = text.range(of: emphasis) else { return Text(text) }
        return Text(text[text.startIndex..<range.lowerBound])
            + Text(text[range]).foregroundColor(theme.palette.primary).fontWeight(.semibold)
            + Text(text[range.upperBound...])
    }
}
