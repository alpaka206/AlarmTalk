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

    func test_localizedVoiceMessage_AUDIO_DURATION_TOO_SHORT() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "AUDIO_DURATION_TOO_SHORT"),
            "음성이 너무 짧아요. 다시 녹음해 주세요."
        )
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
        let err = APIError.server(status: 400, message: "raw: AUDIO_DURATION_TOO_SHORT detected", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "음성이 너무 짧아요. 다시 녹음해 주세요.")
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
            isShared: true,
            durationMs: 60_000,
            relationshipLabel: " granddaughter ",
            listenerTitle: " grandpa "
        )

        XCTAssertEqual(fields["name"], "Gia")
        XCTAssertEqual(fields["isShared"], "true")
        XCTAssertEqual(fields["durationMs"], "60000")
        XCTAssertEqual(fields["relationshipLabel"], "granddaughter")
        XCTAssertEqual(fields["listenerTitle"], "grandpa")
    }

    func test_voiceCloneMultipartFields_keepOptionalPersonaBlankAndSelectedLanguage() {
        let fields = AlarmTalkAPI.voiceCloneMultipartFields(
            name: "Draft",
            isShared: false,
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
            isShared: false,
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

    /// `PATCH voice/:id/relationship` 바디 — 실제 요청과 같은 인코더(snake_case)로 본다.
    /// 관계·호칭 두 키만 나간다 — `voice_energy` 가 없어야 서버가 그 컬럼을 건드리지 않는다.
    func test_voiceRelationshipUpdateBody_sendsOnlyPersonaKeys() throws {
        let body = AlarmTalkAPI.voiceRelationshipUpdateBody(
            relationshipLabel: " 엄마 ",
            listenerTitle: " 우리 딸 "
        )
        let data = try AlarmTalkAPI.makeJSONEncoder().encode(body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json.keys.sorted(), ["listener_title", "relationship_label"])
        XCTAssertEqual(json["relationship_label"] as? String, "엄마")
        XCTAssertEqual(json["listener_title"] as? String, "우리 딸")
    }

    func test_voiceDraftPromotionCarriesSharingChoice() throws {
        let data = try JSONEncoder().encode(
            VoiceDraftPromoteRequest(isDraft: false, replaceExisting: true, isShared: true)
        )
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(body["isDraft"] as? Bool, false)
        XCTAssertEqual(body["replaceExisting"] as? Bool, true)
        XCTAssertEqual(body["isShared"] as? Bool, true)
    }

    /// 등록 확정 바디 — 들은 목소리 높이는 `pitch_semitones` 로 실리고(교체 등록도 같다), 원래 소리(0·nil)면 키가
    /// 아예 없다(높이 이전과 같은 바디, 스펙 voice-and-message §4-3). 실제 요청과 같은 인코더(snake_case)로 본다.
    func test_voiceDraftPromotionBody_carriesPitchOnlyWhenNotZero() throws {
        func json(_ pitch: Double?, replace: Bool = false) throws -> [String: Any] {
            let body = AlarmTalkAPI.voiceDraftPromoteBody(replaceExisting: replace, isShared: false, pitchSemitones: pitch)
            let data = try AlarmTalkAPI.makeJSONEncoder().encode(body)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }

        let tuned = try json(-1.5, replace: true)
        XCTAssertEqual(tuned["pitch_semitones"] as? Double, -1.5)
        XCTAssertEqual(tuned["is_draft"] as? Bool, false)
        XCTAssertEqual(tuned["replace_existing"] as? Bool, true)
        XCTAssertEqual(try json(3)["pitch_semitones"] as? Double, 3)

        XCTAssertEqual(try json(0).keys.sorted(), ["is_draft", "is_shared"])
        XCTAssertEqual(try json(nil).keys.sorted(), ["is_draft", "is_shared"])
    }

    /// 교체는 체크하지 않는다(2026-10-08 사용자 — 스펙 voice-and-message §4-1). 이미 등록된 목소리가 있으면 등록 확정
    /// 화면의 저장은 **언제나** `replace_existing: true` 를 싣고, 없으면 키가 아예 없다. 이 초안·다른 초안·시스템
    /// 목소리·실패한 목소리는 교체 대상이 아니다.
    func test_promotionReplacesWheneverAnOfficialVoiceExists() throws {
        func body(_ profiles: [VoiceProfile]) throws -> [String: Any] {
            let replacing = VoicePreviewConfirmView.replacementTarget(among: profiles, draftID: "draft") != nil
            let request = AlarmTalkAPI.voiceDraftPromoteBody(replaceExisting: replacing, isShared: false, pitchSemitones: -1.5)
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
                audioFileURL: audio, name: "새 목소리", durationMs: 20_000, isShared: false, session: session
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
                audioFileURL: audio, name: "새 목소리", durationMs: 20_000, isShared: false, session: session
            )

            XCTAssertNil(created)
            XCTAssertFalse(vm.monthlyLimitRejected)
            XCTAssertEqual(vm.statusMessage, APIErrorMessages.message(for: "VOICE_CAPACITY_EXHAUSTED"))
            XCTAssertEqual(quotaCalls(), 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path), "다시 누를 녹음이 남아 있어야 한다")
        }
    }

    /// `POST voice/clone` 의 답을 정한 서버와, 올릴 음원 파일 하나를 준비한다. 한도 조회는 **첫 번째만**
    /// 1회 남음이고 그 뒤로는 0 이다(그 사이 등록이 소모됐다).
    private func withVoiceViewModel(
        clone: (status: Int, body: String),
        _ body: (VoiceStudioViewModel, AuthSession, URL, @escaping @Sendable () -> Int) async throws -> Void
    ) async throws {
        let host = "\(UUID().uuidString.lowercased()).voice-monthly-limit.example.test"
        let cloneStatus = clone.status
        let cloneBody = Data(clone.body.utf8)
        VoiceMonthlyLimitURLProtocol.configure(host: host) { path, ordinal in
            switch path {
            case "voice/clone":
                return (cloneStatus, cloneBody)
            case "voice/draft-quota":
                let remaining = ordinal == 1 ? 1 : 0
                return (200, Data(#"{"registration_limit":1,"registration_remaining":\#(remaining)}"#.utf8))
            default:
                // `voice`·`voice/family` — 등록된 목소리가 없다.
                return (200, Data(#"{"profiles":[]}"#.utf8))
            }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VoiceMonthlyLimitURLProtocol.self]
        let urlSession = URLSession(configuration: configuration)
        let audio = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).m4a")
        try Data(repeating: 0, count: 64).write(to: audio)
        defer {
            urlSession.invalidateAndCancel()
            VoiceMonthlyLimitURLProtocol.configure(host: host, handler: nil)
            try? FileManager.default.removeItem(at: audio)
        }
        let vm = VoiceStudioViewModel(api: AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: urlSession))
        let session = AuthSession(
            token: UUID().uuidString,
            user: AuthUser(id: UUID().uuidString, email: "voice-limit@example.test")
        )
        try await body(vm, session, audio) {
            VoiceMonthlyLimitURLProtocol.count(host: host, path: "voice/draft-quota")
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
private final class VoiceMonthlyLimitURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (_ path: String, _ ordinal: Int) -> (Int, Data)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    nonisolated(unsafe) private static var counts: [String: [String: Int]] = [:]

    static func configure(host: String, handler: Handler?) {
        lock.lock()
        defer { lock.unlock() }
        handlers[host] = handler
        if handler == nil { counts[host] = nil }
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
        client?.urlProtocol(self, didReceive: HTTPURLResponse(
            url: url, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
