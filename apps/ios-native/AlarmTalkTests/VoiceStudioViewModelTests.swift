import XCTest
@testable import AlarmTalk

@MainActor
final class VoiceStudioViewModelTests: XCTestCase {

    // MARK: - errorCode 매핑

    func test_localizedVoiceMessage_VOICE_SLOT_EXHAUSTED() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_SLOT_EXHAUSTED"),
            "지금은 목소리 생성 요청이 많아요. 잠시 후 다시 시도해 주세요."
        )
    }

    func test_localizedVoiceMessage_VOICE_FEATURE_REQUIRES_PAID_PLAN() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_FEATURE_REQUIRES_PAID_PLAN"),
            // 리터럴을 다시 박지 말 것 — 유료 게이트 문구는 `PaidGateCopy` 가 유일 출처다.
            // 예전에는 여기 옛 문장이 박혀 있어, 문구를 통일한 뒤 테스트만 빨갛게 남았다.
            PaidGateCopy.message
        )
    }

    func test_localizedVoiceMessage_VOICE_CLONE_AUDIO_TOO_SHORT() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_CLONE_AUDIO_TOO_SHORT"),
            "목소리를 만들 음성은 12초 이상이어야 해요."
        )
    }

    func test_localizedVoiceMessage_VOICE_CLONE_AUDIO_TOO_LONG() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_CLONE_AUDIO_TOO_LONG"),
            "목소리를 만들 음성은 2분 이하로 준비해 주세요."
        )
    }

    func test_localizedVoiceMessage_INVALID_DURATION() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "INVALID_DURATION"),
            "음성 길이를 확인하지 못했어요. 파일을 다시 선택해 주세요."
        )
    }

    /// ⚠ 이 테스트는 **틀린 문구를 지키고 있었다**(2026-09-07 정정).
    /// `VOICE_LIMIT_REACHED` 는 서버에서 "최대 N개까지 등록 가능합니다" — **등록 슬롯**이
    /// 다 찼다는 뜻이지 월 한도가 아니다(`routes/voice-profile.ts`). '다음 달이면 풀린다'
    /// 고 읽히는 문구는 사용자를 다음 달까지 기다리게 만든다. 안드로이드
    /// `api_error_voice_limit_reached` 와 같은 말이어야 한다.
    func test_localizedVoiceMessage_VOICE_LIMIT_REACHED() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_LIMIT_REACHED"),
            "등록할 수 있는 목소리를 다 채웠어요. 쓰지 않는 목소리를 지워 주세요."
        )
    }

    /// 목소리 화면이 맡지 않은 코드는 공용 표(`APIErrorMessages`)가 받는다.
    func test_localizedVoiceMessage_fallsBackToSharedTable() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "RATE_LIMITED"),
            "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."
        )
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "ALARM_NOT_FOUND"),
            "이미 사라진 알람이에요."
        )
    }

    /// 목소리 높이 두 코드(등록 확정 — 스펙 voice-and-message §4-3)는 공용 표가 받는다. 본문에만 코드가 실린 응답도
    /// 찾는다(`knownErrorCodes`). 문구는 화면 이름(`톤 조절`)을 따라 '톤' 이다.
    func test_localizedVoiceMessage_voicePitchCodes() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "INVALID_VOICE_PITCH"),
            "톤 값이 올바르지 않아요. 다시 맞춰 주세요."
        )
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_PITCH_LOCKED"),
            "톤은 목소리를 등록할 때만 정할 수 있어요."
        )
        let err = APIError.server(status: 409, message: "VOICE_PITCH_LOCKED: pitch is fixed", errorCode: nil)
        XCTAssertEqual(VoiceStudioViewModel().mapVoiceError(err), "톤은 목소리를 등록할 때만 정할 수 있어요.")
    }

    /// 공용 표는 **모르는 코드에 문구를 지어내지 않는다** — nil 을 주고 화면이 폴백을 쓴다.
    func test_apiErrorMessages_unknownCodeIsNil() {
        XCTAssertNil(APIErrorMessages.message(for: "MYSTERY_CODE"))
        XCTAssertNil(APIErrorMessages.message(for: nil))
    }

    func test_localizedVoiceMessage_VOICE_PROFILE_NOT_FOUND() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_PROFILE_NOT_FOUND"),
            "목소리를 찾지 못했어요. 새로고침 후 다시 시도해 주세요."
        )
    }

    func test_localizedVoiceMessage_unknownCodeUsesFallback() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "MYSTERY_CODE"),
            "목소리를 처리하지 못했어요. 잠시 후 다시 시도해 주세요."
        )
    }

    // MARK: - APIError.server -> mapVoiceError

    func test_mapVoiceError_picksUpServerErrorCode() {
        let vm = VoiceStudioViewModel()
        let err = APIError.server(status: 403, message: "Voice features require a paid plan.", errorCode: "VOICE_FEATURE_REQUIRES_PAID_PLAN")
        XCTAssertEqual(vm.mapVoiceError(err), PaidGateCopy.message)
    }

    func test_mapVoiceError_jsonInMessageFallback() {
        let vm = VoiceStudioViewModel()
        // server 응답 message 안에 raw JSON 이 박힌 경우.
        let raw = "{\"error\":\"slot\",\"error_code\":\"VOICE_SLOT_EXHAUSTED\"}"
        let err = APIError.server(status: 403, message: raw, errorCode: nil)
        XCTAssertEqual(
            vm.mapVoiceError(err),
            "지금은 목소리 생성 요청이 많아요. 잠시 후 다시 시도해 주세요."
        )
    }

    func test_mapVoiceError_keywordFallback() {
        let vm = VoiceStudioViewModel()
        // JSON 디코드 실패하지만 message 안에 known code substring 이 있는 경우.
        let err = APIError.server(status: 400, message: "raw: VOICE_PROFILE_NOT_FOUND detected", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "목소리를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.")
    }

    func test_mapVoiceError_genericServer500() {
        let vm = VoiceStudioViewModel()
        let err = APIError.server(status: 500, message: "internal", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.")
    }

    func test_mapVoiceError_nonKoreanServerMessageUsesFallback() {
        let vm = VoiceStudioViewModel()
        let err = APIError.server(status: 400, message: "durationMs must be a positive integer", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "처리 중 오류가 발생했어요.")
    }

    func test_mapVoiceError_koreanServerMessageUsesFallback() {
        let vm = VoiceStudioViewModel()
        let err = APIError.server(status: 400, message: "음성 길이를 확인하지 못했어요.", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "처리 중 오류가 발생했어요.")
    }

    func test_mapVoiceError_koreanForbiddenServerMessageUsesFallback() {
        let vm = VoiceStudioViewModel()
        // 코드가 없으면 상태별 화면 폴백을 쓴다.
        let err = APIError.server(status: 403, message: "유료 이용권에서 사용할 수 있어요.", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "권한이 없어요. 로그인 상태를 확인해 주세요.")
    }

    func test_mapVoiceError_unauthorized() {
        let vm = VoiceStudioViewModel()
        let err = APIError.server(status: 401, message: "no token", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "권한이 없어요. 로그인 상태를 확인해 주세요.")
    }

    func test_mapVoiceError_urlError() {
        let vm = VoiceStudioViewModel()
        let err = URLError(.notConnectedToInternet)
        XCTAssertEqual(vm.mapVoiceError(err), "네트워크가 불안정해요. 잠시 후 다시 시도해 주세요.")
    }

    func test_mapVoiceError_recorderError() {
        let vm = VoiceStudioViewModel()
        XCTAssertEqual(
            vm.mapVoiceError(VoiceRecorderError.microphoneDenied),
            VoiceRecorderError.microphoneDenied.errorDescription
        )
    }

    func test_mapVoiceError_invalidResponse() {
        let vm = VoiceStudioViewModel()
        XCTAssertEqual(
            vm.mapVoiceError(APIError.invalidResponse),
            "서버 응답을 해석하지 못했어요."
        )
    }

    // MARK: - VoiceProfileLimits

    func test_profileLimits_constants() {
        // ⚠ 12초다. 안드로이드(`AlarmAudioStore.kt:33`)·서버(`voice-profile.ts:50`)와 같은 값.
        // 60초는 `POST /voice/upload` 전용 상수(`voice-upload.ts:19`)지 클론 값이 아니다.
        XCTAssertEqual(VoiceProfileLimits.minDurationMs, 12_000)
        XCTAssertEqual(VoiceProfileLimits.maxDurationMs, 120_000)
    }

    func test_dynamicPromptPreferences_trimAndSerializeToSettings() {
        let preferences = DynamicPromptPreferences(
            weatherCountry: " 대한민국 ",
            weatherCity: " 서울 ",
            fortuneGender: " 여성 ",
            fortuneBirthDate: " 1996-05-20 ",
            fortuneBirthTime: " 07:30 "
        )

        let settings = preferences.toSettings()

        XCTAssertEqual(settings.weather.country, "대한민국")
        XCTAssertEqual(settings.weather.city, "서울")
        XCTAssertEqual(settings.fortune.gender, "여성")
        XCTAssertEqual(settings.fortune.birthDate, "1996-05-20")
        XCTAssertEqual(settings.fortune.birthTime, "07:30")
    }

    // MARK: - APIError 보조

    func test_apiError_serverErrorCodeAccessor() {
        let e1 = APIError.server(status: 400, message: "x", errorCode: "VOICE_LIMIT_REACHED")
        XCTAssertEqual(e1.serverErrorCode, "VOICE_LIMIT_REACHED")

        let e2 = APIError.invalidResponse
        XCTAssertNil(e2.serverErrorCode)
    }

    func test_voiceCloneMultipartFields_matchAndroidRequiredParts() {
        let fields = AlarmTalkAPI.voiceCloneMultipartFields(
            name: "  Gia  ",
            durationMs: 60_000,
            relationshipLabel: " granddaughter ",
            listenerTitle: " grandpa "
        )

        XCTAssertEqual(fields["name"], "Gia")
        XCTAssertNil(fields["isShared"], "목소리 공유는 없다 — 공유 선택을 싣지 않는다")
        XCTAssertEqual(fields["durationMs"], "60000")
        XCTAssertEqual(fields["relationshipLabel"], "granddaughter")
        XCTAssertEqual(fields["listenerTitle"], "grandpa")
    }

    func test_voiceCloneMultipartFields_keepOptionalPersonaBlankAndSelectedLanguage() {
        let fields = AlarmTalkAPI.voiceCloneMultipartFields(
            name: "Draft",
            durationMs: 60_000,
            relationshipLabel: nil,
            listenerTitle: "   ",
            language: "ja"
        )

        XCTAssertEqual(fields["relationshipLabel"], "")
        XCTAssertEqual(fields["listenerTitle"], "")
        // ⚠ isDraft 를 **반드시** 보낸다. 예전 주석은 "draft 승격 플로우가 제품에서
        // 사라졌다" 고 적었지만 사실이 아니다 — 서버는 `/voice/draft`, `preview-played`,
        // `preview-text` 라우트를 그대로 갖고 있고(`voice-profile.ts:371,497,550`),
        // 클론 등록도 `isDraft` 를 파싱한다(:1080). 안드로이드도 보낸다. 안 보내면
        // 등록이 곧바로 정식 프로필이 되어 결과를 들어보기도 전에 페르소나가 잠긴다.
        XCTAssertEqual(fields["isDraft"], "true")
        // 사전렌더 언어. 미전송 시 서버가 'ko' 로 폴백해 비-한국어 사용자가 버킷을 못 받는다.
        XCTAssertEqual(fields["language"], "ja")
        // noiseRemoval/noise_removal 필드는 제거됨(Android 도 더는 전송 안 함, 백엔드 무시).
        XCTAssertNil(fields["noiseRemoval"])
        XCTAssertNil(fields["noise_removal"])
        // voiceGender/speechFormality 는 **보내지 않는다** — 마이그레이션 #83 이 두 컬럼을
        // DROP 했고 대체재 speech_style 은 서버가 등록 녹음에서 자동 분석한다.
        // 안드로이드도 보내지 않고 UI 도 없다(VoiceProfileApi.createVoiceClone).
        XCTAssertNil(fields["voiceGender"])
        XCTAssertNil(fields["speechFormality"])
    }

    // MARK: - 목소리의 결(voice_energy) — 보내지 않는다

    /// '목소리 느낌' 선택을 뺐다(2026-09-29 사용자 결정). 클론 요청은 결을 **어떤 이름으로도**
    /// 싣지 않는다 — 서버는 필드가 없으면 등록 녹음 전사로 추정한 말투를 쓴다(예전의 '자동').
    /// 안드로이드 `VoiceCloneRequestTest` 와 짝이다.
    func test_voiceCloneMultipartFields_omitVoiceEnergy() {
        let fields = AlarmTalkAPI.voiceCloneMultipartFields(
            name: "Draft",
            durationMs: 60_000,
            relationshipLabel: "엄마",
            listenerTitle: "우리 딸",
            language: "ko"
        )
        XCTAssertNil(fields["voiceEnergy"])
        XCTAssertNil(fields["voice_energy"])
        // 나머지 페르소나 필드는 그대로다.
        XCTAssertEqual(fields["relationshipLabel"], "엄마")
        XCTAssertEqual(fields["listenerTitle"], "우리 딸")
        XCTAssertEqual(fields["isDraft"], "true")
    }

    /// 등록 확정 바디 — 들은 목소리 높이는 `pitch_semitones` 로 실리고(교체 등록도 같다), 원래 소리(0·nil)면 키가
    /// 아예 없다(높이 이전과 같은 바디, 스펙 voice-and-message §4-3). 실제 요청과 같은 인코더(snake_case)로 본다.
    func test_voiceDraftPromotionBody_carriesPitchOnlyWhenNotZero() throws {
        func json(_ pitch: Double?, replace: Bool = false) throws -> [String: Any] {
            let body = AlarmTalkAPI.voiceDraftPromoteBody(replaceExisting: replace, pitchSemitones: pitch)
            let data = try AlarmTalkAPI.makeJSONEncoder().encode(body)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }

        let tuned = try json(-1.5, replace: true)
        XCTAssertEqual(tuned["pitch_semitones"] as? Double, -1.5)
        XCTAssertEqual(tuned["is_draft"] as? Bool, false)
        XCTAssertEqual(tuned["replace_existing"] as? Bool, true)
        XCTAssertEqual(try json(3)["pitch_semitones"] as? Double, 3)

        XCTAssertEqual(try json(0).keys.sorted(), ["is_draft"])
        XCTAssertEqual(try json(nil).keys.sorted(), ["is_draft"])
    }

    /// 교체는 체크하지 않는다(2026-10-08 사용자 — 스펙 voice-and-message §4-1). 이미 등록된 목소리가 있으면 등록 확정
    /// 화면의 저장은 **언제나** `replace_existing: true` 를 싣고, 없으면 키가 아예 없다. 이 초안·다른 초안·시스템
    /// 목소리·실패한 목소리는 교체 대상이 아니다.
    func test_promotionReplacesWheneverAnOfficialVoiceExists() throws {
        func body(_ profiles: [VoiceProfile]) throws -> [String: Any] {
            let replacing = VoicePreviewConfirmView.replacementTarget(among: profiles, draftID: "draft") != nil
            let request = AlarmTalkAPI.voiceDraftPromoteBody(replaceExisting: replacing, pitchSemitones: -1.5)
            let data = try AlarmTalkAPI.makeJSONEncoder().encode(request)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let draft = VoiceProfile(id: "draft", name: "새 목소리", status: "ready", isDraft: true)
        let system = VoiceProfile(id: "system-mina", name: "미나", status: "ready", isSystem: true)
        let otherDraft = VoiceProfile(id: "draft-2", name: "다른 초안", status: "ready", isDraft: true)
        let failed = VoiceProfile(id: "failed", name: "실패", status: " Failed ")
        let official = VoiceProfile(id: "mom", name: "엄마", status: "ready", isDraft: false)

        XCTAssertEqual(
            VoicePreviewConfirmView.replacementTarget(among: [draft, system, official], draftID: "draft")?.id,
            "mom"
        )
        XCTAssertEqual(try body([draft, system, official])["replace_existing"] as? Bool, true)
        // 상태를 모르는 옛 응답(키 없음)도 등록된 목소리다.
        let legacy = VoiceProfile(id: "legacy", name: "옛 목소리")
        XCTAssertEqual(try body([draft, legacy])["replace_existing"] as? Bool, true)

        XCTAssertNil(VoicePreviewConfirmView.replacementTarget(among: [draft, system, otherDraft, failed], draftID: "draft"))
        XCTAssertNil(try body([draft, system, otherDraft, failed])["replace_existing"])
        XCTAssertNil(try body([])["replace_existing"])
    }

    // MARK: - 월 등록 한도 거절 — 흐름을 끝내고 남은 횟수를 다시 읽는다

    /// 월 한도 거절만 흐름을 끝낸다 — 그 밖의 실패는 등록 창 안에서 말하고 다시 누를 수 있다
    /// (스펙 voice-and-message §4-1 「월 등록 한도」 ③).
    func test_isMonthlyLimitRejection_onlyForTheMonthlyLimitCode() {
        let vm = VoiceStudioViewModel()
        XCTAssertTrue(vm.isMonthlyLimitRejection(
            APIError.server(status: 429, message: "limit", errorCode: "VOICE_MONTHLY_CHANGE_LIMIT_REACHED")
        ))
        // 본문에만 코드가 실린 응답도 같은 갈래다 — 문구를 고를 때와 같은 방법으로 읽는다.
        let inBody = APIError.server(status: 429, message: "VOICE_MONTHLY_CHANGE_LIMIT_REACHED: used", errorCode: nil)
        XCTAssertTrue(vm.isMonthlyLimitRejection(inBody))
        XCTAssertEqual(vm.mapVoiceError(inBody), APIErrorMessages.message(for: "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"))

        let others: [Error] = [
            // 같은 429 라도 기다리면 풀리는 것은 흐름을 끝내지 않는다.
            APIError.server(status: 429, message: "slow down", errorCode: "RATE_LIMITED"),
            APIError.server(status: 503, message: "busy", errorCode: "VOICE_CAPACITY_EXHAUSTED"),
            APIError.server(status: 400, message: "preview", errorCode: "VOICE_PREVIEW_REQUIRED"),
            APIError.server(status: 403, message: "paid", errorCode: "VOICE_FEATURE_REQUIRES_PAID_PLAN"),
            APIError.server(status: 429, message: "Too Many Requests", errorCode: nil),
            APIError.invalidResponse,
            URLError(.timedOut),
        ]
        for error in others {
            XCTAssertFalse(vm.isMonthlyLimitRejection(error), "\(error)")
        }
    }

    /// 서버가 방금 "0" 이라고 말했다 — 화면의 `생성 가능 n/m회` 가 틀렸다는 뜻이다(다른 기기가 먼저
    /// 등록했거나, 조회가 실패해 숫자를 모르던 기기). 다시 읽지 않으면 등록 창이 닫힌 뒤에도
    /// `추가` 가 켜져 있어 같은 거절을 또 받으러 들어간다.
    func test_등록이_월_한도로_거절되면_알릴_것을_적고_남은_횟수를_다시_읽는다() async throws {
        try await withVoiceViewModel(clone: (
            429, #"{"error":"Voice can be changed once a month","error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}"#
        )) { vm, session, audio, quotaCalls in
            // 탭에 들어왔을 때는 1회가 남아 있었다.
            await vm.refresh(session: session, force: true)
            XCTAssertEqual(vm.draftQuota?.registrationRemaining, 1)
            XCTAssertEqual(quotaCalls(), 1)
            XCTAssertFalse(vm.monthlyLimitRejected)

            let created = await vm.cloneAudioForProfile(
                audioFileURL: audio, name: "새 목소리", durationMs: 20_000, session: session
            )

            XCTAssertNil(created)
            XCTAssertTrue(vm.monthlyLimitRejected, "등록 창이 닫힌 뒤 알럿으로 알릴 것이 적히지 않았다")
            XCTAssertEqual(quotaCalls(), 2, "거절을 받고도 남은 횟수를 다시 읽지 않았다")
            XCTAssertEqual(vm.draftQuota?.registrationRemaining, 0, "`추가` 가 켜진 채 남는다")
            XCTAssertNil(vm.statusMessage, "이유는 알럿 하나가 말한다 — 목소리 탭 맨 위에 다른 말로 한 번 더 남기지 않는다")
            XCTAssertFalse(vm.isBusy)

            // 다음 등록을 시작하면 지난 거절은 남지 않는다.
            vm.beginVoiceCreation()
            XCTAssertFalse(vm.monthlyLimitRejected)
        }
    }

    /// 다시 시도할 수 있는 실패는 흐름을 끝내지 않는다 — 이유를 등록 창 안에 세우고 녹음은 그대로 둔다.
    func test_다시_시도할_수_있는_등록_실패는_흐름을_끝내지_않는다() async throws {
        try await withVoiceViewModel(clone: (
            503, #"{"error":"Voice capacity exhausted","error_code":"VOICE_CAPACITY_EXHAUSTED"}"#
        )) { vm, session, audio, quotaCalls in
            let created = await vm.cloneAudioForProfile(
                audioFileURL: audio, name: "새 목소리", durationMs: 20_000, session: session
            )

            XCTAssertNil(created)
            XCTAssertFalse(vm.monthlyLimitRejected)
            XCTAssertEqual(vm.statusMessage, APIErrorMessages.message(for: "VOICE_CAPACITY_EXHAUSTED"))
            XCTAssertEqual(quotaCalls(), 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path), "다시 누를 녹음이 남아 있어야 한다")
            XCTAssertFalse(vm.noSpeechRejected)
            XCTAssertEqual(
                VoiceCloneUploadFlow.submitOutcome(
                    created: created, monthlyLimitRejected: vm.monthlyLimitRejected, noSpeechRejected: vm.noSpeechRejected
                ),
                .details,
                "다시 시도할 수 있는 실패에 창을 닫거나 녹음을 버린다"
            )
            XCTAssertFalse(vm.consumeMonthlyLimitNotice(), "다시 시도할 수 있는 실패에 월 한도 알럿을 띄운다")
        }
    }

    /// 제출 뒤 등록 창이 갈 곳(`VoiceCloneUploadFlow.submitOutcome`) — 순서가 곧 규칙이다. 만든 초안이 있으면
    /// 그것이 이기고(서버가 이번 등록을 받아들였다), 월 한도 거절이면 창을 닫고, 말소리가 없다는 거절이면 녹음을 버리고
    /// 음원 준비로 돌아가고, 그 밖의 실패는 세부 정보로 돌아가 다시 누른다. 월 한도 거절을 세부 정보로 되돌리면 안내
    /// 줄이 빈 채(거절을 받은 쪽이 창이 닫힐 줄 알고 비운다) 살아 있는 `등록` 이 남아, 누를 때마다 같은 429 를 말없이
    /// 받는다. 말소리 거절을 세부 정보로 되돌리면 같은 녹음을 다시 보내 같은 400 을 받는다.
    func test_제출_뒤_갈_곳은_만든_초안_월_한도_거절_말소리_거절_그_밖의_실패_순서로_가른다() {
        let draft = VoiceProfile(id: "draft-1", name: "새 목소리", status: "ready", isDraft: true)
        func outcome(_ created: VoiceProfile?, monthlyLimit: Bool, noSpeech: Bool) -> VoiceCloneUploadFlow.SubmitOutcome {
            VoiceCloneUploadFlow.submitOutcome(created: created, monthlyLimitRejected: monthlyLimit, noSpeechRejected: noSpeech)
        }

        XCTAssertEqual(outcome(draft, monthlyLimit: false, noSpeech: false), .preview("draft-1"))
        XCTAssertEqual(
            outcome(draft, monthlyLimit: true, noSpeech: false), .preview("draft-1"),
            "서버가 받아들인 등록을 한도 표시 때문에 버린다"
        )
        XCTAssertEqual(
            outcome(draft, monthlyLimit: false, noSpeech: true), .preview("draft-1"),
            "서버가 받아들인 등록을 말소리 표시 때문에 버린다"
        )
        XCTAssertEqual(
            outcome(nil, monthlyLimit: true, noSpeech: false), .closeForMonthlyLimit,
            "월 한도 거절에 세부 정보로 돌아가 같은 버튼을 다시 누르게 둔다"
        )
        XCTAssertEqual(
            outcome(nil, monthlyLimit: true, noSpeech: true), .closeForMonthlyLimit,
            "이번 달을 다 썼는데 다시 녹음하라고 한다"
        )
        XCTAssertEqual(
            outcome(nil, monthlyLimit: false, noSpeech: true), .rerecordForNoSpeech,
            "말소리가 없는 녹음을 세부 정보로 돌려 같은 녹음을 다시 보내게 둔다"
        )
        XCTAssertEqual(outcome(nil, monthlyLimit: false, noSpeech: false), .details)
    }

    /// 등록이 월 한도로 거절되면 창을 닫고, 창이 다 내려간 뒤 목소리 탭이 알림을 **한 번만** 꺼낸다
    /// (`consumeMonthlyLimitNotice` — `VoicesPanelView` 의 `fullScreenCover(onDismiss:)` 가 부른다). 꺼내지 못하면
    /// 사용자는 창이 왜 닫혔는지 모르고, 꺼낸 뒤에도 남으면 다음 창 닫힘(성공한 등록 포함)마다 같은 알럿이 뜬다.
    func test_월_한도_거절은_창을_닫고_닫힌_뒤_알림을_한_번만_꺼낸다() async throws {
        try await withVoiceViewModel(clone: (
            429, #"{"error":"Voice can be changed once a month","error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}"#
        )) { vm, session, audio, _ in
            XCTAssertFalse(vm.consumeMonthlyLimitNotice(), "알릴 것이 없는데 알럿을 연다")

            let created = await vm.cloneAudioForProfile(
                audioFileURL: audio, name: "새 목소리", durationMs: 20_000, session: session
            )

            XCTAssertFalse(vm.noSpeechRejected)
            XCTAssertEqual(
                VoiceCloneUploadFlow.submitOutcome(
                    created: created, monthlyLimitRejected: vm.monthlyLimitRejected, noSpeechRejected: vm.noSpeechRejected
                ),
                .closeForMonthlyLimit,
                "월 한도 거절인데 창을 닫지 않는다"
            )
            XCTAssertTrue(vm.consumeMonthlyLimitNotice(), "창이 닫힌 뒤 이유를 말할 알럿이 뜨지 않는다")
            XCTAssertFalse(vm.monthlyLimitRejected)
            XCTAssertFalse(vm.consumeMonthlyLimitNotice(), "꺼낸 알림이 남아 다음 창 닫힘에 같은 알럿이 또 뜬다")
        }
    }

    // MARK: - 말소리가 없는 녹음 — 음원 준비로 돌아가 녹음을 버린다

    /// 서버가 정한 문장(스펙 voice-and-message §4-1) — 두 앱이 같은 말을 쓴다.
    private static let noSpeechSentence =
        "녹음에서 말소리를 거의 찾지 못했어요. 조용한 곳에서 문장을 또렷하게 읽으며 다시 녹음해 주세요."

    private static let noSpeechBody =
        #"{"error":"No speech was found in the recording","error_code":"VOICE_CLONE_NO_SPEECH"}"#

    /// 말소리 거절만 다시 녹음으로 간다. 문구는 공용 표가 고르고(목소리 화면도 같은 문장), 본문에만 코드가 실린 응답도
    /// 같은 갈래다 — 문구를 고를 때와 같은 방법으로 읽는다.
    func test_isNoSpeechRejection_onlyForTheNoSpeechCode() {
        let vm = VoiceStudioViewModel()
        XCTAssertEqual(APIErrorMessages.message(for: "VOICE_CLONE_NO_SPEECH"), Self.noSpeechSentence)
        XCTAssertEqual(VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_CLONE_NO_SPEECH"), Self.noSpeechSentence)

        let rejection = APIError.server(status: 400, message: "No speech", errorCode: "VOICE_CLONE_NO_SPEECH")
        XCTAssertTrue(vm.isNoSpeechRejection(rejection))
        XCTAssertFalse(vm.isMonthlyLimitRejection(rejection), "다시 녹음하면 되는 거절에 흐름을 끝낸다")
        XCTAssertEqual(vm.mapVoiceError(rejection), Self.noSpeechSentence)

        let inBody = APIError.server(status: 400, message: "VOICE_CLONE_NO_SPEECH: transcript too short", errorCode: nil)
        XCTAssertTrue(vm.isNoSpeechRejection(inBody))
        XCTAssertEqual(vm.mapVoiceError(inBody), Self.noSpeechSentence)

        let others: [Error] = [
            // 같은 400 이라도 녹음을 버릴 이유가 아닌 것들.
            APIError.server(status: 400, message: "short", errorCode: "VOICE_CLONE_AUDIO_TOO_SHORT"),
            APIError.server(status: 400, message: "mime", errorCode: "INVALID_AUDIO_MIME_TYPE"),
            APIError.server(status: 502, message: "cloning", errorCode: "VOICE_CLONING_FAILED"),
            APIError.server(status: 429, message: "limit", errorCode: "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"),
            APIError.server(status: 400, message: "Bad Request", errorCode: nil),
            APIError.invalidResponse,
            URLError(.timedOut),
        ]
        for error in others {
            XCTAssertFalse(vm.isNoSpeechRejection(error), "\(error)")
        }
    }

    /// 말소리가 거의 없는 녹음(`400 VOICE_CLONE_NO_SPEECH`)은 흐름을 끝내지도, 세부 정보로 돌리지도 않는다 — 음원 준비로
    /// 돌아가 그 녹음을 버리고 다시 녹음하게 한다(같은 녹음을 다시 보내면 같은 답이다). 서버는 아무것도 쓰지 않았고 이번 달
    /// 등록도 그대로라 남은 횟수를 다시 읽지 않고, 창이 닫힌 뒤 띄울 월 한도 알럿도 없다. 문장은 뷰모델이 안내 줄에 세우고,
    /// 등록 창이 그것을 음원 준비 단계의 거절 줄로 옮긴다(배선은
    /// `test_말소리_거절의_이유는_녹음_카드_아래_오류_색_줄에_쓰고_새_소리를_준비하면_걷는다`).
    func test_말소리가_없는_녹음은_음원_준비로_돌려보내고_월_한도는_건드리지_않는다() async throws {
        try await withVoiceViewModel(clone: (400, Self.noSpeechBody)) { vm, session, audio, quotaCalls in
            let created = await vm.cloneAudioForProfile(
                audioFileURL: audio, name: "새 목소리", durationMs: 20_000, session: session
            )

            XCTAssertNil(created)
            XCTAssertTrue(vm.noSpeechRejected, "말소리 거절이 적히지 않아 같은 녹음을 다시 보낼 세부 정보로 돌아간다")
            XCTAssertEqual(
                VoiceCloneUploadFlow.submitOutcome(
                    created: created, monthlyLimitRejected: vm.monthlyLimitRejected, noSpeechRejected: vm.noSpeechRejected
                ),
                .rerecordForNoSpeech
            )
            XCTAssertEqual(vm.statusMessage, Self.noSpeechSentence, "다시 녹음할 이유를 말하지 않는다")
            XCTAssertFalse(vm.monthlyLimitRejected, "다시 녹음하면 되는 거절에 흐름을 끝낸다")
            XCTAssertFalse(vm.consumeMonthlyLimitNotice(), "창이 닫힌 뒤 월 한도 알럿이 뜬다")
            XCTAssertEqual(quotaCalls(), 0, "이번 달 등록과 무관한 거절에 남은 횟수를 다시 읽는다")
            XCTAssertFalse(vm.isBusy)
        }
    }

    /// 말소리 거절은 **그 등록 한 번의 답**이다 — 다음 등록이 다른 이유로 실패하면 녹음을 버리지 않는다. 남아 있으면
    /// 다시 녹음한 뒤의 네트워크·용량 실패까지 다시 녹음으로 읽어 멀쩡한 새 녹음을 버린다. 요청을 내기 전에 돌아가는
    /// 등록(녹음 없음·너무 짧음)도 지난 거절을 들고 가지 않는다.
    func test_말소리_거절은_다음_등록으로_넘어가지_않는다() async throws {
        let capacity = #"{"error":"Voice capacity exhausted","error_code":"VOICE_CAPACITY_EXHAUSTED"}"#
        try await withVoiceViewModel(
            clone: (400, Self.noSpeechBody), (400, Self.noSpeechBody), (400, Self.noSpeechBody), (503, capacity)
        ) { vm, session, audio, _ in
            func clone(durationMs: Int = 20_000) async -> VoiceProfile? {
                await vm.cloneAudioForProfile(
                    audioFileURL: audio, name: "새 목소리", durationMs: durationMs, session: session
                )
            }

            _ = await clone()
            XCTAssertTrue(vm.noSpeechRejected)
            // 녹음 없이 보낸 등록 — 요청을 내기 전에 돌아간다(녹음기가 비어 있다).
            vm.cloneName = "새 목소리"
            let unsent = await vm.uploadRecordingForClone(session: session)
            XCTAssertNil(unsent)
            XCTAssertFalse(vm.noSpeechRejected, "보내지도 않은 녹음 등록이 지난 말소리 거절을 들고 간다")

            _ = await clone()
            XCTAssertTrue(vm.noSpeechRejected)
            // 12초가 안 되는 음원 — 역시 요청을 내기 전에 돌아간다.
            let tooShort = await clone(durationMs: 5_000)
            XCTAssertNil(tooShort)
            XCTAssertFalse(vm.noSpeechRejected, "보내지도 않은 파일 등록이 지난 말소리 거절을 들고 간다")

            _ = await clone()
            XCTAssertTrue(vm.noSpeechRejected)
            let created = await clone()
            XCTAssertFalse(vm.noSpeechRejected, "다시 녹음한 뒤의 용량 실패를 말소리 거절로 읽어 새 녹음을 버린다")
            XCTAssertEqual(
                VoiceCloneUploadFlow.submitOutcome(
                    created: created, monthlyLimitRejected: vm.monthlyLimitRejected, noSpeechRejected: vm.noSpeechRejected
                ),
                .details
            )
            XCTAssertEqual(vm.statusMessage, APIErrorMessages.message(for: "VOICE_CAPACITY_EXHAUSTED"))
        }
    }

    /// 말소리 거절 뒤 등록 창이 버릴 것(`VoiceCloneUploadFlow.sentSourceCleanup` — `submit` 이 그대로 따른다). 보낸
    /// 소리를 남기면 `다음`·`등록` 이 같은 소리를 다시 보내 같은 400 을 받고, 누를 때마다 공용·한도 있는 키로 전사 한
    /// 번을 치른다. 버리는 것은 **보낸 갈래의 소리**뿐이다 — 다른 갈래에 준비해 둔 소리는 보내지 않았다. 돌아갈 단계
    /// (음원 준비)는 화면 배선이 정한다(`test_말소리_거절의_이유는_녹음_카드_아래_오류_색_줄에_쓰고_새_소리를_준비하면_걷는다`).
    func test_말소리_거절_뒤에는_보낸_소리를_버리고_음원_준비로_돌아간다() {
        let imported = URL(fileURLWithPath: "/voice-clone-plan-test/VoiceImports/clone-import-a.m4a")
        let cropped = URL(fileURLWithPath: "/voice-clone-plan-test/VoiceCrop/crop-b.m4a")
        func cleanup(_ mode: VoiceCloneSourceMode, uploaded: URL?) -> VoiceCloneUploadFlow.SentSourceCleanup {
            VoiceCloneUploadFlow.sentSourceCleanup(
                after: .rerecordForNoSpeech, sentMode: mode, selectedFileURL: imported, uploadedURL: uploaded
            )
        }

        // 고른 파일의 구간을 잘라 보냈다 — 올린 것은 잘라 낸 사본이다. 가져온 사본과 함께 지우고 고르기 전으로 돌린다.
        let croppedFile = cleanup(.file, uploaded: cropped)
        XCTAssertEqual(croppedFile.filesToDelete, [imported, cropped], "올린 소리(잘라 낸 사본)나 가져온 사본을 남긴다")
        XCTAssertTrue(croppedFile.clearsFileSelection, "고른 파일을 놓지 않아 `다음` 이 같은 파일을 다시 보낸다")
        XCTAssertFalse(croppedFile.clearsRecorder, "보내지 않은 녹음까지 버린다")

        // 가져온 사본을 그대로 보냈다(자를 것이 없었다) — 지울 파일은 그 하나다.
        let wholeFile = cleanup(.file, uploaded: imported)
        XCTAssertEqual(wholeFile.filesToDelete, [imported])
        XCTAssertTrue(wholeFile.clearsFileSelection)

        // 녹음을 보냈다 — 녹음기를 비운다(녹음 파일은 녹음기가 지운다). 고른 파일은 보내지 않았으니 그대로 둔다.
        XCTAssertEqual(
            cleanup(.record, uploaded: nil),
            VoiceCloneUploadFlow.SentSourceCleanup(clearsRecorder: true, filesToDelete: [], clearsFileSelection: false),
            "말소리가 없는 녹음을 남기거나, 보내지 않은 파일까지 버린다"
        )
    }

    // MARK: - 보낸 음원은 다 쓰면 곧바로 지운다(스펙 voice-and-message §4-1)

    /// 등록 녹음은 음성 생체정보 **평문**이다 — 다시 보낼 일이 없으면 남기지 않는다. 고치기 전 iOS 는 말소리 거절에서만
    /// 지웠고, 서버가 받아들인 뒤(초안이 만들어졌다)와 월 한도로 창을 닫은 뒤에도 녹음(`VoiceRecordings`)·가져온 사본
    /// (`VoiceImports`)·잘라 낸 사본(`VoiceCrop`)이 남았다 — 안드로이드는 업로드가 성공하면, 거절로 다 쓰면 지운다.
    /// 다시 시도할 수 있는 실패만 `등록` 이 다시 보낼 것(녹음·가져온 사본)을 남긴다.
    func test_보낸_음원은_다_쓰면_지우고_다시_시도할_수_있는_실패에는_다시_보낼_것만_남긴다() {
        let imported = URL(fileURLWithPath: "/voice-clone-plan-test/VoiceImports/clone-import-a.m4a")
        let cropped = URL(fileURLWithPath: "/voice-clone-plan-test/VoiceCrop/crop-b.m4a")
        let spent: [VoiceCloneUploadFlow.SubmitOutcome] = [.preview("draft-1"), .closeForMonthlyLimit, .rerecordForNoSpeech]

        for outcome in spent {
            XCTAssertEqual(
                VoiceCloneUploadFlow.sentSourceCleanup(
                    after: outcome, sentMode: .record, selectedFileURL: imported, uploadedURL: nil
                ),
                VoiceCloneUploadFlow.SentSourceCleanup(clearsRecorder: true, filesToDelete: [], clearsFileSelection: false),
                "\(outcome): 다 쓴 녹음을 남기거나, 보내지 않은 파일까지 버린다"
            )
            XCTAssertEqual(
                VoiceCloneUploadFlow.sentSourceCleanup(
                    after: outcome, sentMode: .file, selectedFileURL: imported, uploadedURL: cropped
                ),
                VoiceCloneUploadFlow.SentSourceCleanup(clearsRecorder: false, filesToDelete: [imported, cropped], clearsFileSelection: true),
                "\(outcome): 다 쓴 가져온 사본·잘라 낸 사본을 남기거나, 보내지 않은 녹음까지 버린다"
            )
        }

        // 다시 시도할 수 있는 실패 — 녹음과 가져온 사본은 남는다(`등록` 이 그대로 다시 보낸다). 잘라 낸 사본은 다음 `등록` 이
        // 다시 자르므로 남겨 봐야 쌓이기만 한다.
        XCTAssertEqual(
            VoiceCloneUploadFlow.sentSourceCleanup(after: .details, sentMode: .record, selectedFileURL: nil, uploadedURL: nil),
            VoiceCloneUploadFlow.SentSourceCleanup(clearsRecorder: false, filesToDelete: [], clearsFileSelection: false),
            "다시 시도할 수 있는 실패에 녹음을 버려 처음부터 다시 녹음하게 한다"
        )
        XCTAssertEqual(
            VoiceCloneUploadFlow.sentSourceCleanup(
                after: .details, sentMode: .file, selectedFileURL: imported, uploadedURL: cropped
            ),
            VoiceCloneUploadFlow.SentSourceCleanup(clearsRecorder: false, filesToDelete: [cropped], clearsFileSelection: false),
            "가져온 사본을 버려 다시 고르게 하거나, 다시 쓰이지 않을 잘라 낸 사본을 남긴다"
        )
        XCTAssertEqual(
            VoiceCloneUploadFlow.sentSourceCleanup(
                after: .details, sentMode: .file, selectedFileURL: imported, uploadedURL: imported
            ),
            VoiceCloneUploadFlow.SentSourceCleanup(clearsRecorder: false, filesToDelete: [], clearsFileSelection: false),
            "자르지 않고 보낸 가져온 사본을 다시 시도할 실패에 지운다"
        )
    }

    /// ⚠ **알람이 아직 쓰는 파일은 지우지 않는다** — 지울 목록은 앱이 뜬 사본 폴더(가져온 사본·잘라 낸 사본) **바로 안의**
    /// 파일로만 셈한다. 알람 음원은 다른 폴더라 섞일 일이 없지만, 다른 곳을 가리키는 주소가 들어와도 지우지 않는다 —
    /// 선택만 놓는다. 사용자가 고른 원본(가져올 때 사본을 떴다)도 같은 이유로 지우지 않는다.
    func test_앱이_뜬_사본_폴더_밖의_파일은_어떤_결말에도_지우지_않는다() {
        let alarmAudio = URL(fileURLWithPath: "/voice-clone-plan-test/AlarmTalkAudio/alarm-7.m4a")
        let picked = URL(fileURLWithPath: "/voice-clone-plan-test/Inbox/내 녹음.m4a")
        let nested = URL(fileURLWithPath: "/voice-clone-plan-test/VoiceImports/old/clone-import-c.m4a")
        let remote = URL(string: "https://r2.example/VoiceCrop/crop-d.m4a")!

        for url in [alarmAudio, picked, nested, remote] {
            XCTAssertFalse(VoiceCloneUploadFlow.isAppMadeSourceCopy(url), "\(url)")
        }
        XCTAssertTrue(VoiceCloneUploadFlow.isAppMadeSourceCopy(
            URL(fileURLWithPath: "/voice-clone-plan-test/VoiceImports/clone-import-a.m4a")
        ))
        XCTAssertTrue(VoiceCloneUploadFlow.isAppMadeSourceCopy(
            URL(fileURLWithPath: "/voice-clone-plan-test/VoiceCrop/crop-b.m4a")
        ))

        let outcomes: [VoiceCloneUploadFlow.SubmitOutcome] = [
            .preview("draft-1"), .closeForMonthlyLimit, .rerecordForNoSpeech, .details,
        ]
        for outcome in outcomes {
            let cleanup = VoiceCloneUploadFlow.sentSourceCleanup(
                after: outcome, sentMode: .file, selectedFileURL: picked, uploadedURL: alarmAudio
            )
            XCTAssertEqual(cleanup.filesToDelete, [], "\(outcome): 앱이 뜬 사본이 아닌 파일을 지운다")
        }
        XCTAssertTrue(
            VoiceCloneUploadFlow.sentSourceCleanup(
                after: .preview("draft-1"), sentMode: .file, selectedFileURL: nested, uploadedURL: remote
            ).clearsFileSelection,
            "지우지 못하는 파일이어도 다 쓴 선택은 놓아야 한다"
        )
    }

    /// 말소리 거절의 화면 배선(`VoiceCloneUploadFlow`) — 창의 `@State` 라 유닛 테스트가 닿지 않아, 안드로이드
    /// `VoiceRegistrationFailureWiringTest` 처럼 소스를 읽어 본다.
    /// - 이유는 **녹음 카드(파일 고르기) 바로 아래의 오류 색 줄**에 쓴다. 맨 아래 안내 줄(`statusSection`)은 바로 위아래
    ///   힌트와 같은 흐린 글자라 거절이 힌트 한 줄로 읽히고, 예시 대본을 펼쳐 두면 화면 밖이다.
    /// - 그 줄은 **창의 상태**다 — 뷰모델의 안내 줄에 남기면 창을 닫은 뒤 목소리 탭 맨 위에, 다음 창의 빈 녹음 카드
    ///   아래에 그대로 남는다.
    /// - 새로 녹음하기 시작하거나, 파일을 새로 고르거나, 방식을 바꾸면 걷는다 — 남기면 새 소리도 거절당한 것처럼 읽힌다.
    /// - 이유가 생기면 본문을 맨 위로 올린다 — 그 줄은 본문 위쪽이다.
    /// - 보낸 음원의 정리는 갈 곳이 정해진 뒤 한 자리에서 한다(`sentSourceCleanup` — 모든 결말이 지난다).
    func test_말소리_거절의_이유는_녹음_카드_아래_오류_색_줄에_쓰고_새_소리를_준비하면_걷는다() throws {
        let flow = try AppSourceText.read("Views/Voices/VoiceCloneUploadFlow.swift")

        // 갈래 — 음원 준비로 돌아가고, 문장은 뷰모델의 안내 줄에서 창의 줄로 옮긴다. 흐름은 끝내지 않는다.
        XCTAssertTrue(flow.contains("@State private var rerecordReason: String?"), "이유가 창의 상태가 아니다")
        let branch = try AppSourceText.region(of: flow, from: "case .rerecordForNoSpeech:", to: "case .details:")
        for needle in [
            "registrationStep = .source",
            "rerecordReason = voice.statusMessage",
            "voice.statusMessage = nil",
        ] {
            XCTAssertTrue(branch.contains(needle), "말소리 거절 갈래에 없다: \(needle)")
        }
        XCTAssertFalse(branch.contains("route ="), "말소리 거절이 창을 닫는다 — 다시 녹음하는 데 제한이 없어야 한다")
        // 고른 파일이면 올린 파일(잘라 낸 사본)을 정리 계획에 넘긴다 — 안 넘기면 그 사본이 캐시에 남는다.
        let fileUpload = try AppSourceText.region(of: flow, from: "let prepared = try await preparedFileAudio()", to: "created = await voice.cloneAudioForProfile(")
        XCTAssertTrue(fileUpload.contains("uploadedFileURL = prepared.url"), "올린 파일을 계획에 넘기지 않는다")

        // 정리 — 갈 곳이 정해진 뒤 **한 자리에서**, 순수 셈(`sentSourceCleanup`) 그대로. 말소리 거절만이 아니라 모든 결말이
        // 지난다(초안이 만들어졌다·월 한도도 다 쓴 음원을 지운다 — 스펙 §4-1 「보낸 음원은 다 쓰면 곧바로 지운다」). 갈래마다
        // 따로 지우면 한 결말이 빠진다 — 고치기 전에는 말소리 거절 갈래 하나만 지웠다.
        let settle = try AppSourceText.region(of: flow, from: "let outcome = Self.submitOutcome(", to: "switch outcome {")
        for needle in [
            "discardSentSource(Self.sentSourceCleanup(",
            "after: outcome",
            "sentMode: sentMode",
            "selectedFileURL: selectedFileURL",
            "uploadedURL: uploadedFileURL",
        ] {
            XCTAssertTrue(settle.contains(needle), "갈 곳을 정한 뒤의 정리에 없다: \(needle)")
        }
        let submit = try AppSourceText.region(of: flow, from: "private func submit() async {", to: "private func discardSentSource(")
        XCTAssertEqual(
            submit.components(separatedBy: "discardSentSource(").count - 1, 1,
            "보낸 음원을 갈래마다 따로 지운다 — 정리는 갈 곳이 정해진 뒤 한 번이다"
        )
        // 지울 목록이 고르는 폴더는 사본을 **만드는** 폴더와 같아야 한다 — 다르면 정리가 아무것도 지우지 못한다.
        let copyImported = try AppSourceText.region(of: flow, from: "private func copyImportedAudio(", to: "return destination")
        XCTAssertTrue(copyImported.contains(".appendingPathComponent(Self.importFolderName"), "가져온 사본을 다른 폴더에 뜬다")
        let cropper = try AppSourceText.read("Views/Voices/AudioCropper.swift")
        let cropOutput = try AppSourceText.region(of: cropper, from: "private static func makeOutputURL()", to: "return dir")
        XCTAssertTrue(cropOutput.contains(".appendingPathComponent(outputFolderName"), "잘라 낸 사본을 다른 폴더에 쓴다")

        // 본문을 맨 위로 — 이유 줄은 본문 위쪽이라, 세부 정보 단계에서 내려 둔 위치가 남으면 화면 밖이다. 안드로이드
        // `LaunchedEffect(rerecordReason)` 의 `animateScrollTo(0)` 과 같다. 이유가 생길 때만 올린다(걷힐 때는 그대로).
        XCTAssertTrue(flow.contains("ScrollViewReader { scroll in"), "본문을 올릴 스크롤 손잡이가 없다")
        XCTAssertTrue(flow.contains(".id(Self.contentTopID)"), "본문 맨 위에 표지가 없다")
        let scrollUp = try AppSourceText.region(of: flow, from: ".onChange(of: rerecordReason)", to: "bottomActions")
        XCTAssertTrue(scrollUp.contains("guard reason != nil else { return }"), "이유를 걷을 때도 본문을 움직인다")
        XCTAssertTrue(scrollUp.contains("scroll.scrollTo(Self.contentTopID, anchor: .top)"), "이유가 생겨도 본문을 맨 위로 올리지 않는다")

        // 자리 — 녹음 카드 **바로** 아래(힌트·예시 대본보다 앞), 파일 고르기 **바로** 아래.
        let source = try AppSourceText.region(
            of: flow, from: "private var sourceSection: some View {", to: "private var scriptSection: some View {"
        )
        func lineAfter(_ anchor: String) throws -> Substring {
            let end = try XCTUnwrap(source.range(of: anchor), "음원 준비 단계에서 못 찾았다: \(anchor)").upperBound
            return source[end...].drop { $0.isWhitespace }
        }
        XCTAssertTrue(try lineAfter("recordingSection").hasPrefix("rerecordReasonLine"), "녹음 카드 바로 아래에 이유 줄이 없다")
        XCTAssertTrue(try lineAfter("fileSection").hasPrefix("rerecordReasonLine"), "파일 고르기 바로 아래에 이유 줄이 없다")

        // 글자·색 — 오류 줄의 토큰이다(안드로이드 `RerecordReasonLine` 의 bodySmall·오류 색). 안내 줄의 흐린 글자가 아니다.
        let styledLine = #"private var rerecordReasonLine: some View \{\s*if let rerecordReason \{\s*Text\(rerecordReason\)\s*"#
            + #"\.font\(theme\.typography\.bodySmall\)\s*\.foregroundStyle\(theme\.palette\.error\)"#
        XCTAssertNotNil(flow.range(of: styledLine, options: .regularExpression), "이유 줄이 오류 색의 bodySmall 이 아니다")

        // 걷는 때 — 녹음이 실제로 시작됐을 때, 파일을 새로 가져왔을 때(성공한 때), 방식을 바꿨을 때. 창을 닫으면 상태째 사라진다.
        let onRecord = try AppSourceText.region(of: flow, from: "onRecord: {", to: "onPreview:")
        let started = try XCTUnwrap(onRecord.range(of: "await voice.startRecording()"), "녹음 버튼이 녹음을 시작하지 않는다")
        let clearedOnRecord = try XCTUnwrap(onRecord.range(of: "rerecordReason = nil"), "녹음을 다시 시작해도 이유가 남는다")
        XCTAssertLessThan(started.lowerBound, clearedOnRecord.lowerBound, "녹음을 시작하기도 전에 이유를 걷는다")
        let imported = try AppSourceText.region(of: flow, from: "private func importAudioFile(", to: "} catch {")
        XCTAssertTrue(imported.contains("rerecordReason = nil"), "파일을 새로 가져와도 이유가 남는다")
        let modeChange = try AppSourceText.region(of: flow, from: ".onChange(of: sourceMode)", to: "private func goBack()")
        XCTAssertTrue(modeChange.contains("rerecordReason = nil"), "녹음·파일 방식을 바꿔도 이유가 남는다")
    }

    /// 새 등록 창은 목소리 탭에 남은 안내를 들고 들어가지 않는다(`beginVoiceCreation`). 남기면 아직 아무것도 녹음하지
    /// 않은 음원 준비 단계에 지난 문장(말투 분석 다시 시도 실패 등)이 먼저 떠 있다.
    func test_새_등록_창은_목소리_탭에_남은_안내를_비우고_연다() {
        let vm = VoiceStudioViewModel()
        vm.statusMessage = "말투 분석을 다시 시도하지 못했어요. 잠시 뒤에 눌러 주세요."
        vm.cloneName = "지난 이름"

        vm.beginVoiceCreation()

        XCTAssertNil(vm.statusMessage, "목소리 탭에 남은 안내가 새 창의 음원 준비 단계에 뜬다")
        XCTAssertEqual(vm.cloneName, "")
    }

    // MARK: - 남은 횟수 — 가장 나중에 낸 요청의 답만 적는다

    /// 강제 갱신(확정 성공·월 한도 거절·초안 버리기)은 진행 중인 갱신을 기다리지 않는다 — 답이 낸 순서대로 오지 않는다.
    /// 먼저 낸 한도 요청의 답(1회 남음)이 뒤에 낸 요청의 답(0)보다 **늦게** 와서 덮으면, 확정 직후의 `0/1` 위에 그 전의
    /// `1/1` 이 다시 앉아 `추가` 가 켜지고 삭제 경고가 빠진다(스펙 voice-and-message §4-1 「월 등록 한도」 ②).
    func test_겹친_새로고침에서_늦게_온_옛_한도_답은_새_답을_덮지_않는다() async throws {
        try await withHeldFirstQuotaAnswer { vm, session, releaseFirstQuotaAnswer, quotaCalls in
            // 먼저 낸 갱신 — 한도 답(1회 남음)이 서버에서 붙잡혀 있다.
            let older = Task { await vm.refresh(session: session, force: true) }
            try await waitUntil { quotaCalls() == 1 }

            // 뒤에 낸 강제 갱신 — 답(0)이 곧바로 온다.
            await vm.refresh(session: session, force: true)
            XCTAssertEqual(quotaCalls(), 2)
            XCTAssertEqual(vm.draftQuota?.registrationRemaining, 0)

            // 이제 먼저 낸 요청의 옛 답이 마지막에 도착한다.
            releaseFirstQuotaAnswer()
            await older.value

            XCTAssertEqual(vm.draftQuota?.registrationRemaining, 0, "늦게 온 옛 답(1회 남음)이 새 답(0)을 덮었다")
        }
    }

    /// 요청 번호는 계정 상태를 비워도(로그아웃·계정 전환) **되감지 않는다.** 되감으면 로그아웃 전에 낸 요청과 다시 들어와
    /// 낸 요청의 번호가 같아져, 같은 계정이면 앞 요청의 늦은 답이 그대로 실린다.
    func test_한도_요청_번호는_계정_상태를_비워도_되감지_않는다() async throws {
        try await withHeldFirstQuotaAnswer { vm, session, releaseFirstQuotaAnswer, quotaCalls in
            let older = Task { await vm.refresh(session: session, force: true) }
            try await waitUntil { quotaCalls() == 1 }

            // 로그아웃했다가 같은 계정으로 다시 들어와 새로 읽는다 — 답(0)이 곧바로 온다.
            vm.clearUserScopedRemoteState()
            XCTAssertNil(vm.draftQuota)
            await vm.refresh(session: session, force: true)
            XCTAssertEqual(vm.draftQuota?.registrationRemaining, 0)

            releaseFirstQuotaAnswer()
            await older.value

            XCTAssertEqual(
                vm.draftQuota?.registrationRemaining, 0,
                "로그아웃 전에 낸 요청의 늦은 답(1회 남음)이 다시 들어온 뒤의 답(0)을 덮었다"
            )
        }
    }

    /// `POST voice/clone` 의 답을 정한 서버와, 올릴 음원 파일 하나를 준비한다. 등록의 답은 n 번째 요청에 n 번째 것을
    /// 주고, 모자라면 마지막 것을 되풀이한다. 한도 조회는 **첫 번째만** 1회 남음이고 그 뒤로는 0 이다(그 사이 등록이
    /// 소모됐다).
    private func withVoiceViewModel(
        clone: (status: Int, body: String)...,
        body: (VoiceStudioViewModel, AuthSession, URL, @escaping @Sendable () -> Int) async throws -> Void
    ) async throws {
        let host = "\(UUID().uuidString.lowercased()).voice-monthly-limit.example.test"
        let cloneAnswers = clone.map { ($0.status, Data($0.body.utf8)) }
        VoiceMonthlyLimitURLProtocol.configure(host: host) { path, ordinal in
            switch path {
            case "voice/clone":
                return cloneAnswers[min(ordinal, cloneAnswers.count) - 1]
            case "voice/draft-quota":
                return Self.quotaAnswer(ordinal: ordinal)
            default:
                // `voice` — 등록된 목소리가 없다.
                return (200, Data(#"{"profiles":[]}"#.utf8))
            }
        }
        let (vm, session, urlSession) = stubbedViewModel(host: host)
        let audio = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).m4a")
        try Data(repeating: 0, count: 64).write(to: audio)
        defer {
            urlSession.invalidateAndCancel()
            VoiceMonthlyLimitURLProtocol.configure(host: host, handler: nil)
            try? FileManager.default.removeItem(at: audio)
        }
        try await body(vm, session, audio) {
            VoiceMonthlyLimitURLProtocol.count(host: host, path: "voice/draft-quota")
        }
    }

    /// 겹친 새로고침을 흉내 낸다 — 한도 조회의 **첫 번째 답(1회 남음)은 붙잡아 두었다가** 넘겨준 `releaseFirstQuotaAnswer`
    /// 를 부를 때 내고, 그 뒤의 답(0)은 곧바로 낸다. 목소리 목록은 비어 있다.
    private func withHeldFirstQuotaAnswer(
        _ body: (
            VoiceStudioViewModel, AuthSession,
            _ releaseFirstQuotaAnswer: @escaping @Sendable () -> Void,
            _ quotaCalls: @escaping @Sendable () -> Int
        ) async throws -> Void
    ) async throws {
        let host = "\(UUID().uuidString.lowercased()).voice-monthly-limit.example.test"
        VoiceMonthlyLimitURLProtocol.configure(
            host: host,
            hold: { path, ordinal in path == "voice/draft-quota" && ordinal == 1 }
        ) { path, ordinal in
            path == "voice/draft-quota" ? Self.quotaAnswer(ordinal: ordinal) : (200, Data(#"{"profiles":[]}"#.utf8))
        }
        let (vm, session, urlSession) = stubbedViewModel(host: host)
        defer {
            // 실패로 빠져나가도 붙잡힌 요청을 남기지 않는다.
            VoiceMonthlyLimitURLProtocol.release(host: host)
            urlSession.invalidateAndCancel()
            VoiceMonthlyLimitURLProtocol.configure(host: host, handler: nil)
        }
        try await body(vm, session, { VoiceMonthlyLimitURLProtocol.release(host: host) }) {
            VoiceMonthlyLimitURLProtocol.count(host: host, path: "voice/draft-quota")
        }
    }

    /// 한도 조회의 n 번째 답 — 첫 번째만 1회 남음, 그 뒤로는 0.
    private nonisolated static func quotaAnswer(ordinal: Int) -> (Int, Data) {
        let remaining = ordinal == 1 ? 1 : 0
        return (200, Data(#"{"registration_limit":1,"registration_remaining":\#(remaining)}"#.utf8))
    }

    /// 스텁 서버(`host`)에 붙은 뷰모델과 로그인 세션. 돌려준 `URLSession` 은 부른 쪽이 닫는다.
    private func stubbedViewModel(host: String) -> (VoiceStudioViewModel, AuthSession, URLSession) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VoiceMonthlyLimitURLProtocol.self]
        let urlSession = URLSession(configuration: configuration)
        let vm = VoiceStudioViewModel(api: AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: urlSession))
        let session = AuthSession(
            token: UUID().uuidString,
            user: AuthUser(id: UUID().uuidString, email: "voice-limit@example.test")
        )
        return (vm, session, urlSession)
    }

    /// 조건이 설 때까지 짧게 기다린다 — 붙잡아 둘 요청이 스텁에 닿았는지 볼 때 쓴다.
    private func waitUntil(timeout: TimeInterval = 5, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            guard Date() < deadline else {
                XCTFail("기다리던 요청이 \(timeout)초 안에 오지 않았다")
                return
            }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    func test_multipartUploadFileName_prefersTrimmedSelectedFileName() {
        let fileURL = URL(fileURLWithPath: "/tmp/clone-import-123.m4a")

        XCTAssertEqual(
            AlarmTalkAPI.multipartUploadFileName(fileURL: fileURL, originalName: "  gia.mov  "),
            "gia.mov"
        )
    }

    func test_multipartUploadFileName_fallsBackToPreparedURLName() {
        let fileURL = URL(fileURLWithPath: "/tmp/clone-import-123.m4a")

        XCTAssertEqual(
            AlarmTalkAPI.multipartUploadFileName(fileURL: fileURL, originalName: "   "),
            "clone-import-123.m4a"
        )
    }
}

/// 호스트별로 경로 → (상태, 본문)을 정하고 **경로별 호출 수**를 센다. 경로는 `/api/` 뒤
/// (`voice/clone`, `voice/draft-quota` …)이고, 핸들러는 그 경로의 몇 번째 호출인지(1부터)를 함께 받는다.
///
/// `hold` 가 참인 호출은 답을 **붙잡아 두었다가** `release(host:)` 때 낸다 — 먼저 낸 요청의 답을 나중에 도착시킨다.
/// 붙잡은 답은 그 요청을 받은 런루프에서 낸다(`URLProtocol` 의 클라이언트는 `startLoading` 의 스레드에서 부른다).
private final class VoiceMonthlyLimitURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (_ path: String, _ ordinal: Int) -> (Int, Data)
    typealias Hold = @Sendable (_ path: String, _ ordinal: Int) -> Bool
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    nonisolated(unsafe) private static var holds: [String: Hold] = [:]
    nonisolated(unsafe) private static var counts: [String: [String: Int]] = [:]
    nonisolated(unsafe) private static var held: [String: [() -> Void]] = [:]

    static func configure(host: String, hold: Hold? = nil, handler: Handler?) {
        lock.lock()
        defer { lock.unlock() }
        handlers[host] = handler
        holds[host] = handler == nil ? nil : hold
        if handler == nil {
            counts[host] = nil
            held[host] = nil
        }
    }

    /// 붙잡아 둔 답을 모두 낸다.
    static func release(host: String) {
        lock.lock()
        let pending = held[host] ?? []
        held[host] = nil
        lock.unlock()
        pending.forEach { $0() }
    }

    static func count(host: String, path: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return counts[host]?[path] ?? 0
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix(".voice-monthly-limit.example.test") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let host = url.host else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let path = url.path.components(separatedBy: "/api/").last ?? url.path
        Self.lock.lock()
        let handler = Self.handlers[host]
        let hold = Self.holds[host]
        var ordinal = 0
        if handler != nil {
            ordinal = (Self.counts[host]?[path] ?? 0) + 1
            Self.counts[host, default: [:]][path] = ordinal
        }
        Self.lock.unlock()
        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
            return
        }
        let (status, data) = handler(path, ordinal)
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        let deliver = { [self] in
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
        guard hold?(path, ordinal) == true else {
            deliver()
            return
        }
        let runLoop = CFRunLoopGetCurrent()
        Self.lock.lock()
        Self.held[host, default: []].append {
            CFRunLoopPerformBlock(runLoop, CFRunLoopMode.commonModes.rawValue, deliver)
            CFRunLoopWakeUp(runLoop)
        }
        Self.lock.unlock()
    }

    override func stopLoading() {}
}
