import SwiftUI

/// 등록 직후 **'이 목소리로 저장할까요?'** 확인 스텝.
///
/// 안드로이드 `ui/voices/VoiceProfileManagementPanel.kt:1838-1976` 의 Preview 스텝.
///
/// ⚠ **iOS 에는 이 스텝이 통째로 없었다.** 등록이 성공하면 곧바로 목록으로 돌아가,
/// 사용자는 자기 목소리가 어떻게 들리는지 **한 번도 못 들어보고** 이번 달 등록 횟수를
/// 써 버렸다. 서버도 이 흐름을 전제한다 — 클론은 `is_draft=true` 로 만들어지고,
/// 여기서 승격(`PATCH is_draft=false`)해야 정식 프로필이 된다.
///
/// 규칙 셋:
/// 1. **끝까지 들어야 저장이 열린다.** 서버가 준 재생 토큰을 `preview-played` 로
///    돌려줘야 승격이 허용된다 — 안 듣고 저장하는 걸 막는 장치다.
/// 2. **문구를 고치면 다시 잠긴다.** 서버가 `previewed_at` 을 리셋하므로 새 문구로
///    다시 들어야 한다(고친 문구는 안 들어본 문구다).
/// 3. **'다시 만들기' 는 초안을 지운다.** 정식 프로필이 아니라 draft 라 지워도 이번 달
///    등록 횟수가 차감되지 않는다 — 그래서 마음에 들 때까지 다시 만들 수 있다.
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
    @State private var saving = false
    @State private var busy = false
    /// 첫 미리듣기 요청이 끝났는지. 빈 문자열을 로딩과 실패로 구분한다.
    @State private var previewAttempted = false
    /// 미리듣기를 끝까지 들었는가. 문구를 고치면 `false` 로 되돌린다.
    @State private var listened = false
    @State private var errorMessage: String?
    /// 등록 확정 화면의 **교체 체크**. 이미 등록된 목소리가 있을 때만 보인다.
    @State private var replaceExisting = false
    /// 공유 여부는 초안 입력 단계가 아니라 실제로 저장하는 이 단계에서 고른다.
    @State private var isShared = false
    /// 뒤로 나가려 할 때 뜨는 경고. 이 화면을 벗어나면 초안이 삭제된다
    /// (안드로이드 `VoiceProfileManagementPanel.kt:2141` `draftExitWarningOpen`).
    @State private var exitWarningOpen = false

    var body: some View {
        VStack(spacing: 0) {
            WakerTopBar(
                title: "목소리 만들기",
                onBack: { exitWarningOpen = true },
                backEnabled: !busy
            )
            .padding(.top, 18)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("이 목소리로 저장할까요?")
                        .font(theme.typography.titleMedium)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)

                    Text("저장하면 이번 달에 만들 수 있는 목소리를 다 쓰게 돼요. 지워도 다음 달까지는 새로 만들 수 없으니, 마음에 들지 않으면 저장하기 전에 다시 만들어 보세요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)

                    previewCard
                    Text("말투를 원하는 대로 바꿔 보세요.\n매일 아침 문구가 이 말투로 만들어져요.")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.error)
                    }

                    sharingSection
                    replaceConsent
                    Spacer(minLength: 4)
                }
                .padding(.horizontal, 20)
            }
            actions
        }
        .homeGradientBackground()
        .task {
            isShared = draft.isShared == true && canShareVoice
            // 문구는 합성 응답이 알려 준다(서버가 그때 확정한다) — 여기선 비워 두고
            // 첫 재생이 채운다. 들어보라고 만든 화면이니 들어오자마자 한 번 들려준다.
            await play()
        }
        .alert("나가면 임시 목소리가 삭제돼요", isPresented: $exitWarningOpen) {
            Button("나가고 삭제", role: .destructive) {
                Task { await discard() }
            }
            Button("계속 만들기", role: .cancel) {}
        } message: {
            Text("지금 나가면 만들고 있던 목소리(초안)가 삭제되고, 처음부터 다시 만들어야 해요.")
        }
    }

    private var sharingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("공유 설정")
                .font(theme.typography.titleSmall)
                .fontWeight(.semibold)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("가족·연인에게 공유 허용")
                        .font(theme.typography.bodyMedium)
                        .fontWeight(.semibold)
                    Text(canShareVoice
                         ? "등록한 목소리를 가족·연인도 함께 사용할 수 있어요."
                         : "공유는 커플/가족 이용권에서 사용할 수 있어요.")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer(minLength: 0)
                Toggle("", isOn: $isShared)
                    .labelsHidden()
                    .alarmTalkSwitch()
            }
            .disabled(!canShareVoice || busy)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(theme.palette.surfaceVariant.opacity(0.42))
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
        }
    }

    private var canShareVoice: Bool {
        canShareVoiceWithOthers(
            subscriptionResponse: socialFeatures.subscription,
            familyGroup: socialFeatures.familyGroup,
            authSession: auth.session,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }

    // MARK: - 미리듣기 카드

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if editing {
                TextEditor(text: $editDraft)
                    .frame(minHeight: 72)
                    .font(theme.typography.bodyMedium)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(theme.palette.surface.opacity(0.74))
                    .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                            .stroke(theme.palette.outlineVariant, lineWidth: 1)
                    )
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
                    Button("취소") {
                        editing = false
                        editDraft = ""
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .disabled(saving)

                    Button(saving ? "재생성 중…" : "재생성") {
                        Task { await savePreviewText() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.palette.primary)
                    .frame(maxWidth: .infinity)
                    .disabled(saving || editDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
                        editDraft = previewText
                        editing = true
                    } label: {
                        Image(systemName: "pencil")
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .disabled(busy || previewText.isEmpty)
                    .accessibilityLabel("문구 수정")

                    Button {
                        Task { await play() }
                    } label: {
                        if busy {
                            ProgressView().frame(width: 36, height: 36)
                        } else {
                            Image(systemName: "play.fill")
                                .frame(width: 36, height: 36)
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.primary)
                    .disabled(busy)
                    .accessibilityLabel("다시 듣기")
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

    private var previewDisplayText: String {
        if !previewText.isEmpty { return "“\(previewText)”" }
        if busy || !previewAttempted { return "문구를 준비하고 있어요…" }
        return "문구를 아직 준비하지 못했어요. 미리듣기를 눌러 다시 시도해 주세요."
    }

    /// 이미 등록된 **내** 목소리(이 초안 제외). 있으면 저장이 한도에 걸리므로
    /// 교체 체크를 낸다.
    private var registeredVoice: VoiceProfile? {
        voice.profiles.first { profile in
            profile.id != draft.id
                && profile.isDraft != true
                && profile.isSystem != true
                && normalizedStatus(profile.status) != "failed"
        }
    }

    private func normalizedStatus(_ value: String?) -> String {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// 교체 안내 + 체크. **이미 등록된 목소리가 있을 때만** 낸다 — 없으면 그냥 저장되고,
    /// 체크를 보여 줄 이유가 없다.
    ///
    /// ⚠ 문구가 곧 계약이다. 체크하면 실제로 이 두 가지가 일어난다:
    ///   - 이전 목소리는 목록에서 사라진다(서버는 그 행을 지우지 않고 **재사용**한다 —
    ///     지우면 그 목소리를 쓰던 알람이 전부 기본 알람음으로 떨어지기 때문이다).
    ///   - 직접 입력 문구로 만든 알람만 기본 알람음이 된다(그 음성은 옛 목소리로 만들어
    ///     둔 것이라 자동 재생성이 안 된다). 나머지 알람은 그대로 살아 새 목소리로 운다.
    @ViewBuilder
    private var replaceConsent: some View {
        if let registeredVoice {
            Button {
                replaceExisting.toggle()
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: replaceExisting ? "checkmark.square.fill" : "square")
                        .font(.title3)
                        .foregroundStyle(replaceExisting ? theme.palette.primary : theme.palette.onSurfaceVariant)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("‘\(registeredVoice.name)’ 을(를) 이 목소리로 교체합니다")
                            .font(theme.typography.bodyMedium)
                            .fontWeight(.semibold)
                            .foregroundStyle(theme.palette.onSurface)
                        Text("이전에 저장해둔 목소리는 삭제됩니다. 직접 입력으로 해둔 알람들도 기본 알람으로 설정됩니다.")
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                    Spacer(minLength: 0)
                }
                .multilineTextAlignment(.leading)
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(
                theme.palette.surface,
                in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(
                        replaceExisting ? theme.palette.primary : theme.palette.outlineVariant,
                        lineWidth: 1
                    )
            )
            .disabled(busy)
        }
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button("다시 만들기") {
                Task { await discard() }
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.palette.error)
            .disabled(busy)

            Button(saving ? "저장 중…" : "저장하기") {
                Task { await promote() }
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .frame(maxWidth: .infinity)
            // ⚠ **끝까지 듣기 전에는 저장할 수 없다.** 서버도 재생 토큰 없이는 승격을
            // 거부하므로, 여기서 열어 두면 눌러도 실패하는 버튼이 된다.
            //
            // ⚠ 이미 등록된 목소리가 있으면 **교체에 동의해야** 저장이 열린다. 서버가
            // 어차피 `VOICE_LIMIT_REACHED` 로 막으므로, 열어 두면 눌러도 실패하는
            // 버튼이 된다 — 무엇을 해야 저장되는지도 알 수 없다.
            .disabled(busy || !listened || (registeredVoice != nil && !replaceExisting))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - 동작

    private func play() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        errorMessage = nil
        let outcome = await voice.playDraftPreview(draft: draft, session: auth.session)
        previewAttempted = true
        switch outcome {
        case .played(let text):
            if !text.isEmpty { previewText = text }
            listened = true
        case .failed(let message):
            errorMessage = message
        }
    }

    private func savePreviewText() async {
        guard let token = auth.session?.token else { return }
        let text = editDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        saving = true
        defer { saving = false }
        do {
            previewText = try await AlarmTalkAPI.shared.updateVoicePreviewText(
                id: draft.id,
                previewText: text,
                token: token
            )
            editing = false
            editDraft = ""
            // 서버가 previewed_at 을 지웠다 — 새 문구는 안 들어본 문구다.
            listened = false
            await play()
        } catch {
            errorMessage = voice.mapVoiceError(error)
        }
    }

    private func promote() async {
        guard let token = auth.session?.token else { return }
        saving = true
        busy = true
        defer { saving = false; busy = false }
        do {
            let promoted = try await AlarmTalkAPI.shared.promoteVoiceDraft(
                id: draft.id,
                token: token,
                replaceExisting: replaceExisting,
                isShared: isShared && canShareVoice
            )
            // ⚠ **교체한 기기에서 곧바로 내린다.** 교체는 옛 프로필 행을 그대로 재사용하므로
            // (id 가 같다) 어떤 접근권 재확인으로도 이 알람들은 잡히지 않는다 — 놔두면 바로
            // 위에서 "직접 입력으로 해둔 알람들도 기본 알람으로 설정됩니다" 를 읽고 체크한
            // 그 기기에서 **지운 목소리가 계속 울린다**(Codex #703 P1). 다른 기기는 서버의
            // voice_access_revoked(voiceProfileId 동봉)가 깨운다.
            // 프리셋 알람은 건드리지 않는다 — 서버가 같은 message id 로 새 목소리를 다시 만든다.
            if replaceExisting {
                // 이 화면에서 이미 동의를 받았으므로 대기표(모달)는 남기지 않는다.
                // `degrade` 가 세우는 `needsScheduleReconcile` 을 `AlarmTalkApp` 이 받아
                // AlarmKit 예약(구워 둔 .caf)까지 맞춘다.
                // ⚠ **강등과 표식 확정을 함께 한다.** 새로고침이 우연히 해 주기를 기다리지
                // 않는다(안드로이드에는 그 우연이 없다 — 두 앱이 같은 자리에서 같은 일을 한다).
                // 표식이 옛 값이면 곧바로 **새 목소리로** 만든 알람을 뒤늦은 푸시나 다음
                // 새로고침이 '아직 안 내린 교체' 로 보고 되돌릴 수 없이 지운다.
                VoiceReplacementMarkerStore().applyIfNotApplied(
                    userID: auth.session?.user.id,
                    profileID: promoted.id,
                    invalidatedAt: promoted.customAudioInvalidatedAt
                ) {
                    let degraded = voice.degradeCustomMessageAlarms(
                        forProfileID: promoted.id,
                        alarmStore: alarmStore,
                        audioCache: .shared,
                        ownerUserId: auth.session?.user.id
                    )
                    // 디스크에 남은 뒤에만 확정한다 — 안 그러면 다음 실행이 옛 알람을 다시
                    // 읽는데 표식만 앞서 나가 영영 다시 내리지 않는다.
                    return alarmStore.saveNow() ? degraded : nil
                }
            }
            await voice.refresh(session: auth.session, force: true, successMessage: nil)
            // 교체 갈래는 draft id 가 아니라 기존 공식 프로필 id 를 반환한다. 준비 페이지가
            // 삭제된 draft 를 기다리지 않도록 서버가 돌려준 실제 id 를 넘긴다.
            onSaved(promoted.id)
        } catch {
            errorMessage = voice.mapVoiceError(error)
        }
    }

    private func discard() async {
        guard let token = auth.session?.token else { return }
        busy = true
        defer { busy = false }
        // 실패해도 되돌아간다 — 초안은 서버가 정리하고, 여기 갇히는 게 더 나쁘다.
        try? await AlarmTalkAPI.shared.deleteVoiceDraft(id: draft.id, token: token)
        await voice.refresh(session: auth.session, force: true, successMessage: nil)
        onDiscarded()
    }
}
