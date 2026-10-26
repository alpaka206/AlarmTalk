import XCTest
@testable import AlarmTalk

/// `docs/spec/morning-briefing.md` §6·§8. 안드로이드 짝은 `BriefingPresentationTest`·`BriefingSpeechTest`.
final class BriefingPresentationTests: XCTestCase {
    private let samsung = "00126380"
    private let kakao = "00258801"

    private func disclosure(_ corpCode: String, id: String = "20261026000123") -> BriefingDisclosure {
        BriefingDisclosure(
            id: id,
            corpCode: corpCode,
            corpName: "삼성전자",
            reportName: "[기재정정]사업보고서 (2025.12)",
            receiptDate: "2026-10-26",
            flags: BriefingDisclosureFlags(amendedReport: true),
            url: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=\(id)",
            // 한국 시각 10/26 07:05 — UTC 로는 10/25.
            fetchedAt: "2026-10-25T22:05:00.000Z"
        )
    }

    private func news(_ id: String = "148000001", title: String = "청년 주거 지원 & 전세 대출 기준 완화") -> BriefingPolicyNews {
        BriefingPolicyNews(
            id: id,
            title: title,
            summary: "",
            organization: nil,
            publishedDate: "2026-10-26",
            url: "https://www.korea.kr/news/policyNewsView.do?newsId=\(id)",
            fetchedAt: "2026-10-25T22:05:00.000Z"
        )
    }

    // MARK: - 상태별 표시

    func testNoDisclosuresIsSaidOnlyWhenCheckedAndComplete() {
        XCTAssertEqual(BriefingPresentation.companyNote(state: .ok, complete: true, hasDisclosures: false), .noDisclosures)
        // ⚠ complete 가 거짓이면 "없어요" 라고 하지 않는다.
        XCTAssertEqual(BriefingPresentation.companyNote(state: .ok, complete: false, hasDisclosures: false), .notConclusive)
        XCTAssertEqual(BriefingPresentation.companyNote(state: .ok, complete: false, hasDisclosures: true), .none)
        for complete in [true, false] {
            for has in [true, false] {
                XCTAssertEqual(BriefingPresentation.companyNote(state: .stale, complete: complete, hasDisclosures: has), .stale)
                XCTAssertEqual(
                    BriefingPresentation.companyNote(state: .unavailable, complete: complete, hasDisclosures: has),
                    .unavailable
                )
            }
        }
    }

    func testUnknownStatusIsUnavailable() {
        XCTAssertEqual(BriefingPresentation.companyState("ok"), .ok)
        XCTAssertEqual(BriefingPresentation.companyState("stale"), .stale)
        XCTAssertEqual(BriefingPresentation.companyState("something_new"), .unavailable)
        XCTAssertEqual(BriefingPresentation.companyState(nil), .unavailable)
    }

    func testDecodesServerResponseAndSplitsByCompany() throws {
        let json = """
        {
          "window": { "from": "2026-10-20", "to": "2026-10-26" },
          "companies": [
            { "corp_code": "\(samsung)", "corp_name": "삼성전자", "status": "ok", "fetched_at": "2026-10-25T22:05:00.000Z" },
            { "corp_code": "\(kakao)", "corp_name": "카카오", "status": "stale", "fetched_at": "2026-10-25T21:40:00.000Z" }
          ],
          "disclosures": [
            { "source": "opendart", "id": "20261026000123", "corp_code": "\(samsung)", "corp_name": "삼성전자",
              "report_name": "주요사항보고서", "receipt_date": "2026-10-26", "remarks": "유",
              "flags": { "amended_report": false, "corrected_later": true, "withdrawn": false, "consolidated": false,
                         "ftc": false, "market": "kospi" },
              "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261026000123", "fetched_at": "2026-10-25T22:05:00.000Z" }
          ],
          "policy_news": [],
          "fetched_at": "2026-10-25T21:40:00.000Z",
          "stale": true,
          "complete": false,
          "errors": [
            { "source": "opendart", "code": "BRIEFING_SOURCE_RATE_LIMITED", "corp_code": "\(kakao)", "retry_after_seconds": 900 },
            { "source": "policy_news", "code": "BRIEFING_SOURCE_FAILED" }
          ]
        }
        """
        let response = try AlarmTalkAPI.makeResponseDecoder().decode(BriefingTodayResponse.self, from: Data(json.utf8))
        let model = BriefingPresentation.model(response)

        XCTAssertEqual(model.window, BriefingWindow(from: "2026-10-20", to: "2026-10-26"))
        XCTAssertFalse(model.complete)
        XCTAssertTrue(model.stale)
        XCTAssertEqual(model.retryAfterSeconds, 900)
        XCTAssertEqual(model.companies.count, 2)
        XCTAssertEqual(model.companies[0].disclosures.map(\.id), ["20261026000123"])
        XCTAssertTrue(model.companies[0].disclosures[0].flags.correctedLater)
        XCTAssertEqual(model.companies[0].note, .none)
        XCTAssertNil(model.companies[0].errorCode)
        XCTAssertEqual(model.companies[1].note, .stale)
        XCTAssertEqual(model.companies[1].errorCode, "BRIEFING_SOURCE_RATE_LIMITED")
        XCTAssertEqual(model.news.note, .unavailable)
        XCTAssertEqual(model.news.errorCode, "BRIEFING_SOURCE_FAILED")
    }

    func testCompanyErrorFallsBackToSourceWideError() {
        let errors = [
            BriefingSourceError(source: "policy_news", code: "BRIEFING_SOURCE_FAILED"),
            BriefingSourceError(source: "opendart", code: "BRIEFING_SOURCE_NOT_CONFIGURED"),
        ]
        XCTAssertEqual(BriefingPresentation.companyErrorCode(errors, corpCode: samsung), "BRIEFING_SOURCE_NOT_CONFIGURED")
        let own = errors + [BriefingSourceError(source: "opendart", code: "BRIEFING_SOURCE_MAINTENANCE", corpCode: samsung)]
        XCTAssertEqual(BriefingPresentation.companyErrorCode(own, corpCode: samsung), "BRIEFING_SOURCE_MAINTENANCE")
    }

    func testPolicyNewsSaysNoneOnlyWhenSourceDidNotFail() {
        XCTAssertEqual(BriefingPresentation.newsSection(items: [], errors: []).note, .noNews)
        XCTAssertEqual(BriefingPresentation.newsSection(items: [news()], errors: []).note, .none)
        let failed = [BriefingSourceError(source: "policy_news", code: "BRIEFING_SOURCE_FAILED")]
        XCTAssertEqual(BriefingPresentation.newsSection(items: [], errors: failed).note, .unavailable)
        XCTAssertEqual(BriefingPresentation.newsSection(items: [news()], errors: failed).note, .stale)
        let dartOnly = [BriefingSourceError(source: "opendart", code: "BRIEFING_SOURCE_FAILED")]
        XCTAssertEqual(BriefingPresentation.newsSection(items: [], errors: dartOnly).note, .noNews)
    }

    func testSourceErrorCodesMapToSpecTable() {
        XCTAssertEqual(BriefingPresentation.sourceErrorMessage("BRIEFING_SOURCE_NOT_CONFIGURED"), "이 소식은 아직 준비 중이에요.")
        XCTAssertEqual(
            BriefingPresentation.sourceErrorMessage("BRIEFING_SOURCE_RATE_LIMITED"),
            "확인 요청이 많아 잠시 쉬고 있어요. 잠시 뒤에 다시 확인해 주세요."
        )
        XCTAssertEqual(BriefingPresentation.sourceErrorMessage("BRIEFING_SOURCE_MAINTENANCE"), "출처가 점검 중이라 확인하지 못했어요.")
        let failed = "출처에서 소식을 받지 못했어요. 잠시 뒤에 다시 확인해 주세요."
        XCTAssertEqual(BriefingPresentation.sourceErrorMessage("BRIEFING_SOURCE_KEY_INVALID"), failed)
        XCTAssertEqual(BriefingPresentation.sourceErrorMessage("SOMETHING_NEW"), failed)
        XCTAssertEqual(BriefingPresentation.sourceErrorMessage(nil), failed)
        // HTTP 코드는 공용 표에 있다.
        XCTAssertEqual(APIErrorMessages.message(for: "BRIEFING_NOT_CONFIGURED"), "아침 소식은 아직 준비 중이에요.")
        XCTAssertNotNil(APIErrorMessages.message(for: "BRIEFING_CORP_CODES_NOT_READY"))
        XCTAssertNotNil(APIErrorMessages.message(for: "BRIEFING_INVALID_QUERY"))
        XCTAssertNotNil(APIErrorMessages.message(for: "BRIEFING_INVALID_INTERESTS"))
        XCTAssertNotNil(APIErrorMessages.message(for: "BRIEFING_CORP_NOT_FOUND"))
    }

    // MARK: - 관심 기업 3곳

    func testInterestsStopAtThree() {
        XCTAssertEqual(BriefingInterestRules.maxInterests, 3)
        let two = ["00000001", "00000002"]
        XCTAssertTrue(BriefingInterestRules.canAdd(two))
        let three = BriefingInterestRules.adding(two, "00000003")
        XCTAssertEqual(three, ["00000001", "00000002", "00000003"])
        XCTAssertFalse(BriefingInterestRules.canAdd(three!))
        XCTAssertNil(BriefingInterestRules.adding(three!, "00000004"))
        XCTAssertEqual(BriefingInterestRules.adding(three!, "00000002"), three)
        XCTAssertEqual(BriefingInterestRules.removing(three!, "00000002"), ["00000001", "00000003"])
    }

    func testFreeAccountsOnlyGetSystemVoices() {
        let siwoo = systemVoiceIDPrefix + "000000000101"
        let profiles = [
            VoiceProfile(id: siwoo, name: "시우", status: "ready", isSystem: true),
            VoiceProfile(id: substituteSystemVoiceID, name: "미나", status: "ready", isSystem: true),
            VoiceProfile(id: "clone-ready", name: "엄마", status: "ready"),
            VoiceProfile(id: "clone-draft", name: "초안", status: "ready", isDraft: true),
            VoiceProfile(id: "clone-pending", name: "만드는 중", status: "processing"),
        ]
        XCTAssertEqual(BriefingVoiceRules.allowedVoices(profiles, paidVoiceEntitled: false).map(\.id), [siwoo, substituteSystemVoiceID])
        XCTAssertEqual(
            BriefingVoiceRules.allowedVoices(profiles, paidVoiceEntitled: true).map(\.id),
            [siwoo, substituteSystemVoiceID, "clone-ready"]
        )
        XCTAssertEqual(BriefingVoiceRules.initialVoiceID(allowedIDs: [siwoo, substituteSystemVoiceID], lastUsedVoiceID: siwoo), siwoo)
        XCTAssertEqual(
            BriefingVoiceRules.initialVoiceID(allowedIDs: [siwoo, substituteSystemVoiceID], lastUsedVoiceID: "clone-ready"),
            substituteSystemVoiceID
        )
        XCTAssertNil(BriefingVoiceRules.initialVoiceID(allowedIDs: [], lastUsedVoiceID: nil))
    }

    // MARK: - 낭독 문단(서버 `composeBriefingSpeech` 와 같은 문장)

    func testDisclosureSentenceMatchesServer() {
        XCTAssertEqual(
            BriefingSpeech.disclosure(disclosure(samsung), checkedDate: "2026-10-26"),
            "10월 26일 확인한 삼성전자의 공시입니다. 보고서명은 기재정정 사업보고서 (2025.12)입니다. 자세한 내용은 원문에서 확인해주세요."
        )
        // 확인한 날은 그 항목의 fetched_at 의 한국 날짜다.
        XCTAssertEqual(BriefingSpeech.kstDate("2026-10-25T22:05:00.000Z"), "2026-10-26")
        XCTAssertTrue(BriefingSpeech.disclosure(disclosure(samsung)).hasPrefix("10월 26일 확인한 "))
        XCTAssertNil(BriefingSpeech.kstDate("not-a-date"))
    }

    func testWithdrawnAndPolicyNewsSentences() {
        var withdrawn = disclosure(samsung)
        withdrawn.flags = BriefingDisclosureFlags(withdrawn: true)
        XCTAssertTrue(BriefingSpeech.disclosure(withdrawn, checkedDate: "2026-10-26").contains("이 공시는 철회되었습니다."))
        XCTAssertEqual(
            BriefingSpeech.policyNews(news(), checkedDate: "2026-10-26"),
            "10월 26일 확인한 정책브리핑 정책뉴스입니다. 제목은 청년 주거 지원 & 전세 대출 기준 완화입니다. 자세한 내용은 원문에서 확인해주세요."
        )
    }

    func testAlwaysWithinLimitKeepsClosingAndNeverSplitsPairs() {
        var long = disclosure(samsung)
        long.corpName = String(repeating: "가", count: 80)
        long.reportName = String(repeating: "나", count: 300)
        let texts = [
            BriefingSpeech.disclosure(long, checkedDate: "2026-10-26"),
            BriefingSpeech.policyNews(news(title: String(repeating: "다", count: 250) + "😀"), checkedDate: "2026-10-26"),
            BriefingSpeech.policyNews(
                news(title: String(repeating: "라", count: 140) + String(repeating: "😀", count: 20)),
                checkedDate: "2026-10-26"
            ),
        ]
        for text in texts {
            XCTAssertLessThanOrEqual(text.utf16.count, BriefingSpeech.maxLength)
            XCTAssertTrue(text.hasSuffix("자세한 내용은 원문에서 확인해주세요."))
            XCTAssertNil(text.range(of: "최신|새로운|전망|예상|추천|매수|매도|주가", options: .regularExpression))
            // 서러게이트 쌍의 반쪽이 남지 않는다 — 유니코드 스칼라로 되돌린 UTF-16 이 원래와 같다.
            XCTAssertEqual(Array(String(decoding: Array(text.utf16), as: UTF16.self).utf16), Array(text.utf16))
        }
    }

    func testCleanText() {
        XCTAssertEqual(BriefingSpeech.cleanText(" 삼성\n\u{200B}전자\u{0007} "), "삼성 전자")
        XCTAssertEqual(BriefingSpeech.speakable("[기재정정]사업보고서"), "기재정정 사업보고서")
    }

    func testRequestIDsRepeatForSameInput() {
        var ids = BriefingRequestIDs()
        let first = ids.idFor(profileID: "v1", language: "ko", text: "문장")
        XCTAssertEqual(ids.idFor(profileID: "v1", language: "ko", text: "문장"), first)
        XCTAssertNotEqual(ids.idFor(profileID: "v2", language: "ko", text: "문장"), first)
        let second = ids.idFor(profileID: "v2", language: "ko", text: "문장")
        ids.completed()
        XCTAssertNotEqual(ids.idFor(profileID: "v2", language: "ko", text: "문장"), second)
    }
}
