import SwiftUI

/// **폼 모달의 공용 껍데기** — 아래에서 올라오는 시트 + 상단바(취소 / 제목 / 저장).
///
/// ⚠ **가운데 뜨는 카드 + X 로 되돌리지 말 것**(2026-08-11 결정). 그건 안드로이드·웹
/// 문법이다. 아이폰의 폼 모달은 **시트로 올라오고 상단바에 좌 `취소` · 가운데 제목 ·
/// 우 확정(`저장`/`추가`)** 을 둔다 — 애플 캘린더의 '새로운 이벤트', 메일의 '새 메시지'가
/// 그 모양이다(iOS Design Handbook 「Modals — Clarity」).
///
/// 규칙(자료의 Clarity 절 그대로):
/// - **제목을 항상 보여** 이 모달이 무슨 작업인지 알게 한다.
/// - 닫는 버튼은 **`취소`/`저장` 같은 글자**이고, **색으로 누를 수 있음을 표시**한다.
///   (X 아이콘은 iOS 폼 모달의 문법이 아니다.)
/// - 한 모달은 **한 가지 작업**만 한다.
///
/// ⚠ **확정 버튼을 본문 아래에 두지 말 것.** 본문이 길어 스크롤되면 저장 버튼이 화면
/// 밖으로 밀린다 — 상단바는 항상 보인다.
///
/// 껍데기(폭 꽉 참·위 모서리만 둥근 모양·드래그 핸들·스크림)는 `BottomSheetHost` 가 그린다.
struct FormSheet<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: String
    var saveTitle: String = "저장"
    /// 확정 버튼을 누를 수 있는가. **화면마다 규칙이 다르다** — 값이 갖춰져야만 누르게 할
    /// 수도 있고(설정 불가능 시간), 항상 누르게 두고 누른 뒤 어느 칸이 비었는지 알려 줄
    /// 수도 있다(운세 정보). 여기서 하나로 정하지 않는다.
    var saveEnabled: Bool = true
    let onCancel: () -> Void
    let onSave: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            header.measuredSheetHeader()

            ScrollView {
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 20)
                    .measuredSheetContent()
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var header: some View {
        // 제목은 **가운데**, 액션은 양 끝. `HStack` 으로 셋을 나란히 두면 좌우 글자 길이에
        // 따라 제목이 밀려 가운데가 아니게 된다 — 그래서 겹쳐 놓는다.
        ZStack {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.palette.onSurface)
                .lineLimit(1)

            HStack {
                Button("취소", action: onCancel)
                    .font(.system(size: 17))
                Spacer(minLength: 12)
                Button(saveTitle, action: onSave)
                    .font(.system(size: 17, weight: .semibold))
                    .disabled(!saveEnabled)
            }
        }
        // 누를 수 있음을 **색으로** 말한다(자료 「Clarity」).
        .tint(theme.palette.primary)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.palette.outlineVariant.opacity(0.6))
                .frame(height: 0.5)
        }
    }
}

extension View {
    /// 폼 모달을 시트로 띄운다. 자세한 이유는 `FormSheet` 주석 참조.
    ///
    /// ⚠ 상한이 **90%** 다 — 목록 시트(50%)와 다르다. 폼은 칸이 여러 개라 반 화면에
    /// 넣으면 안에서만 스크롤하게 되어 무엇을 채워야 하는지 한눈에 안 들어온다.
    func formSheet<Content: View>(
        isPresented: Binding<Bool>,
        title: String,
        saveTitle: String = "저장",
        saveEnabled: Bool = true,
        onCancel: @escaping () -> Void,
        onSave: @escaping () -> Void,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        fullScreenCover(isPresented: isPresented) {
            BottomSheetHost(onDismiss: onCancel, maxFraction: 0.9) {
                FormSheet(
                    title: title,
                    saveTitle: saveTitle,
                    saveEnabled: saveEnabled,
                    onCancel: onCancel,
                    onSave: onSave,
                    content: content
                )
            }
            .presentationBackground(.clear)
        }
        // ⚠ **커버 자체의 전환을 끈다.** `fullScreenCover` 는 내용을 통째로 아래에서
        // 밀어 올리는데, 스크림이 그 안에 있으니 **스크림까지 같이 밀려 올라온다** —
        // 실기 프레임에서 시트가 다 올라온 **뒤에야** 화면 위쪽이 어두워졌다
        // (2026-08-11 지적, 30fps 영상 f456~463 으로 확인). 배경은 제자리에서 서서히
        // 어두워지고 시트만 올라와야 한다. 전환을 끄면 `BottomSheetHost` 의
        // `appeared` 애니메이션(스크림 opacity + 시트 offset)이 그 일을 한다.
        .transaction { $0.disablesAnimations = true }
    }
}
