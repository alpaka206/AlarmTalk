import SwiftUI

// AlarmEditorSheet 의 '알람 방식' 섹션 분리(파일 길이 축소). 동작/디자인 불변.
extension AlarmEditorSheet {
    var alarmModeSection: some View {
            Section("알람 방식") {
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
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

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
                        VStack(alignment: .leading, spacing: 8) {
                            Text("목소리")
                                .font(theme.typography.titleSmall)
                            AlarmVoiceProfilePicker(
                                ownProfiles: voiceStudio.profiles,
                                familyVoices: voiceStudio.familyVoices,
                                selectedProfileID: voiceStudio.selectedProfileID,
                                loading: voiceStudio.isBusy,
                                onSelectOwn: { profile in
                                    // 무료 등급은 시스템 보이스만 허용한다(서버 tts.ts:684-693).
                                    // 비-시스템 목소리 선택은 유료 잠금으로 안내해 generateTTS
                                    // 403(VOICE_FEATURE_REQUIRES_PAID_PLAN)을 미연에 막는다
                                    // (Android `VoiceAudioCard.kt` onLockedFeature 게이팅 미러).
                                    if freeVoiceTier && !isSystemVoiceId(profile.id) {
                                        showVoicePlanLockedAlert()
                                        return
                                    }
                                    voiceStudio.selectedProfileID = profile.id
                                    voiceStudio.preparedAlarm = nil
                                },
                                onSelectShared: { profile in
                                    // 공유/가족 목소리는 비-시스템이므로 무료 등급에선 선택을
                                    // 막고 유료 잠금으로 안내한다 (행은 숨기지 않고 선택만 게이트).
                                    if freeVoiceTier && !isSystemVoiceId(profile.id) {
                                        showVoicePlanLockedAlert()
                                        return
                                    }
                                    if profile.requiresViewerInfo {
                                        sharedVoiceSetupTarget = profile
                                    } else {
                                        voiceStudio.selectedProfileID = profile.id
                                        voiceStudio.preparedAlarm = nil
                                    }
                                }
                            )
                            preparedVoiceChip
                            Button {
                                onJumpToVoices()
                            } label: {
                                Label("음성 탭에서 만들기", systemImage: "waveform")
                            }
                            .buttonStyle(.bordered)
                        }

                        // 무료 등급 + 시스템(스톡) 보이스 선택 시에만 기본 제공 음성
                        // 목록을 노출한다 (Android `VoiceAudioCard.kt:195` freeVoiceTier
                        // gate + `if (!isSystemVoice) return` 미러). greeting 카테고리는
                        // 제외하고 선택 프로필로 스코프한다.
                        if freeVoiceTier && isSystemVoiceId(voiceStudio.selectedProfileID) {
                            StockClipPicker(
                                clips: voiceStudio.stockClips.filter {
                                    $0.voiceProfileId == voiceStudio.selectedProfileID &&
                                        $0.category != StockClipPicker.greetingCategory
                                },
                                selectedMessageID: selectedStockMessageID,
                                // 재생이 끝나면 play 아이콘으로 되돌아가도록 실제
                                // 재생 중일 때만 previewing id 를 전달한다.
                                previewingMessageID: editorPreviewPlayer.isPlaying ? previewingStockClipID : nil,
                                // 다운로드 중인 클립에는 스피너를 띄운다(change 2).
                                preparingMessageID: editorPreviewPlayer.isPreparing ? previewingStockClipID : nil,
                                onPreview: { clip in Task { await previewStockClip(clip) } },
                                onSelect: { clip in Task { await selectStockClip(clip) } }
                            )
                        }

                        Toggle("랜덤 문구 사용", isOn: Binding(
                            get: { voiceStudio.randomPrompt },
                            set: { enabled in
                                // 무료 등급은 직접 문구가 유료라서 랜덤 OFF 를 막고
                                // 잠금 안내 후 켜진 상태를 유지한다 (Android `VoiceAudioCard.kt:245-247`).
                                if freeVoiceTier && !enabled {
                                    showVoicePlanLockedAlert()
                                    return
                                }
                                voiceStudio.randomPrompt = enabled
                                voiceStudio.preparedAlarm = nil
                                if !enabled && !voiceStudio.translateText {
                                    voiceStudio.ttsLanguage = "ko"
                                }
                            }
                        ))
                            .tint(theme.palette.primary)
                        if voiceStudio.randomPrompt {
                            // 무료 등급은 preset 컨텍스트로 고정 — 컨텍스트/언어/날씨·운세
                            // 맞춤(유료)을 숨긴다 (Android `VoiceAudioCard.kt:279`).
                            if freeVoiceTier {
                                Text("무료에서는 시스템 목소리와 기본 랜덤 문구로 깨워드려요.")
                                    .font(theme.typography.bodySmall)
                                    .foregroundStyle(theme.palette.onSurfaceVariant)
                            } else {
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
                            // 컨텍스트별 안내 문구 (Android `AlarmRandomPromptSettings.kt:299-324`
                            // RandomPromptContextDescription 미러). 선택한 상황마다 톤·내용을 한 줄로 설명한다.
                            Text(activePromptContext.contextDescription)
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
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
                            } // end !freeVoiceTier (preset 컨텍스트 고정)
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
        case .meal: return "끼니를 챙기도록 다정하게 권해요."
        case .sleep: return "잠들기 좋게 차분한 톤으로 말해요."
        case .exercise: return "활기차게 몸을 움직이도록 응원해요."
        case .love: return "사랑이 담긴 다정한 한마디를 건네요."
        }
    }
}
