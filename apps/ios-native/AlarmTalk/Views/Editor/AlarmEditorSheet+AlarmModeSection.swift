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

                    if voiceSourceMode == .ttsProfile {
                        preparedVoiceChip

                        // ⚠ '음성 탭에서 만들기' 버튼을 상시로 두지 않는다 — 목소리가 이미
                        // 있는 사람에게는 매번 다른 탭으로 보내는 버튼이 편집기에 남는다.
                        // 고를 목소리가 하나도 없을 때만 낸다.
                        if voiceProfileOptions.isEmpty && !voiceStudio.isBusy {
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
                        EditorCard(verticalPadding: 0) {
                            if restrictToWeatherMedication {
                                FreeThemeSummaryRow(
                                    selectedBucket: selectedFreeBucket,
                                    weatherCity: voiceStudio.weatherCity,
                                    onTap: { freeBucketPaneOpen = true }
                                )
                            } else {
                                MessageModeSummaryRow(
                                    context: currentMessageContext,
                                    manualText: voiceStudio.ttsText,
                                    onTap: { messagePaneOpen = true }
                                )
                            }
                            AlarmSettingDivider()
                            voiceVolumeRow
                        }

                        if restrictToWeatherMedication {
                            // 무료라서 막힌 것과 기본 목소리라서 막힌 것은 **다른 사실**이다.
                            // 유료에게 '무료에서는…' 이라고 하면 거짓말이 된다.
                            Text(
                                freeVoiceTier
                                    ? "무료에서는 시스템 목소리와 기본 랜덤 문구로 깨워드려요."
                                    : "기본 목소리는 준비된 문구로만 말할 수 있어요. 직접 입력하려면 내 목소리를 골라 주세요."
                            )
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
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
