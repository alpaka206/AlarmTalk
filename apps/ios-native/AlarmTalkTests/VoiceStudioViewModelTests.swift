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
            "유료 이용권에서 사용할 수 있어요."
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

    func test_localizedVoiceMessage_VOICE_LIMIT_REACHED() {
        XCTAssertEqual(
            VoiceStudioViewModel.localizedVoiceMessage(forCode: "VOICE_LIMIT_REACHED"),
            "이번 달 목소리 생성 한도를 모두 사용했어요."
        )
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
        XCTAssertEqual(vm.mapVoiceError(err), "유료 이용권에서 사용할 수 있어요.")
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

    func test_mapVoiceError_koreanServerMessageIsPreserved() {
        let vm = VoiceStudioViewModel()
        let err = APIError.server(status: 400, message: "음성 길이를 확인하지 못했어요.", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "음성 길이를 확인하지 못했어요.")
    }

    func test_mapVoiceError_koreanForbiddenServerMessageIsPreserved() {
        let vm = VoiceStudioViewModel()
        let err = APIError.server(status: 403, message: "유료 이용권에서 사용할 수 있어요.", errorCode: nil)
        XCTAssertEqual(vm.mapVoiceError(err), "유료 이용권에서 사용할 수 있어요.")
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
        XCTAssertEqual(VoiceProfileLimits.maxProfiles, 1)
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

    /// 목소리 프로필 상한은 **1개**다. 단일 출처는 서버이고
    /// (`packages/backend/src/routes/voice-profile.ts` 의 `MAX_VOICE_PROFILES = 1`),
    /// 안드로이드도 같은 값을 쓴다(`NavigationModels.kt` 의 `MAX_VOICE_PROFILES = 1`).
    /// 이 테스트는 원래 5를 기대했는데 그건 구현·서버·안드로이드 어느 쪽과도 맞지 않는
    /// 묵은 기대값이었다. 구현(`VoiceProfileLimits.maxProfiles = 1`)이 옳다.
    func test_isProfileLimitReached_andRemainingSlots() {
        let vm = VoiceStudioViewModel()
        vm.profiles = []
        XCTAssertFalse(vm.isProfileLimitReached)
        XCTAssertEqual(vm.remainingProfileSlots, VoiceProfileLimits.maxProfiles)

        vm.profiles = Array(
            repeating: VoiceProfile(id: "x", name: "x", status: "ready", createdAt: nil, isShared: nil),
            count: VoiceProfileLimits.maxProfiles
        )
        XCTAssertTrue(vm.isProfileLimitReached)
        XCTAssertEqual(vm.remainingProfileSlots, 0)
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

    func test_voiceCloneMultipartFields_keepBlankRelationshipPartsForServerValidation() {
        let fields = AlarmTalkAPI.voiceCloneMultipartFields(
            name: "Draft",
            isShared: false,
            durationMs: 60_000,
            noiseRemoval: true,
            relationshipLabel: nil,
            listenerTitle: "   "
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
        XCTAssertEqual(fields["language"], "ko")
        // noiseRemoval/noise_removal 필드는 제거됨(Android 도 더는 전송 안 함, 백엔드 무시).
        XCTAssertNil(fields["noiseRemoval"])
        XCTAssertNil(fields["noise_removal"])
        // voiceGender/speechFormality 는 **보내지 않는다** — 마이그레이션 #83 이 두 컬럼을
        // DROP 했고 대체재 speech_style 은 서버가 등록 녹음에서 자동 분석한다.
        // 안드로이드도 보내지 않고 UI 도 없다(VoiceProfileApi.createVoiceClone).
        XCTAssertNil(fields["voiceGender"])
        XCTAssertNil(fields["speechFormality"])
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
