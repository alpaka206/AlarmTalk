import SwiftUI

// AlarmEditorSheet 의 '재생 방식' 섹션 분리(파일 길이 축소).
extension AlarmEditorSheet {
    /// **지금 고른 목소리를 쓸 수 없는가** — 저장된 목소리가 목록에서 사라졌거나(삭제·공유
    /// 해제·미준비) 플랜이 내려가 잠긴 경우.
    ///
    /// 안드로이드 `VoiceAudioCard` 의 `selectedProfileUnavailable` 짝이다. 판정이 한 갈래 더
    /// 넓은 이유는 **iOS 가 잠긴 목소리를 목록에서 빼지 않기 때문**이다 — 안드로이드는
    /// 무료 등급에서 `visibleVoiceProfiles` 가 클론을 통째로 걸러 내므로 "목록에 없다" 하나로
    /// 두 경우가 다 잡힌다. iOS 는 잠금 배지만 달아 목록에 남기므로 `locked` 도 함께 본다.
    var selectedVoiceUnavailable: Bool {
        guard draft.playMode != .alarmOnly, voiceSourceMode == .ttsProfile else { return false }
        guard let profileID = (voiceStudio.selectedProfileID).nilIfBlank else { return false }
        // ⚠ **정리 중도 여기서 말한다**(Codex #703 P2). 그 목소리는 목록에 그대로 있고
        // 잠기지도 않아 아래 두 줄로는 걸리지 않는데, 저장은 이미 막혀 있다 — 배너가 없으면
        // 편집기에 **이유 없이 죽은 저장 버튼**만 남는다(선택 시트를 열어 흐린 행을 눌러야
        // 이유가 나온다). 문구는 아래에서 '삭제된 목소리' 와 갈린다.
        if voiceStudio.isReplacementSettling(profileID) { return true }
        guard let option = voiceProfileOptions.first(where: { $0.id == profileID }) else { return true }
        return option.locked
    }

    /// ⚠ **"저장된 목소리는 그대로 울린다" 고 말한다.** 겁주지 않는 것이 핵심이다 — 이미
    /// 저장된 알람은 음원을 갖고 있어 정상적으로 울리고, 막히는 것은 **문구를 바꾸는 것**뿐이다.
    ///
    /// 이 배너가 없던 시절에는 그 사실을 편집기 하단 한 줄("선택한 목소리를 쓸 수 없어요")이
    /// 말했는데, 그건 **저장이 막힌 이유**를 말하는 자리라 성격이 달랐고 무엇보다
    /// "쓸 수 없다" 로만 읽혀 **울리지도 않는 줄 알게** 했다. 안드로이드는 처음부터 값이 사는
    /// 자리(목소리 카드) 아래 배너로 말한다 — 그쪽에 맞춘다.
    @ViewBuilder
    var unusableVoiceBanner: some View {
        if selectedVoiceUnavailable {
            // ⚠ **정리 중과 삭제됨을 가른다**(Codex #703 P1). 곧 풀리는 상태를 "삭제된 목소리"
            // 라고 하면 사용자가 목소리를 잃은 줄 알고 다시 만든다(월 1회 한도가 걸린다).
            let settling = (voiceStudio.selectedProfileID).nilIfBlank
                .map { voiceStudio.isReplacementSettling($0) } ?? false
            VStack(alignment: .leading, spacing: 4) {
                Text(settling ? "아직 준비 중이에요" : "삭제된 목소리")
                    .font(theme.typography.bodyMedium.weight(.semibold))
                    .foregroundStyle(theme.palette.onErrorContainer)
                Text(settling
                     ? "바꾼 목소리를 정리하고 있어요. 잠시 후 다시 저장해 주세요."
                     : "이 알람에 저장된 목소리는 그대로 울리지만, 문구를 바꾸려면 다른 목소리를 선택해 주세요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onErrorContainer.opacity(0.78))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                theme.palette.errorContainer.opacity(0.58),
                in: RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small, style: .continuous)
            )
        }
    }

    @ViewBuilder
    var alarmModeSection: some View {
            // 제목은 **'재생 방식'** 이다 — 안드로이드 `editor_play_mode_title` 과 같은
            // 말로 맞춘다('알람 방식' 은 iOS 에만 있던 표현이었다).
            EditorSectionTitle(text: "재생 방식")
            Group {
                VoicePlayModePicker(
                    mode: $draft.playMode,
                    voiceLocked: voiceModeBlocked,
                    onLockedVoiceClick: showVoicePlanLockedAlert
                )
                    .onChange(of: draft.playMode) { _, newMode in
                        voiceStudio.preparedAlarm = nil
                        if newMode == .alarmOnly {
                            draft.voiceRepeat = true
                            draft.voiceVolumePercent = 100
                        } else {
                            selectDefaultVoiceProfileIfNeeded()
                            // 무료 등급은 음성 모드 진입 시 4-값 잠금을 재확인한다.
                            coerceFreeVoiceTierConstraints()
                        }
                    }

                if draft.playMode != .alarmOnly {
                    // ⚠ **'목소리 / 녹음·파일' 세그먼트를 되살리지 말 것.** 안드로이드에는
                    // 그런 세그먼트가 없다 — '직접 녹음' 은 목소리 목록의 **마지막 항목**이다
                    // (`VoiceAudioCard.kt` 의 `options = profileOptions + recordingOption`).
                    // 세그먼트로 두면 같은 질문("이 알람은 무엇으로 울리나")에 컨트롤이 둘이
                    // 되고, 목소리를 고르러 왔는데 먼저 갈래를 정하라는 단계가 하나 늘어난다.
                    //
                    // ⚠ **행은 카드 안에 있다.** 안드로이드도 선택 행을 `WakerCardShape`
                    // 서피스로 감싼다 — 카드 밖에 두면 편집기에서 이 행만 배경 없이 떠 있다.
                    EditorCard(verticalPadding: 0) {
                        AlarmSettingRow(
                            title: "목소리",
                            subtitle: voiceRowSubtitle,
                            onTap: { voiceSheetOpen = true }
                        )
                        // 화면 순회 캡처가 하단 탭바의 '목소리' 와 헷갈리지 않게 하는 식별자.
                        .accessibilityIdentifier("editor.voiceRow")
                    }

                    unusableVoiceBanner

                    if voiceSourceMode == .ttsProfile {
                        // ⚠ **여기에 미리듣기 칩을 다시 넣지 말 것**(2026-08-12 지시로 제거).
                        // 고른 목소리·문구로 음원을 **미리 만들어** 재생 버튼과 문구를 띄우던
                        // 자리다. 두 가지가 문제였다:
                        //  1. 안드로이드에 대응물이 없다 — iOS 만의 UI 였다.
                        //  2. 그 준비 결과가 곧 '무엇을 골랐는가' 였다. 그래서 회선이 느리거나
                        //     끊기면 고른 테마가 화면에서 사라지고 "불러오는 중이에요" 로 보였다.
                        // 지금은 선택이 값 하나(`selectedBucketDraft`)이고 음원은 저장할 때
                        // 받는다. 저장 버튼이 그동안 '저장 중…' 을 보여준다.

                        // ⚠ '음성 탭에서 만들기' 버튼을 상시로 두지 않는다 — 목소리가 이미
                        // 있는 사람에게는 매번 다른 탭으로 보내는 버튼이 편집기에 남는다.
                        // 고를 목소리가 하나도 없을 때만 낸다.
                        // ⚠ 여기는 **`isRefreshing`** 이다(쓰기 플래그 `isBusy` 가 아니다).
                        // 목록을 아직 불러오는 중에 "없음" 으로 단정해 버튼을 내면 안 된다 —
                        // 목소리가 있는 사람에게 잠깐 깜빡였다가 사라진다.
                        if voiceProfileOptions.isEmpty && !voiceStudio.isRefreshing {
                            Button {
                                onJumpToVoices()
                            } label: {
                                Label("목소리 탭에서 만들기", systemImage: "waveform")
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    if voiceSourceMode == .ttsProfile {
                        // ⚠ **문구와 목소리 크기는 한 카드에 구분선으로 묶는다.**
                        // 안드로이드 `VoiceAudioCard` 가 그렇다("문구·목소리 크기를 하나의
                        // 카드+구분선으로 묶는다"). 따로 떼면 배경 없는 행이 편집기에
                        // 떠 있고, 카드 경계가 화면마다 달라진다.
                        //
                        // ⚠ **버킷 안의 개별 문구를 노출하지 말 것.** 예전 iOS 는 스톡
                        // 클립 본문을 최대 3줄씩 행으로 나열했는데(`StockClipPicker`),
                        // 그러면 매일 도는 회전 클립 중 하나를 '고른 문구' 로 오해하게
                        // 된다. 안드로이드는 테마만 고르고 클립은 알람마다 순차 회전한다.
                        //
                        // ⚠ **'랜덤 문구 사용' 토글 + 컨텍스트 드롭다운으로 되돌리지 말 것.**
                        // 그 구조에는 '직접 입력' 이 들어갈 자리가 없다 — 토글을 꺼야
                        // 나오는 숨은 상태가 된다. 안드로이드는 여섯 갈래(기본 인사말·
                        // 날씨·운세·사랑·약·직접 입력)를 한 목록에 같은 층위로 두고,
                        // 요약 행을 눌러 그 화면으로 들어간다.
                        // ⚠ **행은 하나다**(2026-09-02). 유료·무료가 같은 문구 목록을 쓰므로
                        // 요약 행도 갈리지 않는다 — 갈라 두면 같은 상태를 두 곳이 다르게
                        // 읽는 사고가 반복된다(안드로이드 `MessageModeSummaryRow` 와 같다).
                        EditorCard(verticalPadding: 0) {
                            MessageModeSummaryRow(
                                context: currentMessageContext,
                                weatherCity: voiceStudio.weatherCity,
                                // 고른 것도 없고 문구도 없다 = 아직 아무것도 정해지지 않았다.
                                nothingChosenYet: usesStockClips
                                    && selectedFreeBucket == nil
                                    && (voiceStudio.ttsText).nilIfBlank == nil,
                                onTap: { messagePaneOpen = true }
                            )
                            AlarmSettingDivider()
                            voiceVolumeRow
                        }

                        // ⚠ **"무료에서는 …" 안내를 두지 않는다**(2026-08-11 요청). 무엇이
                        // 막혔는지는 잠긴 행을 눌렀을 때 게이트가 말한다 — 카드에 미리 깔아
                        // 두면 알람을 만들 때마다 "너는 무료다" 를 읽게 된다.
                        //
                        // ⚠ **"기본 목소리는 준비된 문구로만" 안내도 지웠다**(2026-09-02).
                        // 유료 사용자는 기본 목소리로도 직접 입력을 쓸 수 있고(`manualLocked`
                        // 은 무료 단독), 문구 목록도 이제 같다 — 그 안내는 사실이 아니었다.
                    } else {
                        LocalAlarmAudioEditor(
                            mode: $localAudioMode,
                            isRecording: localRecorder.isRecording,
                            elapsedMs: Int(localRecorder.elapsedSeconds * 1000),
                            hasRecording: localRecorder.latestRecordingURL != nil,
                            existingAudioLabel: existingLocalAudioLabel,
                            fileName: selectedLocalAudioName,
                            fileDurationMs: selectedLocalAudioDurationMs,
                            cropStartMs: $localAudioCropStartMs,
                            cropEndMs: $localAudioCropEndMs,
                            isPreviewing: editorPreviewPlayer.isPlaying &&
                                (previewTarget == .selectedCrop || previewTarget == .cachedLocalAudio),
                            message: localAudioMessage,
                            onModeChange: handleLocalAudioModeChange,
                            onRecord: toggleLocalRecording,
                            onPreview: previewLocalAlarmAudio,
                            onClear: clearLocalAlarmAudio
                        )
                        // 녹음 모드에도 목소리 크기를 녹음 박스 바로 아래에 둔다(안드로이드와 같다).
                        EditorCard(verticalPadding: 0) { voiceVolumeRow }
                    }

                    // ⚠ **'반복 재생' 세그먼트와 음량 슬라이더를 본문에 다시 펼치지 말 것.**
                    // 둘 다 '목소리 크기' 행이 여는 상세(`VoiceOutputSettingsPane`) 안에 있다.
                    // 예전 iOS 는 본문에 인라인으로 두고 **세부 설정에도 '음성 출력' 행**을
                    // 둬서, 같은 값을 바꾸는 자리가 셋이었다.
                }
            }
    }

    /// 목소리 크기 요약 행 — 누르면 음량·반복을 함께 다루는 상세로 간다.
    /// 안드로이드 `VoiceVolumeSummaryRow`.
    @ViewBuilder
    private var voiceVolumeRow: some View {
        AlarmSettingRow(
            title: "목소리 크기",
            subtitle: "\(draft.voiceVolumePercent)%",
            onTap: { settingsPane = .voiceOutput }
        )
    }
}
