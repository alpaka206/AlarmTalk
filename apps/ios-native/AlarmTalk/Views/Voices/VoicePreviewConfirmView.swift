import SwiftUI

/// 등록 직후 **'이 목소리로 저장할까요?'** 확인 스텝.
///
/// 안드로이드 `ui/voices/VoiceProfileManagementPanel.kt` 의 Preview 스텝(`VoiceRegistrationStep`).
///
/// ⚠ **iOS 에는 이 스텝이 통째로 없었다.** 등록이 성공하면 곧바로 목록으로 돌아가,
/// 사용자는 자기 목소리가 어떻게 들리는지 **한 번도 못 들어보고** 이번 달 등록 횟수를
/// 써 버렸다. 서버도 이 흐름을 전제한다 — 클론은 `is_draft=true` 로 만들어지고,
/// 여기서 승격(`PATCH is_draft=false`)해야 정식 프로필이 된다.
///
/// 화면은 위에서부터 제목 · 안내 한 문장 · 문구 카드 · 톤 카드 · (교체면) 교체 한 줄이다(스펙 voice-and-message §4-1,
/// 2026-10-08 사용자). 규칙:
/// 1. **끝까지 들어야 저장이 열린다.** 서버가 준 재생 토큰을 `preview-played` 로
///    돌려줘야 승격이 허용된다 — 안 듣고 저장하는 걸 막는 장치다. 처음 끝까지 들은 재생이면 톤 카드의
///    `원본 듣기`·`현재 톤 듣기` 어느 쪽이든 그때 보낸다.
/// 2. **문구를 고치면 다시 잠긴다.** 서버가 `previewed_at` 을 리셋하므로 새 문구로
///    다시 들어야 한다(고친 문구는 안 들어본 문구다).
/// 3. **'다시 만들기' 는 초안을 지운다.** 정식 프로필이 아니라 draft 라 지워도 이번 달
///    등록 횟수가 차감되지 않는다 — 그래서 마음에 들 때까지 다시 만들 수 있다.
/// 4. **톤(목소리 높이)은 지금 값을 끝까지 들어야 저장이 열린다.** 미리듣기는 이 기기가 메모리에서 굽고, 저장(등록
///    확정)하면 들은 높이가 요청에 한 번 실려 서버가 그 목소리의 알람 소리에 굽는다(스펙 §4-3).
/// 5. **교체는 묻지 않는다.** 이미 등록된 목소리가 있으면 이 화면의 저장은 곧 교체다 — 체크 없이 한 줄로 알리고
///    `replace_existing` 을 보낸다.
struct VoicePreviewConfirmView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager
    /// 교체 확정 직후 **이 기기의** 직접 입력 알람을 곧바로 내리기 위해 든다.
    @EnvironmentObject private var alarmStore: LocalAlarmStore

    let draft: VoiceProfile
    /// 저장(승격) 완료 — 부모가 목록으로 돌린다.
    let onSaved: (String) -> Void
    /// 다시 만들기 — 부모가 등록 폼으로 되돌린다.
    let onDiscarded: () -> Void

    @State private var previewText: String = ""
    @State private var editing = false
    @State private var editDraft = ""
    /// 문구 고치기·등록 확정 요청 중. 톤 카드를 잠근다.
    @State private var saving = false
    /// 등록 확정·초안 삭제 요청 중(서버 쓰기).
    @State private var busy = false
    /// 첫 미리듣기 요청이 끝났는지. 빈 문자열을 로딩과 실패로 구분한다.
    @State private var previewAttempted = false
    /// 서버가 청취(끝까지 들음)를 기록했는가. 문구를 고치면 `false` 로 되돌린다.
    @State private var listened = false
    @State private var errorMessage: String?
    /// 공유 여부는 초안 입력 단계가 아니라 실제로 저장하는 이 단계에서 고른다.
    @State private var isShared = false
    /// 뒤로 나가려 할 때 뜨는 경고. 이 화면을 벗어나면 초안이 삭제된다
    /// (안드로이드 `VoiceProfileManagementPanel.kt` 의 `draftExitWarningOpen`).
    @State private var exitWarningOpen = false

    // MARK: 미리듣기 클립·톤(스펙 voice-and-message §4-3)
    /// 받아 둔 미리듣기 클립(원래 소리) — 두 버튼이 **서버 왕복 없이** 이걸 다시 튼다(현재 톤은 메모리에서 구워서).
    @State private var previewClip: VoiceStudioViewModel.DraftPreviewClip?
    /// 클립 세대 — 클립을 새로 받거나 버리면 오른다. 옛 클립의 재생 끝·청취 확인이 새 클립을 건드리지 않게.
    @State private var clipGeneration = 0
    /// 서버 미리듣기를 받는 중(합성 → 받아서 재기까지).
    @State private var fetching = false
    /// 받는 동안, 받은 뒤에 틀 버튼 — 그 버튼이 진행 표시를 한다. nil 이면 받기만 한다.
    @State private var pendingPlayKind: VoiceTonePreview.Kind?
    /// 처음 끝까지 들은 것을 서버에 알리는 중.
    @State private var confirming = false
    /// 지금 트는(또는 굽는) 버튼.
    @State private var playingKind: VoiceTonePreview.Kind?
    /// 재생 요청 세대 — 누르거나 멈출 때마다 오른다. 늦게 끝난 옛 굽기·재생이 새 재생을 덮지 않게.
    @State private var playGeneration = 0
    /// 지금 막대 값(톤) — 손을 떼면 그 높이로 구워 다시 들려주고, 저장하면 등록 확정 요청에 실린다(서버가 그 목소리로
    /// 만드는 모든 알람 소리에 굽는다).
    @State private var tuning: VoiceTuning = .neutral
    /// 이 클립으로 **끝까지 들은** 높이들 — 저장은 지금 막대 값이 이 안에 있을 때만 열린다(`VoiceTonePreview.canSave`).
    @State private var hearing = VoiceTonePreview.Hearing()
    /// 첫 재생(청취 확인 전)이 소리 나는 동안 막대를 놓았다 — 그 재생이 끝난 직후 새 높이로 다시 튼다.
    @State private var replayAfterPlayback = false
    /// 등록 녹음 측정(원래 목소리 높이). 업로드하는 동안 잰 숫자다(`VoiceStudioViewModel.pendingDraftSourceMeasurement`).
    @State private var sourceMeasurement: VoiceTuningAnalyzer.Measurement?
    /// 현재 톤을 굽는 중인가(`현재 톤 듣기` 가 진행 표시로 바뀐다).
    @State private var renderingTuning = false
    /// 이 화면이 떠났는가 — 떠난 뒤 끝난 준비(받기·재기·굽기)가 소리를 내지 않게.
    @State private var viewGone = false

    // MARK: 잠금표 — 안드로이드 `ui/voices/VoicePreviewConfirmRules.kt` 의 `confirmStepLocks` 와 같은 표다(한쪽만 고치면 같은
    // 순간에 두 폰이 다르게 잠긴다). 판정은 `Self.locks`.

    private var locks: Locks {
        Self.locks(fetching: fetching, confirming: confirming, saving: saving, busy: busy, editing: editing)
    }

    /// 서버 일이 도는 중 — 뒤로·다시 만들기·저장하기·공유 스위치·문구 고치기(연필·재생성)를 잠근다(`Locks.working`).
    private var working: Bool { locks.working }

    /// 톤 카드(막대·두 듣기 버튼)를 잠근다(`Locks.toneEnabled` 의 반대).
    private var toneCardLocked: Bool { !locks.toneEnabled }

    /// 확정 화면의 잠금 — 화면 상태와 떼어 낸 순수 셈이다(회귀 `VoiceTonePreviewTests`).
    struct Locks: Equatable, Sendable {
        /// 서버 일 다섯(받기 — 합성·재기, 청취 확인, 문구 저장, 등록 확정, 초안 삭제) 중 하나라도 도는 중.
        let working: Bool
        /// 막대와 두 듣기 버튼을 쓸 수 있는가.
        let toneEnabled: Bool
    }

    /// - 서버 일 다섯 중 하나라도 돌면 `working` 이다. `saving` 은 문구 저장과 등록 확정 둘 다, `busy` 는 등록 확정·초안
    ///   삭제다.
    /// - 톤 카드는 문구 입력칸이 열린 동안(문구 저장 포함)과 등록 확정·초안 삭제 중에만 잠근다. 고치는 중인 문구는 아직
    ///   소리가 없다 — 옛 문구의 소리를 굽지 않는다(입력칸을 열 때 트는 소리도 멈춘다 — 잠긴 버튼으로는 멈출 수 없다).
    ///   받기·청취 확인으로는 잠그지 않는다 — 받는 중의 진행 표시도 '트는 중' 이라, 그 버튼을 누르면 받기는 그대로 두고 받은
    ///   뒤에 틀지 않으며 다른 버튼을 누르면 받은 뒤에 그것을 튼다(스펙 §4-3 — `press`). 막대 값은 받은 뒤 구울 때 읽는다.
    nonisolated static func locks(fetching: Bool, confirming: Bool, saving: Bool, busy: Bool, editing: Bool) -> Locks {
        Locks(
            working: fetching || confirming || saving || busy,
            toneEnabled: !editing && !saving && !busy
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            WakerTopBar(
                title: "목소리 만들기",
                onBack: { exitWarningOpen = true },
                backEnabled: !working
            )
            .padding(.top, 18)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // 안내는 언제나 제목 바로 아래 한 번만 둔다(2026-10-08 사용자). 예전에 이 자리에 있던 교체 안내
                    // ('저장하면 이전 목소리는 삭제돼요.')는 톤 카드 아래의 교체 한 줄이 맡고, 미리듣기 카드 아래에 있던
                    // 같은 안내는 이리로 옮겼다(두 번 말하지 않는다). 월 등록 한도 경고는 사용자 승인으로 뺐다.
                    VStack(alignment: .leading, spacing: 6) {
                        Text(String(localized: "이 목소리로 저장할까요?"))
                            .font(theme.typography.titleMedium)
                            .fontWeight(.semibold)
                            .foregroundStyle(theme.palette.onSurface)
                        Text(String(localized: "말투를 원하는 대로 바꿔 보세요."))
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }

                    previewCard
                    tuningCard
                    replaceNotice

                    // 이 화면의 오류(재생·청취 확인·문구 저장·등록 실패)는 교체 줄 바로 아래, 공유 설정 위에 오류 색으로
                    // 둔다 — 안드로이드 Preview 스텝도 같은 자리·색이다.
                    if let errorMessage {
                        Text(errorMessage)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.error)
                    }

                    // ⚠ **공유할 수 없는 등급에는 이 칸을 아예 두지 않는다**(2026-09-17 지시).
                    // 개인 이용권은 혼자 쓰는 등급이라 공유가 성립하지 않는다 — 꺼진 스위치와
                    // "커플/가족에서 쓸 수 있어요" 안내를 등록 화면에 깔아 두면, 만들기 흐름
                    // 한복판에서 못 쓰는 기능부터 읽게 된다(같은 이유로 목소리 탭도 등급이
                    // 되는 사람에게만 공유 행을 보여 준다 — `VoiceProfileManagementPanel`).
                    if canShareVoice {
                        sharingSection
                    }
                    Spacer(minLength: 4)
                }
                .padding(.horizontal, 20)
            }
            actions
        }
        .homeGradientBackground()
        .task {
            // `.task` 가 `.onAppear` 보다 먼저 돌 수 있다 — 다시 나타난 화면이 '떠났다' 로 읽혀 아무것도 틀지 않게.
            viewGone = false
            isShared = draft.isShared == true && canShareVoice
            startSourceMeasurement()
            // 문구는 합성 응답이 알려 준다(서버가 그때 확정한다) — 여기선 비워 두고 첫 클립이 채운다. 들어보라고 만든
            // 화면이니 들어오자마자 **현재 톤(추천값)** 으로 한 번 들려준다(스펙 §4-3). 다시 나타났으면 받아 둔 클립을
            // 다시 튼다(서버 왕복 없음).
            if previewClip != nil {
                startPreview(.current)
            } else {
                await fetchPreview(thenPlay: .current)
            }
        }
        // 화면을 떠나면 미리듣기를 끈다 — 끝까지 듣지 않은 재생은 청취로 기록되지 않는다.
        .onAppear { viewGone = false }
        .onDisappear {
            viewGone = true
            pendingPlayKind = nil
            replayAfterPlayback = false
            stopPreview()
        }
        .alert(String(localized: "나가면 임시 목소리가 삭제돼요"), isPresented: $exitWarningOpen) {
            Button(String(localized: "나가고 삭제"), role: .destructive) {
                Task { await discard() }
            }
            Button(String(localized: "계속 만들기"), role: .cancel) {}
        } message: {
            Text(String(localized: "지금 나가면 만들고 있던 목소리(초안)가 삭제되고, 처음부터 다시 만들어야 해요."))
        }
    }

    private var sharingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(String(localized: "공유 설정"))
                .font(theme.typography.titleSmall)
                .fontWeight(.semibold)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(String(localized: "가족·연인에게 공유 허용"))
                        .font(theme.typography.bodyMedium)
                        .fontWeight(.semibold)
                    Text(String(localized: "등록한 목소리를 가족·연인도 함께 사용할 수 있어요."))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer(minLength: 0)
                Toggle("", isOn: $isShared)
                    .labelsHidden()
                    .alarmTalkSwitch()
            }
            .disabled(working)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(theme.palette.surfaceVariant.opacity(0.42))
            .outlinedButtonShape()
        }
    }

    private var canShareVoice: Bool {
        canShareVoiceWithOthers(
            subscriptionResponse: socialFeatures.subscription,
            familyGroup: socialFeatures.familyGroup,
            authSession: auth.session,
            storeTier: subscriptions.currentTier
        )
    }

    // MARK: - 문구 카드

    /// 문구와 고치기(연필)뿐이다 — 재생 버튼은 톤 카드의 `원본 듣기`·`현재 톤 듣기` 로 옮겼다(스펙 §4-1).
    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if editing {
                TextEditor(text: $editDraft)
                    .frame(minHeight: 72)
                    .font(theme.typography.bodyMedium)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(theme.palette.surface.opacity(0.74))
                    .outlinedButtonShape()
                    .onChange(of: editDraft) { _, new in
                        // ⚠ **이 글자는 TTS 가 읽는다** — 제어문자·제로폭이 그대로 들어가면
                        // 낭독이 망가진다. 줄바꿈은 지우지 않고 공백으로 바꾼다(안드로이드
                        // `ui/voices/VoiceProfileManagementPanel.kt` 의 `confirmPreviewEditText`
                        // 와 같은 조합). 길이는 UTF-16 으로 세야 서버와 어긋나지 않는다.
                        let cleaned = InputSanitizer.clamp(
                            InputSanitizer.sanitizeUserText(new, allowNewlines: true),
                            max: 200
                        )
                        if cleaned != new { editDraft = cleaned }
                    }

                HStack(spacing: 8) {
                    Button(String(localized: "취소")) {
                        editing = false
                        editDraft = ""
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .disabled(saving)

                    Button(saving ? String(localized: "재생성 중…") : String(localized: "재생성")) {
                        Task { await savePreviewText() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.palette.primary)
                    .frame(maxWidth: .infinity)
                    .disabled(working || editDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else {
                HStack(spacing: 8) {
                    Text(previewDisplayText)
                        .font(theme.typography.bodyLarge)
                        .foregroundStyle(
                            previewText.isEmpty ? theme.palette.onSurfaceVariant : theme.palette.onSurface
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        // 입력칸이 열리면 톤 카드가 잠긴다(`toneCardLocked`) — 트던 소리는 여기서 멈춘다(안드로이드도 입력칸을
                        // 열 때 멈춘다). 그대로 두면 멈출 버튼이 잠긴 채 옛 문구가 끝까지 난다. 멈춘 재생은 청취가 아니다.
                        replayAfterPlayback = false
                        stopPreview()
                        editDraft = previewText
                        editing = true
                    } label: {
                        Image(systemName: "pencil")
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .disabled(working || previewText.isEmpty)
                    .accessibilityLabel(String(localized: "문구 수정"))
                }
            }
        }
        .padding(16)
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

    // MARK: - 톤 카드

    /// 톤 조절 카드 — 제목 줄(`톤 조절` · 지금 값), 막대, 그 아래 `원본 듣기`·`현재 톤 듣기` 뿐이다(설명·추천값·0으로는
    /// 2026-10-08 사용자 지시로 뺐다). 범위·눈금은 서버와 같다(`VoiceTuning.pitchRange`). 막대는 추천값에서 시작하고,
    /// 원본과의 비교는 `원본 듣기` 가 한다(0 도 0.5 눈금이라 막대로 맞출 수 있다). 막대에서 손을 떼면 그 높이로 구워
    /// (PSOLA — 몸집은 그대로) 처음부터 한 번 다시 튼다.
    private var tuningCard: some View {
        let label = Self.tuningValueText(tuning.pitchSt)
        // 줄 간격·값 글자 굵기는 안드로이드 `ui/voices/VoiceTuningCard.kt` 의 `VoiceTuningCard` 와 같다.
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(localized: "톤 조절"))
                    .font(theme.typography.titleSmall)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer(minLength: 8)
                Text(verbatim: label)
                    .font(theme.typography.bodyMedium)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.primary)
                    .monospacedDigit()
            }
            Slider(
                value: Binding(
                    get: { tuning.pitchSt },
                    set: { tuning = VoiceTuning(pitchSt: $0, source: .user).normalized() }
                ),
                in: VoiceTuning.pitchRange,
                step: VoiceTuning.step,
                onEditingChanged: { editing in
                    if !editing { sliderReleased() }
                }
            )
            .tint(theme.palette.primary)
            .disabled(toneCardLocked)
            .accessibilityLabel(String(localized: "톤 조절"))
            .accessibilityValue(label)
            // 두 버튼은 번갈아 들으라고 둔 것이다(2026-10-08 사용자) — 같은 폭으로 나란히.
            HStack(alignment: .top, spacing: 8) {
                previewButton(.original)
                previewButton(.current)
            }
        }
        .padding(16)
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

    /// 톤 카드 안 하단의 듣기 버튼 하나 — 안드로이드 `ui/voices/VoiceTuningCard.kt` 의 `TuningListenButton` 과 같은 모양이다.
    /// 쉴 때는 채움 없이 카드와 같은 테두리, 트는 쪽은 강조색 테두리·옅은 강조색 채움·강조색 글자에 정지 글리프이고, 받거나
    /// 굽는 동안은 그 자리에 진행 표시다. 다시 누르면 멈춘다. 라벨은 번역이 길면 두 줄로 흐른다 — 줄이지 않는다(CLAUDE.md
    /// 「글자 크기가 자리를 넘칠 때」 — 줄바꿈으로 흐를 수 있는 자리다).
    private func previewButton(_ kind: VoiceTonePreview.Kind) -> some View {
        let title = kind == .original ? String(localized: "원본 듣기") : String(localized: "현재 톤 듣기")
        let active = activePreviewKind == kind
        let preparing = active && (fetching || renderingTuning)
        let enabled = !toneCardLocked
        let accent = theme.palette.primary
        // 잠겨도 글자는 읽히게 한 단계만 낮춘다(안드로이드 `wakerOutlinedButtonColors` 의 비활성 색).
        let content = !enabled ? theme.palette.onSurfaceVariant : (active ? accent : theme.palette.onSurface)
        let shape = RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
        return Button {
            press(kind)
        } label: {
            HStack(spacing: 6) {
                if preparing {
                    ProgressView()
                        .controlSize(.small)
                        .tint(accent)
                } else {
                    Image(systemName: active ? "stop.fill" : "play.fill")
                }
                Text(title)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(theme.typography.labelLarge)
            .foregroundStyle(content)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: AlarmTalkControl.height)
            .background(active ? accent.opacity(0.12) : Color.clear, in: shape)
            .overlay(shape.stroke(active ? accent : theme.palette.outlineVariant, lineWidth: 1))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    /// 지금 '트는 중' 으로 보일 버튼 — 받는 동안은 받은 뒤에 틀 버튼, 그 밖에는 트는(굽는) 버튼.
    private var activePreviewKind: VoiceTonePreview.Kind? {
        fetching ? pendingPlayKind : playingKind
    }

    /// "+3.5" / "−1.5" / "0" — 부호를 늘 보인다(안드로이드 `signedTuningValue` 와 같은 글자, 빼기는 U+2212).
    /// 숫자뿐이라 번역 대상이 아니다.
    static func tuningValueLabel(_ value: Double) -> String {
        guard value != 0 else { return "0" }
        return (value > 0 ? "+" : "\u{2212}") + String(format: "%.1f", abs(value))
    }

    /// 단위까지 붙인 값 — "−1.5 반음"(안드로이드 `voices_tuning_pitch_value`, 스펙 §4-3 제목 줄). 숫자만 두면 무슨 눈금인지
    /// 알 수 없다(Codex #870).
    static func tuningValueText(_ value: Double) -> String {
        String(localized: "\(tuningValueLabel(value)) 반음")
    }

    // MARK: - 재생

    /// 두 버튼 — 트는 중인 버튼을 다시 누르면 멈추고, 다른 버튼을 누르면 지금 것을 멈추고 그것을 처음부터 튼다.
    /// 받는 중이면 받기는 그대로 두고 받은 뒤에 무엇을 틀지만 바꾼다(진행 표시가 도는 버튼을 다시 누르면 받기만 한다 —
    /// 안드로이드 `TuningListenAction` 과 같은 규칙).
    private func press(_ kind: VoiceTonePreview.Kind) {
        guard !viewGone, !toneCardLocked else { return }
        // 손으로 고른 재생이 미뤄 둔 '막대를 놓은 뒤 다시 듣기' 보다 앞선다.
        replayAfterPlayback = false
        switch VoiceTonePreview.press(kind, active: activePreviewKind) {
        case .stop:
            if fetching { pendingPlayKind = nil } else { stopPreview() }
        case .play(let next):
            if fetching { pendingPlayKind = next } else { startPreview(next) }
        }
    }

    /// 막대에서 손을 뗐다 — 현재 톤을 다시 굽고 처음부터 한 번 튼다. 서버 청취 확인 전의 재생이 소리 나는 중이면
    /// 끊지 않는다 — 끝까지 들어야 저장이 열리는 화면이다. 그때 바꾼 값은 그 재생이 끝난 직후 다시 들려준다
    /// (`playbackEnded`). 판정은 `VoiceTonePreview.sliderReleased`.
    private func sliderReleased() {
        guard !viewGone, !toneCardLocked else { return }
        switch VoiceTonePreview.sliderReleased(
            hasClip: previewClip != nil,
            listenConfirmed: listened,
            audible: voice.tuningPreviewPlayer.isPlaying
        ) {
        case .ignore: break
        case .afterCurrentPlayback: replayAfterPlayback = true
        case .replayNow: startPreview(.current)
        }
    }

    /// 그 버튼의 소리를 처음부터 **한 번** 튼다 — 원본은 받은 클립 그대로, 현재 톤은 막대 값으로 메모리에서 구워서
    /// (서버 왕복 없음). 받은 클립이 없으면 서버 미리듣기부터 받고 튼다(예전 재생 버튼과 같은 요청).
    private func startPreview(_ kind: VoiceTonePreview.Kind) {
        // 등록 확정·초안 삭제 중(`busy`)에는 틀지 않는다 — 지우는 초안의 소리가 나거나 서버에 새 합성을 부른다. 문구
        // 입력칸이 열린 동안도 — 그 소리는 고치기 전 문구다.
        guard !viewGone, !saving, !busy, !editing else { return }
        // 새 재생이 미뤄 둔 '첫 재생이 끝난 뒤 다시 듣기' 를 대신한다 — 새 재생은 지금 막대 값을 굽는다. 남겨 두면 청취
        // 확인을 기다리는 사이 시작한 이 재생을 확인이 돌아온 뒤 다시 끊는다(안드로이드 `confirmFirstListen` 도 그때 트는
        // 것을 끊지 않는다).
        replayAfterPlayback = false
        guard let clip = previewClip, FileManager.default.fileExists(atPath: clip.url.path) else {
            Task { await fetchPreview(thenPlay: kind) }
            return
        }
        // 지난 재생이 깨져 남긴 문구를 지운다 — 받아 둔 클립을 다시 트는 길은 서버 받기(`fetchPreview`)를 지나지 않는다.
        errorMessage = nil
        voice.previewPlayer.stop()
        stopPreview()
        let generation = playGeneration
        let clipStamp = clipGeneration
        let target = VoiceTonePreview.target(of: kind, slider: tuning)
        playingKind = kind
        renderingTuning = !target.isNeutral
        Task {
            let tuned = await Self.bake(clip.url, tuning: target)
            guard generation == playGeneration else { return }
            renderingTuning = false
            var playedOriginalInstead = false
            let end = await voice.tuningPreviewPlayer.play(tuned: tuned, original: clip.url) {
                playedOriginalInstead = true
            }
            // 그 사이 다른 버튼을 눌렀거나 멈췄다 — 그쪽이 화면 상태를 맡는다.
            guard generation == playGeneration else { return }
            playingKind = nil
            // 실제로 들려준 높이 — 원본이었거나 굽지 못했거나 구운 소리를 못 틀어 원본을 틀었으면 0 이다(Codex #870).
            let applied = VoiceTonePreview.applied(
                kind,
                target: target,
                baked: tuned != nil,
                playedOriginalInstead: playedOriginalInstead
            )
            await playbackEnded(end, applied: applied, clip: clip, clipStamp: clipStamp)
        }
    }

    /// 지금 재생(또는 굽기)을 멈춘다. 멈춘 재생은 청취가 아니다.
    private func stopPreview() {
        playGeneration += 1
        playingKind = nil
        renderingTuning = false
        voice.tuningPreviewPlayer.stop()
    }

    /// 재생 하나가 끝났다. 끝난 모양은 셋으로 가른다 — 끝까지 들음 / 멈춤(화면 이탈·다른 재생 — 청취 아님, 알리지
    /// 않음) / 깨짐. 이 클립을 **처음 끝까지** 들은 것이면(어느 버튼이든) 서버에 청취를 알리고, 들은 높이를 적는다.
    private func playbackEnded(
        _ end: VoiceTuningPreviewPlayer.PlaybackEnd,
        applied: VoiceTuning,
        clip: VoiceStudioViewModel.DraftPreviewClip,
        clipStamp: Int
    ) async {
        guard clipStamp == clipGeneration else { return }
        switch end {
        case .stopped:
            return
        case .failed:
            // 원본도 못 틀었다 — 조용히 넘기면 버튼만 돌아오고 저장이 잠긴 채 남는다(Codex #870).
            replayAfterPlayback = false
            errorMessage = String(localized: "미리듣기를 재생하지 못했어요.")
            return
        case .finished:
            break
        }
        if !listened, !confirming {
            confirming = true
            let failure = await voice.confirmDraftPreviewListened(draft: draft, clip: clip, session: auth.session)
            confirming = false
            guard clipStamp == clipGeneration else { return }
            if let failure {
                // 기록되지 않았으니 저장은 잠긴 채다. 받은 클립을 버려 다음 누름이 새로 받게 한다(새 재생 토큰 —
                // 예전 재생 버튼이 서버 경로로 다시 가던 것과 같다).
                errorMessage = failure
                discardClip()
                return
            }
            listened = true
        }
        hearing.record(applied)
        // 첫 재생 도중(끊지 않는다) 막대를 놓았으면 이제 새 높이로 들려준다 — 안 그러면 들어 보지 않은 값을
        // 저장하게 된다(Codex #870). 확인을 기다리는 사이 화면을 떠났으면 다시 틀지 않는다.
        if replayAfterPlayback {
            replayAfterPlayback = false
            if !viewGone, !tuning.soundsSame(as: applied) { startPreview(.current) }
        }
    }

    /// 클립을 그 높이로 **메모리에서** 구운 소리(메인 밖). 원래 소리(0)거나 굽지 못하면 nil — 그때는 원본을 튼다.
    private static func bake(_ source: URL, tuning: VoiceTuning) async -> Data? {
        guard !tuning.isNeutral else { return nil }
        return await Task.detached(priority: .userInitiated) {
            VoiceTuningRenderer.previewWAV(source: source, tuning: tuning)
        }.value
    }

    /// 업로드하는 동안 잰 등록 녹음 높이(원래 목소리)를 가져온다. 초안과 짝이 맞을 때만.
    private func startSourceMeasurement() {
        guard sourceMeasurement == nil,
              let source = voice.pendingDraftSourceMeasurement,
              source.draftID == draft.id else { return }
        sourceMeasurement = source.measurement
    }

    /// 새 클립이 왔다 — 재생 **전에** 재서 추천값을 정한다(클립마다 — 문구를 고치면 새 클립이 오고 높이도 달라질 수
    /// 있다). 사용자가 이미 막대를 만졌으면 그 값을 덮지 않는다.
    private func prepareTuning(for url: URL) async {
        let preview = await Task.detached(priority: .userInitiated) {
            VoiceTuningAnalyzer.measure(url: url, maxSeconds: 30)
        }.value
        let suggestion = VoiceTuningAnalyzer.suggest(preview: preview, source: sourceMeasurement)
        if tuning.source == .suggested {
            tuning = suggestion
        }
    }

    /// 받은 클립을 이 화면의 클립으로 둔다 — 들은 높이는 새로 센다.
    private func install(_ clip: VoiceStudioViewModel.DraftPreviewClip) {
        clipGeneration += 1
        previewClip = clip
        hearing = VoiceTonePreview.Hearing()
        replayAfterPlayback = false
        // 새 재생 토큰이 왔으면 서버의 청취 기록이 비어 있다 — 다시 끝까지 들어야 저장이 열린다.
        if clip.playbackToken != nil { listened = false }
    }

    /// 받은 클립을 버린다(청취 확인 실패·문구 수정) — 다음 누름이 서버에서 새로 받는다.
    private func discardClip() {
        stopPreview()
        clipGeneration += 1
        previewClip = nil
        hearing = VoiceTonePreview.Hearing()
        replayAfterPlayback = false
    }

    private var previewDisplayText: String {
        if !previewText.isEmpty { return "“\(previewText)”" }
        if fetching || !previewAttempted { return String(localized: "문구를 준비하고 있어요…") }
        // 다시 받는 길은 톤 카드의 두 듣기 버튼이다(받은 클립이 없으면 서버에서 받는다) — 안드로이드
        // `voices_preview_text_retry_hint` 와 같은 문구.
        return String(localized: "문구를 아직 준비하지 못했어요. 듣기 버튼을 눌러 다시 시도해 주세요.")
    }

    // MARK: - 교체

    /// 이미 등록된 **내** 목소리(이 초안 제외). 있으면 이 화면의 저장은 곧 교체다.
    private var registeredVoice: VoiceProfile? {
        Self.replacementTarget(among: voice.profiles, draftID: draft.id)
    }

    /// 이 초안을 저장하면 **교체되는** 내 목소리 — 이 초안·다른 초안·시스템 목소리·실패한 목소리는 빼고 고른다.
    /// 있으면 저장은 체크 없이 언제나 교체로 보낸다(`replace_existing` — 스펙 §4-1, 2026-10-08 사용자).
    nonisolated static func replacementTarget(among profiles: [VoiceProfile], draftID: String) -> VoiceProfile? {
        profiles.first { profile in
            profile.id != draftID
                && profile.isDraft != true
                && profile.isSystem != true
                && (profile.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != "failed"
        }
    }

    /// 교체 한 줄 — **이미 등록된 목소리가 있을 때만** 톤 카드 아래에 제목과 같은 글자 크기로 둔다(체크 상자·설명
    /// 없음 — 2026-10-08 사용자). 저장하면 실제로 이 두 가지가 일어난다(설명은 화면에서 뺐지만 동작은 그대로다):
    ///   - 이전 목소리는 목록에서 사라진다(서버는 그 행을 지우지 않고 **재사용**한다 —
    ///     지우면 그 목소리를 쓰던 알람이 전부 기본 목소리(미나)로 바뀌기 때문이다).
    ///   - 직접 입력 문구로 만든 알람만 기본 목소리로 바뀐다(그 음성은 옛 목소리로 만들어
    ///     둔 것이라 자동 재생성이 안 된다). 나머지 알람은 그대로 살아 새 목소리로 운다.
    @ViewBuilder
    private var replaceNotice: some View {
        if registeredVoice != nil {
            Text(String(localized: "이전에 저장한 목소리는 삭제하고 이 목소리로 등록할게요."))
                .font(theme.typography.titleMedium)
                .foregroundStyle(theme.palette.onSurface)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// 하단 액션 — **'다시 만들기'(보조) · '저장하기'(주)** 두 버튼의 크기를 정확히 같게
    /// 그린다(2026-09-19 지시).
    ///
    /// ⚠ **시스템 버튼 스타일을 섞지 말 것.** `.borderedProminent` 는 자기 여백·높이를
    ///   따로 갖고 있어서, 옆의 `.plain` 버튼과 같은 `minHeight` 를 줘도 실제로는 다르게
    ///   그려진다(실기기에서 두 번 어긋났다). 그래서 **둘 다 `.plain`** 으로 두고 배경·
    ///   테두리·높이를 이 파일에서 직접 같은 값으로 그린다 — 다른 것은 **색뿐**이다.
    private var actions: some View {
        // ⚠ **폭을 SwiftUI 분배에 맡기지 않는다**(2026-09-19 실기기: 높이도 폭도 어긋났다).
        //   `maxWidth: .infinity` 는 글자 길이에 따라 두 버튼이 다르게 나뉠 수 있다.
        //   남은 폭에서 간격을 빼고 **반으로 나눈 값**을 두 버튼에 그대로 준다.
        GeometryReader { geo in
            let gap: CGFloat = 10
            let each = max((geo.size.width - gap) / 2, 0)
            HStack(spacing: gap) {
                actionButton(
                    title: "다시 만들기",
                    foreground: theme.palette.error,
                    background: theme.palette.surface,
                    border: theme.palette.outlineVariant,
                    width: each,
                    disabled: working
                ) { Task { await discard() } }

                // ⚠ **끝까지 듣기 전에는 저장할 수 없다.** 서버도 재생 토큰 없이는 승격을
                // 거부하므로, 여기서 열어 두면 눌러도 실패하는 버튼이 된다.
                // ⚠ **지금 톤(막대 값)을 끝까지 들어야** 저장이 열린다 — 바꾼 높이를 굽거나 트는 중에 저장하면 듣지
                // 않은 값이 등록되어 그 목소리의 모든 알람에 구워진다(Codex #870). 판정은 `VoiceTonePreview.canSave`.
                // ⚠ **문구 입력칸이 열린 동안·고친 문구를 보내는 동안도 잠근다**(잠금표 — `working`·`editing`). 입력칸이
                // 열린 채 저장하면 친 문구가 말없이 버려지고, 보내는 중이면 들은 기록이 아직 옛 문구의 것이다.
                // 교체는 따로 묻지 않는다 — 이미 등록된 목소리가 있으면 저장이 곧 교체다(`replaceNotice`).
                let saveDisabled = working || editing || !VoiceTonePreview.canSave(
                    listenConfirmed: listened,
                    rendering: renderingTuning,
                    hearing: hearing,
                    slider: tuning
                )
                actionButton(
                    title: saving ? "저장 중…" : "저장하기",
                    foreground: theme.palette.onPrimary,
                    background: saveDisabled
                        ? theme.palette.primary.opacity(0.4)
                        : theme.palette.primary,
                    border: .clear,
                    width: each,
                    disabled: saveDisabled
                ) { Task { await promote() } }
            }
        }
        // GeometryReader 는 높이를 스스로 정하지 못한다 — 버튼 높이로 고정한다.
        .frame(height: Self.actionButtonHeight)
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 16)
    }

    /// 하단 버튼 높이. 두 버튼이 **같은 값**을 쓰는 유일한 출처다.
    private static let actionButtonHeight: CGFloat = 52

    /// 두 하단 버튼이 **같은 자로** 그려지도록 모양을 한 곳에 둔다(위 주석 참조).
    private func actionButton(
        title: LocalizedStringKey,
        foreground: Color,
        background: Color,
        border: Color,
        width: CGFloat,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.typography.bodyMedium.weight(.semibold))
                .foregroundStyle(foreground)
                // 글자가 길어도 상자를 넓히지 않는다 — 두 버튼이 같은 폭이어야 한다.
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(width: width, height: Self.actionButtonHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            background,
            in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(border, lineWidth: 1)
        )
        .disabled(disabled)
    }

    // MARK: - 서버

    /// 서버 미리듣기를 받는다(예전 재생 버튼과 같은 요청) — 받으면 재서 추천값을 정하고, `kind` 가 있으면 곧바로 그
    /// 버튼의 소리를 튼다(받는 동안 그 버튼이 진행 표시를 한다 — `pendingPlayKind`).
    private func fetchPreview(thenPlay kind: VoiceTonePreview.Kind?) async {
        // 초안을 지우거나 확정하는 중(`busy`)에는 받지 않는다 — 지우는 초안으로 합성(ElevenLabs)을 부르게 된다.
        guard !fetching, !viewGone, !saving, !busy else { return }
        stopPreview()
        fetching = true
        pendingPlayKind = kind
        errorMessage = nil
        let stamp = clipGeneration
        let result = await voice.fetchDraftPreview(draft: draft, session: auth.session)
        previewAttempted = true
        guard stamp == clipGeneration else {
            fetching = false
            pendingPlayKind = nil
            return
        }
        switch result {
        case .failed(let message):
            fetching = false
            pendingPlayKind = nil
            errorMessage = message
        case .ready(let clip):
            // 소리가 날 때 글자도 같이 보인다(2026-09-19 지시) — 재고 굽는 틈은 짧다.
            if !clip.text.isEmpty { previewText = clip.text }
            await prepareTuning(for: clip.url)
            fetching = false
            install(clip)
            let next = pendingPlayKind
            pendingPlayKind = nil
            // 받는 사이 화면을 떠났으면 틀지 않는다 — 화면 밖에서 소리가 난다(Codex #870).
            if let next, !viewGone, !Task.isCancelled {
                startPreview(next)
            }
        }
    }

    private func savePreviewText() async {
        guard let token = auth.session?.token else { return }
        let text = editDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !working else { return }
        saving = true
        // 옛 문구의 재생은 멈춘다 — 이후 재생은 수정본 기준이어야 한다.
        stopPreview()
        do {
            let normalized = try await AlarmTalkAPI.shared.updateVoicePreviewText(
                id: draft.id,
                previewText: text,
                token: token
            )
            saving = false
            previewText = normalized
            editing = false
            editDraft = ""
            // 서버가 previewed_at 과 재생 토큰을 지웠다 — 새 문구는 안 들어본 문구다. 받아 둔 클립도 옛 문구의 소리다.
            listened = false
            discardClip()
            await fetchPreview(thenPlay: .current)
        } catch {
            saving = false
            errorMessage = voice.mapVoiceError(error)
        }
    }

    private func promote() async {
        // 저장 버튼과 같은 잠금 — 누른 뒤 이 작업이 시작되기 전에 문구 입력칸이 열렸거나 다른 서버 일이 시작됐을 수 있다.
        guard !working, !editing, let token = auth.session?.token else { return }
        // **끝까지 들은** 지금 톤만 싣는다 — 저장 버튼이 이미 막지만, 누른 뒤 요청이 나가기 전에 값이 바뀌었을 수 있다.
        let pitch = tuning.normalized()
        guard VoiceTonePreview.canSave(
            listenConfirmed: listened,
            rendering: renderingTuning,
            hearing: hearing,
            slider: pitch
        ) else { return }
        // 이미 등록된 목소리가 있으면 이 저장은 **언제나 교체**다 — 체크하지 않는다(2026-10-08 사용자).
        let replacing = registeredVoice != nil
        saving = true
        busy = true
        defer { saving = false; busy = false }
        do {
            let promoted = try await AlarmTalkAPI.shared.promoteVoiceDraft(
                id: draft.id,
                token: token,
                replaceExisting: replacing,
                isShared: isShared && canShareVoice,
                // **끝까지 들은** 높이를 한 번 싣는다(저장은 지금 값을 들었을 때만 열린다). 교체 등록도 같다 — 서버는
                // 옛 목소리의 높이를 물려주지 않고 이 값으로 덮어쓴다(스펙 §4-3). 0 이면 키가 나가지 않는다.
                pitchSemitones: pitch.pitchSt
            )
            stopPreview()
            // ⚠ **교체한 기기에서 곧바로 내린다.** 교체는 옛 프로필 행을 그대로 재사용하므로
            // (id 가 같다) 어떤 접근권 재확인으로도 이 알람들은 잡히지 않는다 — 놔두면 교체를
            // 확정한 바로 그 기기에서 **지운 목소리가 계속 울린다**(Codex #703 P1). 다른 기기는 서버의
            // voice_access_revoked(voiceProfileId 동봉)가 깨운다.
            // 프리셋 알람은 건드리지 않는다 — 서버가 같은 message id 로 새 목소리를 다시 만든다.
            if replacing {
                // 이 화면이 교체를 이미 알렸으므로(`replaceNotice`) 대기표(모달)는 남기지 않는다.
                // `degrade` 가 세우는 `needsScheduleReconcile` 을 `AlarmTalkApp` 이 받아
                // AlarmKit 예약(구워 둔 .caf)까지 맞춘다.
                // ⚠ **강등과 표식 확정을 함께 한다.** 새로고침이 우연히 해 주기를 기다리지
                // 않는다(안드로이드에는 그 우연이 없다 — 두 앱이 같은 자리에서 같은 일을 한다).
                // 표식이 옛 값이면 곧바로 **새 목소리로** 만든 알람을 뒤늦은 푸시나 다음
                // 새로고침이 '아직 안 내린 교체' 로 보고 되돌릴 수 없이 지운다.
                let pending = VoiceReplacementMarkerStore().applyIfNotApplied(
                    userID: auth.session?.user.id,
                    profileID: promoted.id,
                    invalidatedAt: promoted.customAudioInvalidatedAt
                ) {
                    let ids = voice.degradeCustomMessageAlarms(
                        forProfileID: promoted.id,
                        alarmStore: alarmStore,
                        audioCache: .shared,
                        ownerUserId: auth.session?.user.id
                    )
                    // 디스크에 남은 뒤에만 확정 후보가 된다 — 안 그러면 다음 실행이 옛 알람을
                    // 다시 읽는데 표식만 앞서 나가 영영 다시 내리지 않는다.
                    return alarmStore.saveNow() ? ids : nil
                }
                // ⚠ **예약까지 맞춘 뒤에 확정한다.** `degrade` 는 로컬 행만 고치고, 울리는
                // 것은 이미 구워 둔 예약이다 — 여기서 확정해 버리면 재예약이 실패했을 때
                // 다음 회차가 같은 세대를 건너뛰어 회수된 목소리가 예약된 채 남는다.
                let deps = BackgroundDependencies.shared
                _ = await AlarmScheduleReconciler.reconcile(
                    store: alarmStore,
                    alarmKit: deps.alarmKit,
                    ownerUserId: auth.session?.user.id
                )
                // ⚠ **프리셋 재렌더가 끝나야 이 세대를 확정한다**(Codex #703 P1).
                // 교체 트랜잭션은 세대를 커밋하고 프리셋 재렌더는 **큐에만 넣는다**
                // (`replaceVoiceInPlace`) — 실제 굽기는 cron 이 나중에 한다. 그런데 여기서
                // 확정해 버리면 권위 새로고침의 `guard` 가 '바뀐 것 없음' 으로 접어
                // **프리셋 수리 자체를 건너뛴다**(`onAuthoritativeRefresh`). 완료 푸시를 놓친
                // 기기에서는 기존 프리셋 알람이 회수된 옛 목소리로 계속 운다.
                //
                // 판정은 푸시 경로와 **철자까지 같다** — 한쪽만 고치면 다시 갈라진다.
                let manifestFresh = await voice.loadStockClips(session: auth.session, force: true)
                let presetRefresh = await voice.refreshChangedCachedStockClips(session: auth.session)
                let presetPending = !manifestFresh
                    || !presetRefresh.settled(forProfileID: promoted.id)
                if presetPending {
                    // ⚠ **확정하지 않는다.** 표식이 그대로라 아래 `voice.refresh(force:)` 의
                    // 권위 훅이 같은 세대를 다시 집고, 재렌더가 끝난 회차에 확정·해제한다.
                    //
                    // ⚠ **실패 문구를 쓰지 말 것** — 이건 정상적인 대기다. 사용자는 곧바로
                    // 준비 화면(`ClipPreparationView`)으로 넘어가고 그 화면이 진행률을 말한다.
                    voice.suppressReplacedProfile(promoted.id)
                } else {
                    let cleaned = await deps.confirmIfReservationsSettled(
                        pending,
                        ownerID: auth.session?.user.id
                    )
                    if !cleaned {
                        // ⚠ **정리가 끝나지 않았으면 이 목소리를 아직 고를 수 없게 둔다**
                        // (안드로이드 승격 경로와 같다). 고를 수 있게 두면 그 사이 만든 새
                        // 알람을 다음 회차가 함께 지운다 — 강등 대상은 프로필 id 로만
                        // 고르기 때문이다. 다음 새로고침이 정리를 마치면 곧바로 풀린다.
                        voice.suppressReplacedProfile(promoted.id)
                        voice.statusMessage =
                            String(localized: "목소리는 바뀌었지만 기존 알람 정리를 끝내지 못했어요. 목소리 탭을 새로고침해 주세요.")
                    }
                }
            }
            await voice.refresh(session: auth.session, force: true)
            // 교체 갈래는 draft id 가 아니라 기존 공식 프로필 id 를 반환한다. 준비 페이지가
            // 삭제된 draft 를 기다리지 않도록 서버가 돌려준 실제 id 를 넘긴다.
            onSaved(promoted.id)
        } catch {
            errorMessage = voice.mapVoiceError(error)
        }
    }

    private func discard() async {
        guard !busy, let token = auth.session?.token else { return }
        // 받는 중이던 미리듣기·미뤄 둔 다시 듣기도 거둔다 — 지우는 초안의 소리를 내지 않는다(`startPreview` 도 `busy` 를 본다).
        pendingPlayKind = nil
        replayAfterPlayback = false
        stopPreview()
        busy = true
        defer { busy = false }
        // 실패해도 되돌아간다 — 초안은 서버가 정리하고, 여기 갇히는 게 더 나쁘다.
        try? await AlarmTalkAPI.shared.deleteVoiceDraft(id: draft.id, token: token)
        await voice.refresh(session: auth.session, force: true)
        onDiscarded()
    }
}
