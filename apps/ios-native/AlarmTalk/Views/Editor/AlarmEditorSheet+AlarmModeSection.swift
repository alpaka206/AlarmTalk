import SwiftUI

// AlarmEditorSheet 의 '재생 방식' 섹션 분리(파일 길이 축소).
extension AlarmEditorSheet {
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
                    Picker("음성 소스", selection: Binding(
                        get: { voiceSourceMode },
                        set: { newValue in
                            // 무료 등급은 녹음/파일이 유료라서 .localAudio 선택을 막고
                            // 잠금 안내 후 .ttsProfile 을 유지한다 (Android `VoiceAudioCard.kt:142-145`).
                            if freeVoiceTier && newValue == .localAudio {
                                showVoicePlanLockedAlert()
                                return
                            }
                            voiceSourceMode = newValue
                        }
                    )) {
                        Text("목소리").tag(VoiceSource.ttsProfile)
                        Text("녹음/파일").tag(VoiceSource.localAudio)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityLabel(Text("음성 소스"))
                    .onChange(of: voiceSourceMode) { _, newValue in
                        voiceStudio.preparedAlarm = nil
                        stopAllEditorPreviews()
                        if newValue == .ttsProfile {
                            localRecorder.stop()
                        }
                    }

                    if voiceSourceMode == .ttsProfile {
                        // ⚠ **인라인 목록으로 되돌리지 말 것.** 요약 행 하나가 지금 값을
                        // 말하고, 바꿀 때만 시트를 연다(안드로이드 `VoiceAudioCard.kt:500-547`).
                        // 시트 안에서는 행마다 '들어보기' 가 있다 — 고르려면 먼저 들어봐야
                        // 하는데, iOS 편집기에는 미리 들을 방법이 아예 없었다.
                        AlarmSettingRow(
                            title: "목소리",
                            subtitle: selectedVoiceName ?? "고르기",
                            onTap: { voiceSheetOpen = true }
                        )

                        preparedVoiceChip

                        // ⚠ '음성 탭에서 만들기' 버튼을 상시로 두지 않는다 — 목소리가 이미
                        // 있는 사람에게는 매번 다른 탭으로 보내는 버튼이 편집기에 남는다.
                        // 고를 목소리가 하나도 없을 때만 낸다.
                        if voiceOptions.isEmpty && !voiceStudio.isBusy {
                            Button {
                                onJumpToVoices()
                            } label: {
                                Label("목소리 탭에서 만들기", systemImage: "waveform")
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    if voiceSourceMode == .ttsProfile {
                        // 무료 등급은 **테마(버킷)** 를 고른다 — 약 / 날씨.
                        //
                        // ⚠ **버킷 안의 개별 문구를 노출하지 말 것.** 예전 iOS 는 스톡
                        // 클립 본문을 최대 3줄씩 행으로 나열했는데(`StockClipPicker`),
                        // 그러면 매일 도는 회전 클립 중 하나를 '고른 문구' 로 오해하게
                        // 된다. 안드로이드는 테마만 고르고 클립은 알람마다 순차 회전한다.
                        if freeVoiceTier && voiceStudio.isSystemVoiceProfile(id: voiceStudio.selectedProfileID) {
                            FreeThemeSummaryRow(
                                selectedBucket: selectedFreeBucket,
                                weatherCity: voiceStudio.weatherCity,
                                onTap: { freeBucketPaneOpen = true }
                            )
                        }

                        // ⚠ **'랜덤 문구 사용' 토글 + 컨텍스트 드롭다운으로 되돌리지 말 것.**
                        // 그 구조에는 '직접 입력' 이 들어갈 자리가 없다 — 토글을 꺼야
                        // 나오는 숨은 상태가 된다. 안드로이드는 여섯 갈래(기본 인사말·
                        // 날씨·운세·사랑·약·직접 입력)를 한 목록에 같은 층위로 두고,
                        // 요약 행을 눌러 그 화면으로 들어간다.
                        if freeVoiceTier {
                            Text("무료에서는 시스템 목소리와 기본 랜덤 문구로 깨워드려요.")
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                        } else {
                            MessageModeSummaryRow(
                                context: currentMessageContext,
                                manualText: voiceStudio.ttsText,
                                onTap: { messagePaneOpen = true }
                            )
                        }
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
                            onPickFile: { localAudioFileImporterPresented = true },
                            onPreview: previewLocalAlarmAudio,
                            onClear: clearLocalAlarmAudio
                        )
                    }

                    if draft.playMode == .voiceOnly {
                        VoiceRepeatEditor(isRepeating: $draft.voiceRepeat)
                    }
                    VoiceVolumeEditor(volumePercent: $draft.voiceVolumePercent)
                }
            }
    }
}

// MARK: - Random prompt context descriptions

extension RandomPromptContext {
    /// 컨텍스트별 한 줄 안내. Android `strings.xml` 의
    /// `editorp_random_context_desc_*` 와 1:1 일치 (AlarmRandomPromptSettings.kt:315-324).
    var contextDescription: String {
        switch self {
        case .preset: return "추가 입력 없이 바로 쓰는 기본 인사예요."
        case .wakeWeather: return "오늘 날씨를 알려주고 옷차림을 권해요."
        case .wakeFortune: return "가벼운 오늘의 운세를 곁들여요."
        case .love: return "사랑이 담긴 다정한 한마디를 건네요."
        case .medication: return "약 챙겨 먹도록 잊지 않게 말해 줘요."
        }
    }
}
