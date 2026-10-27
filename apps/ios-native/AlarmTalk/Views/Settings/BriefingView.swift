import SwiftUI

/// 화면이 여는 바깥 주소. 안드로이드 `BriefingLinks`(`ui/briefing/BriefingScreen.kt`).
enum BriefingLinks {
    /// 정책브리핑 콘텐츠의 이용 조건(공공누리 제1유형 — 출처표시) 안내. 정책브리핑 자체의 저작권정책 주소를 확인하면 바꾼다
    /// (`docs/spec/morning-briefing.md` §7).
    static let koglType1 = URL(string: "https://www.kogl.or.kr/info/licenseType1.do")!
}

/// 아침 소식의 원천 — 공시(OpenDART) / 정책뉴스(정책브리핑). 사용 기록의 `surface` 칸 값이다(그 링크·음성이 어느 줄에서
/// 열렸나). 안드로이드 `BriefingSource`(`data/UsageSignals.kt`) 짝.
enum BriefingSource: String, CaseIterable {
    case disclosure
    case policyNews = "policy_news"
}

/// 아침 소식 사용 기록(`briefing_opened` / `source_opened` / `briefing_audio_requested`, `docs/spec/usage-events.md` §7.1).
/// 안드로이드 `BriefingSignals` 짝.
///
/// ⚠ **관심 기업·기사 제목·원문·URL 을 싣지 않는다.** 원천 구분은 [BriefingSource] 코드 하나(`surface`)뿐이다 — 기업
///   고유번호·접수번호도 넣지 않는다(무엇을 봤는지가 곧 관심 기업이다).
enum BriefingUsageSignals {
    /// 화면이 열렸다. 들어오는 곳은 더보기 하나다.
    static let menuSurface = "menu"

    static func opened(userID: String?) {
        UsageEventQueue.shared.record(.briefingOpened, props: UsageEventProps(surface: menuSurface), userID: userID)
    }

    /// 원문 링크를 열었다. 링크는 받지 않는다 — 원천 종류만.
    static func sourceOpened(_ source: BriefingSource, userID: String?) {
        UsageEventQueue.shared.record(.sourceOpened, props: sourceProps(source), userID: userID)
    }

    /// '음성 만들기' 를 눌러 요청을 보낸다. 문장은 받지 않는다 — 원천 종류와 고른 목소리 id 만.
    static func audioRequested(_ source: BriefingSource, voiceID: String, userID: String?) {
        UsageEventQueue.shared.record(
            .briefingAudioRequested,
            voiceProfileID: voiceID,
            props: sourceProps(source),
            userID: userID
        )
    }

    static func sourceProps(_ source: BriefingSource) -> UsageEventProps {
        UsageEventProps(surface: source.rawValue)
    }
}

/// **아침 소식** — 더보기에서 들어가는 하위 화면(`docs/spec/morning-briefing.md` §8). 안드로이드 `BriefingScreen` 짝.
/// 열 때와 '다시 확인' 을 누를 때만 묻는다. 소식은 기기에 저장하지 않는다.
struct BriefingView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

    private let api = AlarmTalkAPI.shared

    @State private var interests: [BriefingInterest] = []
    @State private var interestsBusy = false
    /// 서버의 관심 기업 목록을 한 번이라도 받았는가. 못 받았으면 고치지 않는다 — 빈 목록 위에 더하고 통째로 바꾸면 서버의
    /// 기존 목록이 지워진다(코덱스 #957). 다시 받을 때까지 추가·빼기를 막는다.
    @State private var interestsLoaded = false
    @State private var interestsMessage: String?

    @State private var model: BriefingScreenModel?
    @State private var loading = false
    /// 도는 조회가 있는 동안 관심 기업이 바뀌었다 — 그 조회는 옛 목록으로 답하므로 끝나면 한 번 더 묻는다(코덱스 #957).
    @State private var reloadQueued = false
    @State private var loadMessage: String?
    @State private var notConfigured = false
    @State private var retryAt: Date?
    @State private var retryNoteVisible = false

    @State private var searchOpen = false
    @State private var limitAlertOpen = false
    @State private var speechTarget: BriefingSpeechTarget?
    /// 화면이 열린 것을 한 번 적었다(`briefing_opened`) — 위에 덮은 시트가 닫혀 `.task` 가 다시 돌아도 다시 세지 않는다.
    @State private var openRecorded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(String(localized: "관심 기업의 공시와 정책브리핑 정책뉴스를 원문 링크와 함께 보여 드려요. 화면을 열 때만 확인해요."))
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                if notConfigured {
                    noteCard(String(localized: "아침 소식은 아직 준비 중이에요."))
                } else {
                    statusCard
                    interestsCard
                    if let model {
                        ForEach(model.companies) { section in
                            BriefingCompanyCard(section: section, onSpeech: { item in
                                speechTarget = BriefingSpeechTarget(
                                    id: "d:\(item.id)",
                                    text: BriefingSpeech.disclosure(item),
                                    source: .disclosure
                                )
                            })
                        }
                        BriefingNewsCard(section: model.news, onSpeech: { item in
                            speechTarget = BriefingSpeechTarget(
                                id: "n:\(item.id)",
                                text: BriefingSpeech.policyNews(item),
                                source: .policyNews
                            )
                        })
                    }
                }
                sourceFooter
            }
            .padding(20)
        }
        .homeGradientBackground()
        .navigationTitle(String(localized: "아침 소식"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !openRecorded {
                openRecorded = true
                BriefingUsageSignals.opened(userID: auth.session?.user.id)
            }
            await loadInterests()
            await loadToday()
        }
        .alert(
            String(localized: "관심 기업은 \(Int(BriefingInterestRules.maxInterests))곳까지예요"),
            isPresented: $limitAlertOpen
        ) {
            Button(String(localized: "닫기"), role: .cancel) {}
        } message: {
            Text(String(localized: "다른 기업을 빼고 추가해 주세요."))
        }
        .fullScreenCover(isPresented: $searchOpen) {
            BottomSheetHost(onDismiss: { searchOpen = false }) {
                BriefingSearchSheet(
                    selectedCodes: interests.map(\.corpCode),
                    onPick: { company in
                        searchOpen = false
                        pick(company)
                    },
                    onClose: { searchOpen = false }
                )
            }
            .presentationBackground(.clear)
        }
        // 커버 자체의 전환을 끈다 — 스크림까지 같이 밀려 올라오지 않게(`formSheet` 주석과 같은 이유).
        .transaction { $0.disablesAnimations = true }
        .fullScreenCover(item: $speechTarget) { target in
            BottomSheetHost(onDismiss: { speechTarget = nil }) {
                BriefingSpeechSheet(
                    target: target,
                    voices: voiceChoices,
                    initialVoiceID: BriefingVoiceRules.initialVoiceID(
                        allowedIDs: voiceChoices.map(\.id),
                        lastUsedVoiceID: voiceStudio.lastUsedVoiceId
                    ),
                    onClose: { speechTarget = nil }
                )
            }
            .presentationBackground(.clear)
        }
        .transaction { $0.disablesAnimations = true }
    }

    // MARK: - 목소리 권한(직접 입력과 같다 — 무료는 기본 목소리만)

    private var paidVoiceEntitled: Bool {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            user: auth.session?.user
        ).meetsOrExceeds(.personal)
    }

    private var voiceChoices: [BriefingVoiceChoice] {
        BriefingVoiceRules.allowedVoices(voiceStudio.profiles, paidVoiceEntitled: paidVoiceEntitled).map {
            BriefingVoiceChoice(id: $0.id, name: systemVoiceDisplayName(id: $0.id, fallback: $0.name))
        }
    }

    // MARK: - 카드

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(headline)
                .font(theme.typography.titleSmall.weight(.semibold))
                .foregroundStyle(theme.palette.onSurface)
            if let model {
                Text(model.complete ? String(localized: "모두 확인했어요") : String(localized: "일부 소식을 확인하지 못했어요"))
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(model.complete ? theme.palette.onSurfaceVariant : theme.palette.error)
                if let window = model.window {
                    Text(String(localized: "\(String(BriefingFormat.date(window.from)))~\(String(BriefingFormat.date(window.to))) 접수분"))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
            if let loadMessage {
                Text(verbatim: loadMessage)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
            }
            if retryNoteVisible {
                Text(String(localized: "잠시 뒤에 다시 확인할 수 있어요."))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            HStack(spacing: 8) {
                Button(String(localized: "다시 확인")) {
                    Task {
                        if !interestsLoaded { await loadInterests() }
                        await loadToday()
                    }
                }
                    .disabled(loading)
                if loading { ProgressView() }
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .settingsCard(title: nil)
    }

    private var headline: String {
        if model == nil && loading { return String(localized: "소식을 확인하고 있어요") }
        guard let fetchedAt = model?.fetchedAt else { return String(localized: "아직 확인한 소식이 없어요") }
        return String(localized: "\(String(BriefingFormat.checkedAt(fetchedAt))) 확인")
    }

    private var interestsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            if interests.isEmpty {
                Text(String(localized: "관심 기업을 추가하면 그 기업의 공시를 모아 보여 드려요."))
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            }
            ForEach(interests) { interest in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: interest.corpName ?? String(localized: "이름을 찾을 수 없는 기업"))
                            .fontWeight(.semibold)
                            .foregroundStyle(theme.palette.onSurface)
                        if let stock = interest.stockCode?.nilIfBlank {
                            Text(verbatim: stock)
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                        }
                    }
                    Spacer(minLength: 12)
                    Button(String(localized: "빼기")) {
                        save(BriefingInterestRules.removing(interests.map(\.corpCode), interest.corpCode))
                    }
                    .disabled(interestsBusy || !interestsLoaded)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                Divider()
            }
            SettingsValueButton(label: "기업 추가", action: {
                if !interestsLoaded {
                    // 목록을 못 받은 채로는 더하지 않는다 — 먼저 다시 받는다.
                    Task { await loadInterests() }
                } else if BriefingInterestRules.canAdd(interests.map(\.corpCode)) {
                    searchOpen = true
                } else {
                    limitAlertOpen = true
                }
            })
            if let interestsMessage {
                Text(verbatim: interestsMessage)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
        }
        .settingsCard(
            title: String(localized: "관심 기업 \(Int(interests.count))/\(Int(BriefingInterestRules.maxInterests))곳")
        )
    }

    private func noteCard(_ text: String) -> some View {
        Text(verbatim: text)
            .font(theme.typography.bodyMedium)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            .frame(maxWidth: .infinity, alignment: .leading)
            .settingsCard(title: nil)
    }

    /// 출처 줄 — 이용 조건이라 빼지 않는다(`docs/spec/morning-briefing.md` §3).
    private var sourceFooter: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(String(localized: "공시 출처: 금융감독원 전자공시시스템(DART)"))
            Text(String(localized: "정책뉴스 출처: 대한민국 정책브리핑(www.korea.kr) · 공공누리 제1유형(출처표시)"))
            Text(String(localized: "주가·투자 판단은 제공하지 않아요. 자세한 내용은 원문에서 확인해 주세요."))
            Button(String(localized: "공공누리 제1유형 안내")) { openURL(BriefingLinks.koglType1) }
                .font(theme.typography.bodySmall.weight(.semibold))
                .padding(.vertical, 4)
        }
        .font(theme.typography.bodySmall)
        .foregroundStyle(theme.palette.onSurfaceVariant)
    }

    // MARK: - 요청

    private func loadInterests() async {
        guard let token = auth.session?.token else {
            interestsMessage = String(localized: "아침 소식은 로그인 후 볼 수 있어요.")
            return
        }
        do {
            interests = try await api.briefingInterests(token: token)
            interestsLoaded = true
            interestsMessage = nil
        } catch {
            interestsMessage = APIErrorMessages.message(
                for: error,
                fallback: String(localized: "소식을 불러오지 못했어요. 잠시 뒤에 다시 확인해 주세요.")
            )
        }
    }

    private func loadToday(afterInterestsChange: Bool = false) async {
        guard !loading else {
            if afterInterestsChange { reloadQueued = true }
            return
        }
        if let retryAt, Date() < retryAt {
            // `Retry-After` 를 지킨다 — 보내지 않고 이유를 말한다(버튼은 죽이지 않는다).
            retryNoteVisible = true
            return
        }
        retryNoteVisible = false
        guard let token = auth.session?.token else { return }
        loading = true
        defer {
            loading = false
            if reloadQueued {
                reloadQueued = false
                Task { await loadToday() }
            }
        }
        do {
            let next = BriefingPresentation.model(try await api.briefingToday(token: token))
            model = next
            loadMessage = nil
            notConfigured = false
            retryAt = next.retryAfterSeconds.map { Date().addingTimeInterval(TimeInterval($0)) }
        } catch {
            if (error as? APIError)?.serverErrorCode == "BRIEFING_NOT_CONFIGURED" {
                notConfigured = true
            } else {
                loadMessage = APIErrorMessages.message(
                    for: error,
                    fallback: String(localized: "소식을 불러오지 못했어요. 잠시 뒤에 다시 확인해 주세요.")
                )
            }
        }
    }

    private func pick(_ company: BriefingCompany) {
        let current = interests.map(\.corpCode)
        guard let next = BriefingInterestRules.adding(current, company.corpCode) else {
            limitAlertOpen = true
            return
        }
        if next != current { save(next) }
    }

    private func save(_ codes: [String]) {
        guard !interestsBusy, let token = auth.session?.token else { return }
        guard interestsLoaded else {
            Task { await loadInterests() }
            return
        }
        interestsBusy = true
        Task {
            defer { interestsBusy = false }
            do {
                interests = try await api.saveBriefingInterests(corpCodes: codes, token: token)
                interestsMessage = nil
                // 관심 기업이 바뀌면 소식도 다시 묻는다(새 기업은 서버가 그때 처음 확인한다).
                retryAt = nil
                await loadToday(afterInterestsChange: true)
            } catch {
                interestsMessage = APIErrorMessages.message(
                    for: error,
                    fallback: String(localized: "소식을 불러오지 못했어요. 잠시 뒤에 다시 확인해 주세요.")
                )
            }
        }
    }
}

/// 소식 음성 미리보기 한 건 — 무엇을 읽을지와 그 문장.
struct BriefingSpeechTarget: Identifiable, Equatable {
    var id: String
    var text: String
    /// 사용 기록의 원천 종류(`briefing_audio_requested`) — 문장·제목은 기록에 싣지 않는다.
    var source: BriefingSource
}

struct BriefingVoiceChoice: Identifiable, Equatable {
    var id: String
    var name: String
}

/// 날짜·시각을 기기 언어·시간대로 그린다.
enum BriefingFormat {
    /// `YYYY-MM-DD` → "10월 26일". 못 읽으면 그대로.
    static func date(_ ymd: String) -> String {
        let parts = ymd.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return ymd }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) else {
            return ymd
        }
        let formatter = DateFormatter()
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    /// ISO 시각 → "10월 26일 오전 7:05". 못 읽으면 그대로.
    static func checkedAt(_ iso: String) -> String {
        guard let date = BriefingSpeech.parseInstant(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMdjmm")
        return formatter.string(from: date)
    }
}

private struct BriefingCompanyCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.openURL) private var openURL
    let section: BriefingCompanySection
    let onSpeech: (BriefingDisclosure) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let note {
                Text(verbatim: note)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(section.note == .noDisclosures ? theme.palette.onSurfaceVariant : theme.palette.error)
            }
            if section.state != .ok, let code = section.errorCode {
                Text(verbatim: BriefingPresentation.sourceErrorMessage(code))
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            ForEach(section.disclosures) { item in
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: item.reportName)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    HStack(spacing: 6) {
                        if !item.receiptDate.isEmpty {
                            Text(String(localized: "\(String(BriefingFormat.date(item.receiptDate))) 접수"))
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                        }
                        if item.flags.amendedReport { BriefingFlagBadge(text: String(localized: "정정본")) }
                        if item.flags.correctedLater { BriefingFlagBadge(text: String(localized: "정정 신고 있음")) }
                        if item.flags.withdrawn { BriefingFlagBadge(text: String(localized: "철회됨")) }
                    }
                    BriefingItemActions(url: item.url, source: .disclosure, onSpeech: { onSpeech(item) })
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .settingsCard(title: section.corpName ?? String(localized: "이름을 찾을 수 없는 기업"))
    }

    private var note: String? {
        switch section.note {
        case .none: return nil
        case .noDisclosures: return String(localized: "이 기간에 접수된 공시가 없어요")
        case .notConclusive: return String(localized: "다 확인하지 못해 공시가 없다고 말할 수 없어요")
        case .stale:
            if let fetchedAt = section.fetchedAt {
                return String(localized: "지금 확인하지 못해 \(String(BriefingFormat.checkedAt(fetchedAt)))에 확인한 내용을 보여 드려요")
            }
            return String(localized: "지금 확인하지 못해 전에 확인한 내용을 보여 드려요")
        case .unavailable: return String(localized: "아직 확인하지 못했어요")
        }
    }
}

private struct BriefingNewsCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let section: BriefingNewsSection
    let onSpeech: (BriefingPolicyNews) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch section.note {
            case .none:
                EmptyView()
            case .noNews:
                noteText(String(localized: "최근 이틀 동안 올라온 정책뉴스가 없어요"), warning: false)
            case .stale:
                noteText(String(localized: "지금 확인하지 못해 전에 확인한 내용을 보여 드려요"), warning: true)
            case .unavailable:
                noteText(BriefingPresentation.sourceErrorMessage(section.errorCode), warning: true)
            }
            ForEach(section.items) { item in
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: item.title)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    Text(verbatim: meta(item))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    if !item.summary.isEmpty {
                        // 원천의 HTML 은 서버가 글자로 바꿔 보냈다 — 여기서도 **글자로만** 그린다.
                        Text(verbatim: item.summary)
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .lineLimit(3)
                    }
                    BriefingItemActions(url: item.url, source: .policyNews, onSpeech: { onSpeech(item) })
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .settingsCard(title: String(localized: "정책뉴스"))
    }

    private func meta(_ item: BriefingPolicyNews) -> String {
        let day = BriefingFormat.date(item.publishedDate)
        if let organization = item.organization?.nilIfBlank {
            return String(localized: "\(String(organization)) · \(String(day)) 게시")
        }
        return String(localized: "\(String(day)) 게시")
    }

    private func noteText(_ text: String, warning: Bool) -> some View {
        Text(verbatim: text)
            .font(theme.typography.bodyMedium)
            .foregroundStyle(warning ? theme.palette.error : theme.palette.onSurfaceVariant)
    }
}

private struct BriefingFlagBadge: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(theme.typography.labelMedium)
            .foregroundStyle(theme.palette.onSecondaryContainer)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(theme.palette.secondaryContainer, in: Capsule())
    }
}

private struct BriefingItemActions: View {
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var auth: AuthViewModel
    let url: String
    /// 사용 기록(`source_opened`)에 싣는 원천 종류. 링크는 기록에 싣지 않는다.
    let source: BriefingSource
    let onSpeech: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Button(String(localized: "원문 보기")) {
                if let link = URL(string: url) {
                    BriefingUsageSignals.sourceOpened(source, userID: auth.session?.user.id)
                    openURL(link)
                }
            }
            Button(String(localized: "음성 문장"), action: onSpeech)
        }
        .font(.subheadline.weight(.semibold))
        .buttonStyle(.borderless)
        .padding(.vertical, 2)
    }
}

/// 기업 찾기 — 입력칸 + 결과 목록. 결과 행을 누르면 그 기업을 고른다. 안드로이드는 같은 내용을 알럿 껍데기로 그린다.
private struct BriefingSearchSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    let selectedCodes: [String]
    let onPick: (BriefingCompany) -> Void
    let onClose: () -> Void

    @State private var query = ""
    @State private var results: [BriefingCompany]?
    @State private var searching = false
    @State private var message: String?
    @State private var retryAt: Date?

    /// 검색어 상한(정리한 뒤) — shared `BRIEFING_SEARCH_QUERY_MAX`. 서버가 같은 상한으로 다시 막는다.
    private static let queryMax = 30

    var body: some View {
        FormSheet(
            title: String(localized: "기업 찾기"),
            saveTitle: String(localized: "검색"),
            cancelTitle: String(localized: "닫기"),
            saveEnabled: !searching,
            onCancel: onClose,
            onSave: { Task { await search() } }
        ) {
            VStack(alignment: .leading, spacing: 12) {
                Text(String(localized: "상장 기업의 이름 일부나 종목코드(6자리)로 찾아요."))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                TextField(String(localized: "기업 이름 또는 종목코드"), text: $query)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                    .onSubmit { Task { await search() } }
                    .alarmTalkFieldStyle()
                    .onChange(of: query) { _, new in
                        let cleaned = InputSanitizer.clamp(InputSanitizer.sanitizeUserText(new), max: Self.queryMax)
                        if cleaned != new { query = cleaned }
                    }
                if searching { ProgressView() }
                if let message {
                    Text(verbatim: message)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.error)
                }
                if let results {
                    if results.isEmpty {
                        Text(String(localized: "찾는 기업이 없어요. 상장 기업만 찾을 수 있어요."))
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                    ForEach(results) { company in
                        let added = selectedCodes.contains(company.corpCode)
                        Button {
                            onPick(company)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(verbatim: company.corpName)
                                        .foregroundStyle(theme.palette.onSurface)
                                    if let stock = company.stockCode?.nilIfBlank {
                                        Text(verbatim: stock)
                                            .font(theme.typography.bodySmall)
                                            .foregroundStyle(theme.palette.onSurfaceVariant)
                                    }
                                }
                                Spacer(minLength: 12)
                                if added {
                                    Text(String(localized: "추가됨"))
                                        .font(theme.typography.bodySmall)
                                        .foregroundStyle(theme.palette.onSurfaceVariant)
                                }
                            }
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(added)
                        Divider()
                    }
                }
            }
        }
    }

    private func search() async {
        let text = InputSanitizer.sanitizeUserText(query).trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !searching, let token = auth.session?.token else { return }
        if let retryAt, Date() < retryAt {
            message = APIErrorMessages.message(for: "BRIEFING_CORP_CODES_NOT_READY")
            return
        }
        searching = true
        defer { searching = false }
        do {
            results = try await AlarmTalkAPI.shared.searchBriefingCompanies(query: text, token: token)
            message = nil
        } catch {
            if (error as? APIError)?.serverErrorCode == "BRIEFING_CORP_CODES_NOT_READY" {
                retryAt = Date().addingTimeInterval(TimeInterval(BriefingPresentation.corpCodesNotReadyRetrySeconds))
            }
            message = APIErrorMessages.message(
                for: error,
                fallback: String(localized: "소식을 불러오지 못했어요. 잠시 뒤에 다시 확인해 주세요.")
            )
        }
    }
}

/// 음성 문장 미리보기 — 최종 문장·글자 수·목소리·차감 안내를 함께 보여 주고, 확인해야 만든다(`docs/spec/morning-briefing.md`
/// §8 「요청형 음성」). 만들기는 직접 입력과 같은 요청(`POST /tts/generate`, `custom`·`ko`·`request_id`)이다.
private struct BriefingSpeechSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    let target: BriefingSpeechTarget
    let voices: [BriefingVoiceChoice]
    let initialVoiceID: String?
    let onClose: () -> Void

    @State private var voiceID: String?
    @State private var quota: ManualQuotaResponse?
    @State private var generating = false
    @State private var message: String?
    @State private var audioURL: URL?
    @State private var requestIDs = BriefingRequestIDs()
    /// 만드는 중인 요청 — 창을 닫으면 끊는다. 안 끊으면 닫은 뒤에 응답이 와서 아무 조작 없이 소리가 난다(코덱스 #957).
    @State private var generateTask: Task<Void, Never>?
    @StateObject private var player = AudioPreviewPlayer()

    var body: some View {
        FormSheet(
            title: String(localized: "음성 문장 미리보기"),
            saveTitle: audioURL == nil ? String(localized: "음성 만들기") : String(localized: "다시 듣기"),
            cancelTitle: String(localized: "닫기"),
            saveEnabled: !generating && voiceID != nil,
            onCancel: {
                generateTask?.cancel()
                player.stop()
                onClose()
            },
            onSave: {
                if let audioURL {
                    play(audioURL)
                } else {
                    generateTask = Task { await generate() }
                }
            }
        ) {
            VStack(alignment: .leading, spacing: 12) {
                Text(verbatim: target.text)
                    .font(theme.typography.bodyLarge)
                    .foregroundStyle(theme.palette.onSurface)
                Text(String(localized: "\(Int(target.text.utf16.count))/\(Int(BriefingSpeech.maxLength))자"))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Text(String(localized: "목소리"))
                    .font(theme.typography.bodyMedium.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurface)
                ForEach(voices) { voice in
                    Button {
                        guard voiceID != voice.id else { return }
                        voiceID = voice.id
                        // 목소리가 바뀌면 다른 결과다 — 들려줄 것을 비운다.
                        audioURL = nil
                        message = nil
                    } label: {
                        HStack {
                            Text(verbatim: voice.name).foregroundStyle(theme.palette.onSurface)
                            Spacer(minLength: 12)
                            if voiceID == voice.id {
                                Image(systemName: "checkmark").foregroundStyle(theme.palette.primary)
                            }
                        }
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(generating)
                }
                Text(String(localized: "음성을 받을 때마다 이번 달 직접 입력 횟수를 1회 써요. 같은 문장·같은 목소리로 이미 만든 음성도 다시 받으면 1회를 써요."))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                if let quota, quota.limit > 0 {
                    Text(String(localized: "이번 달 남은 횟수 \(Int(max(quota.remaining, 0)))회"))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                if generating { ProgressView() }
                if let message {
                    Text(verbatim: message)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(audioURL == nil ? theme.palette.error : theme.palette.primary)
                }
            }
        }
        .task {
            if voiceID == nil { voiceID = initialVoiceID ?? voices.first?.id }
            if let token = auth.session?.token {
                quota = try? await AlarmTalkAPI.shared.manualQuota(token: token)
            }
        }
        .onDisappear {
            generateTask?.cancel()
            player.stop()
        }
    }

    private func generate() async {
        guard let voiceID, !generating else { return }
        guard let token = auth.session?.token else {
            message = String(localized: "아침 소식은 로그인 후 볼 수 있어요.")
            return
        }
        generating = true
        message = nil
        defer { generating = false }
        // 요청을 보내기 전에 적는다 — 실패해도 '요청했다' 는 남는다. 문장은 싣지 않는다.
        BriefingUsageSignals.audioRequested(target.source, voiceID: voiceID, userID: auth.session?.user.id)
        do {
            let response = try await AlarmTalkAPI.shared.generateTTS(
                TtsGenerateRequest(
                    voiceProfileId: voiceID,
                    text: target.text,
                    category: "custom",
                    language: "ko",
                    translate: false,
                    random: false,
                    requestId: requestIDs.idFor(profileID: voiceID, language: "ko", text: target.text)
                ),
                token: token
            )
            requestIDs.completed()
            // 창을 닫았으면 들려주지 않는다. 서버가 처리한 요청이라 그 1회는 이미 셌다(다시 열어 받으면 새 요청이라 또 1회다).
            guard !Task.isCancelled else { return }
            let url = try Self.writeSpeechFile(response)
            audioURL = url
            message = String(localized: "음성을 만들었어요.")
            play(url)
            quota = (try? await AlarmTalkAPI.shared.manualQuota(token: token)) ?? quota
        } catch {
            message = APIErrorMessages.message(
                for: error,
                fallback: String(localized: "음성을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")
            )
        }
    }

    private func play(_ url: URL) {
        try? player.play(url: url)
    }

    /// 받은 음성을 캐시 폴더의 한 파일에 쓴다(한 번 듣고 버리는 파일 — 알람에 붙이지 않는다).
    private static func writeSpeechFile(_ response: TtsGenerateResponse) throws -> URL {
        guard let data = Data(base64Encoded: response.audioBase64, options: .ignoreUnknownCharacters) else {
            throw APIError.invalidResponse
        }
        let ext = response.audioFormat.lowercased().filter { $0.isLetter || $0.isNumber }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("briefing-speech", isDirectory: true)
        try? FileManager.default.removeItem(at: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("speech.\(ext.isEmpty ? "mp3" : ext)")
        try data.write(to: url)
        return url
    }
}
