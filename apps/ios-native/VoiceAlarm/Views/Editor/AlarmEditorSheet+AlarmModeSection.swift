import SwiftUI

// AlarmEditorSheet 의 '알람 방식' 섹션 분리(파일 길이 축소). 동작/디자인 불변.
extension AlarmEditorSheet {
    var alarmModeSection: some View {
            Section("알람 방식") {
                VoicePlayModePicker(
                    mode: $draft.playMode,
                    voiceLocked: voicePlanLocked,
                    onLockedVoiceClick: showVoicePlanLockedAlert
                )
                    .onChange(of: draft.playMode) { _, newMode in
                        voiceStudio.preparedAlarm = nil
                        if newMode == .alarmOnly {
                            draft.voiceRepeat = true
                            draft.voiceVolumePercent = 100
                        } else {
                            selectDefaultVoiceProfileIfNeeded()
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

                if draft.playMode != .alarmOnly {
                    Picker("음성 소스", selection: $voiceSourceMode) {
                        Text("목소리").tag(VoiceSource.ttsProfile)
                        Text("녹음/파일").tag(VoiceSource.localAudio)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: voiceSourceMode) { _, newValue in
                        voiceStudio.preparedAlarm = nil
                        localPreviewPlayer.stop()
                        if newValue == .ttsProfile {
                            localRecorder.stop()
                        }
                    }

                    if voiceSourceMode == .ttsProfile {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("목소리")
                                .font(theme.typography.titleSmall)
                            AlarmVoiceProfilePicker(
                                ownProfiles: voiceStudio.profiles,
                                familyVoices: voiceStudio.familyVoices,
                                selectedProfileID: voiceStudio.selectedProfileID,
                                onSelectOwn: { profile in
                                    voiceStudio.selectedProfileID = profile.id
                                    voiceStudio.preparedAlarm = nil
                                },
                                onSelectShared: { profile in
                                    if profile.requiresViewerInfo {
                                        sharedVoiceSetupTarget = profile
                                    } else {
                                        voiceStudio.selectedProfileID = profile.id
                                        voiceStudio.preparedAlarm = nil
                                    }
                                }
                            )
                            Text(preparedVoiceLabel)
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                            Button {
                                onJumpToVoices()
                            } label: {
                                Label("음성 탭에서 만들기", systemImage: "waveform")
                            }
                            .buttonStyle(.bordered)
                        }

                        Toggle("랜덤 문구 사용", isOn: Binding(
                            get: { voiceStudio.randomPrompt },
                            set: { enabled in
                                voiceStudio.randomPrompt = enabled
                                voiceStudio.preparedAlarm = nil
                                if !enabled && !voiceStudio.translateText {
                                    voiceStudio.ttsLanguage = "ko"
                                }
                            }
                        ))
                            .tint(theme.palette.primary)
                        if voiceStudio.randomPrompt {
                            Picker("랜덤 컨텍스트", selection: $voiceStudio.randomContext) {
                                ForEach(RandomPromptContext.alarmEditorCases, id: \.rawValue) { context in
                                    Text(context.label).tag(context.rawValue)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: voiceStudio.randomContext) { _, _ in
                                voiceStudio.preparedAlarm = nil
                            }
                            Picker("언어", selection: $voiceStudio.ttsLanguage) {
                                ForEach(ttsLanguages, id: \.code) { option in
                                    Text(option.label).tag(option.code)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: voiceStudio.ttsLanguage) { _, _ in
                                voiceStudio.preparedAlarm = nil
                            }
                            Text("선택한 상황에 맞춰 깨움말을 자동으로 만들어요.")
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                            if activePromptContext.usesWeather {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("날씨 지역")
                                        .font(theme.typography.titleSmall)
                                    WeatherLocationInputFields(
                                        country: $voiceStudio.weatherCountry,
                                        city: $voiceStudio.weatherCity,
                                        helperText: "날씨가 들어간 깨움말에 사용할 지역이에요."
                                    )
                                    if !voiceStudio.hasWeatherInfo || targetWeatherReady {
                                        Text(targetWeatherReady ? "상대가 저장한 날씨 지역을 사용해요." : "날씨가 들어간 문구를 쓰려면 지역을 입력해 주세요.")
                                            .font(theme.typography.bodySmall)
                                            .foregroundStyle(theme.palette.onSurfaceVariant)
                                    }
                                }
                                .padding(.top, 4)
                            }
                            if activePromptContext.usesFortune {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("운세 정보")
                                        .font(theme.typography.titleSmall)
                                    FortunePromptInputFields(
                                        gender: $voiceStudio.fortuneGender,
                                        birthDate: $voiceStudio.fortuneBirthDate,
                                        birthTime: $voiceStudio.fortuneBirthTime,
                                        helperText: "운세가 들어간 깨움말을 만들 때만 사용해요."
                                    )
                                    if !voiceStudio.hasFortuneInfo || targetFortuneReady {
                                        Text(targetFortuneReady ? "상대가 저장한 운세 정보를 사용해요." : "운세가 들어간 문구를 쓰려면 성별, 생년월일, 태어난 시간이 필요해요.")
                                            .font(theme.typography.bodySmall)
                                            .foregroundStyle(theme.palette.onSurfaceVariant)
                                    }
                                }
                                .padding(.top, 4)
                            }
                        } else {
                            ManualVoiceMessageEditor(
                                text: $voiceStudio.ttsText,
                                translationEnabled: $voiceStudio.translateText,
                                language: $voiceStudio.ttsLanguage,
                                onInvalidatePreparedAudio: { voiceStudio.preparedAlarm = nil }
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
                            isPreviewing: localPreviewPlayer.isPlaying,
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
