import SwiftUI
import UIKit

/// 무료 등급 + 시스템(스톡) 보이스 선택 시 알람 에디터에 노출되는 "기본 제공 음성"
/// 접기/펼치기 카드. Android `VoiceAudioCard.kt` 의 `StockClipDropdown` 미러.
///
/// 표시 규칙:
/// - 카드 헤더(제목 + 부제 + 펼침 chevron)를 탭하면 펼쳐진다. 기본 접힘.
/// - 펼치면 클립이 가진 언어들(ko/en/ja)을 칩으로 보여주고(고정 순서), 선택 언어의
///   클립을 앱 카테고리 순서(기상→점심→…→운동)대로 행으로 나열한다.
/// - 각 행: 카테고리 라벨(알 수 없으면 숨김) + 클립 본문(최대 3줄) + 미리듣기 버튼 +
///   선택 시 체크. 행 본문 탭 = 선택, 버튼 = 미리듣기.
///
/// 입력 `clips` 는 호출자가 (선택된 프로필 + greeting 제외)로 이미 필터링해 전달한다.
/// 안전망으로 내부에서도 greeting 을 한 번 더 거른다.
struct StockClipPicker: View {
    let clips: [StockClip]
    let selectedMessageID: String?
    let previewingMessageID: String?
    /// 다운로드 중인 클립의 messageId. 행에 스피너를 띄울지 결정한다(change 2).
    let preparingMessageID: String?
    let onPreview: (StockClip) -> Void
    let onSelect: (StockClip) -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    @State private var expanded = false
    @State private var selectedLang: String = "ko"

    /// greeting 은 어떤 경로로 들어와도 노출하지 않는다(호출자 필터의 안전망).
    private var visibleClips: [StockClip] {
        clips.filter { $0.category != Self.greetingCategory }
    }

    /// 클립이 가진 언어들 — 고정 순서(ko/en/ja), 알 수 없는 언어는 뒤로.
    private var languages: [String] {
        let distinct = Array(Set(visibleClips.compactMap { $0.language }))
        return distinct.sorted { lhs, rhs in
            Self.languageOrder(lhs) < Self.languageOrder(rhs)
        }
    }

    /// 선택 언어의 클립을 앱 카테고리 순서대로. 매칭이 없으면 첫 클립이라도 보여준다.
    private var activeClips: [StockClip] {
        let matched = visibleClips
            .filter { $0.language == selectedLang }
            .sorted { Self.categoryOrder($0.category) < Self.categoryOrder($1.category) }
        if matched.isEmpty, let first = visibleClips.first {
            return [first]
        }
        return matched
    }

    var body: some View {
        if visibleClips.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                header
                if expanded {
                    expandedBody
                }
            }
            .background(theme.palette.surfaceVariant.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .onAppear {
                resolveDefaultLanguage()
                // 아직 고른 클립이 없으면(무료 사용자의 유일한 음성 경로) 처음부터 펼쳐
                // 보여줘 한 번 더 탭하지 않고 바로 고를 수 있게 한다.
                if selectedMessageID == nil {
                    expanded = true
                }
            }
            .onChange(of: clips) { _, _ in resolveDefaultLanguage() }
        }
    }

    // MARK: - Header

    private var header: some View {
        Button {
            expanded.toggle()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("기본 제공 알람 음성")
                        .font(theme.typography.labelLarge)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    Text("미리 듣고 바로 사용할 수 있어요")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer(minLength: 0)
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Expanded body

    private var expandedBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            if languages.count > 1 {
                HStack(spacing: 8) {
                    ForEach(languages, id: \.self) { lang in
                        languageChip(lang)
                    }
                }
            }
            ForEach(activeClips) { clip in
                StockClipRow(
                    categoryLabel: Self.categoryLabel(clip.category),
                    text: clip.text,
                    selected: clip.id == selectedMessageID,
                    previewing: clip.id == previewingMessageID,
                    preparing: clip.id == preparingMessageID,
                    onPreview: { onPreview(clip) },
                    onSelect: { onSelect(clip) }
                )
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 12)
    }

    private func languageChip(_ lang: String) -> some View {
        let selected = lang == selectedLang
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            selectedLang = lang
        } label: {
            Text(Self.languageLabel(lang))
                .font(theme.typography.labelLarge)
                .fontWeight(selected ? .bold : .semibold)
                .foregroundStyle(selected ? theme.palette.onPrimaryContainer : theme.palette.onSurfaceVariant)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(selected ? theme.palette.primaryContainer : theme.palette.surfaceVariant.opacity(0.5))
                .overlay(
                    Capsule().stroke(
                        selected ? theme.palette.primary.opacity(0.5) : theme.palette.outlineVariant.opacity(0.62),
                        lineWidth: 1
                    )
                )
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Default language

    private func resolveDefaultLanguage() {
        // 이미 선택된 클립의 언어를 우선, 없으면 ko, 없으면 첫 언어.
        if let selectedClipLang = visibleClips.first(where: { $0.id == selectedMessageID })?.language,
           languages.contains(selectedClipLang) {
            selectedLang = selectedClipLang
            return
        }
        if languages.contains("ko") {
            selectedLang = "ko"
        } else if let first = languages.first {
            selectedLang = first
        }
    }

    // MARK: - Static maps (mirror Android StockClipLanguageOrder + TtsCategories)

    static let greetingCategory = "greeting"

    /// 언어 칩 순서. 알 수 없는 언어는 뒤로(Int.max).
    private static let languageOrderList = ["ko", "en", "ja"]

    private static func languageOrder(_ language: String?) -> Int {
        guard let language, let index = languageOrderList.firstIndex(of: language) else {
            return Int.max
        }
        return index
    }

    /// Android `r3ed_stock_clip_lang_*` 와 동일 라벨.
    private static func languageLabel(_ language: String?) -> String {
        switch language {
        case "ko": return "한국어"
        case "en": return "English"
        case "ja": return "日本語"
        default: return language ?? ""
        }
    }

    /// 앱 카테고리 표시 순서. Android `TtsCategories` 와 동일.
    private static let categoryOrderList = [
        "morning", "lunch", "evening", "night", "health",
        "medication", "study", "cheer", "love", "exercise",
    ]

    private static func categoryOrder(_ category: String?) -> Int {
        guard let category, let index = categoryOrderList.firstIndex(of: category) else {
            return Int.max
        }
        return index
    }

    /// 카테고리 한국어 라벨. 알 수 없는 카테고리(예: greeting)는 nil → 라벨 숨김.
    /// Android `editor2_cat_*` 와 동일하며, iOS MessagesView 에 빠져 있는
    /// medication("약")·exercise("운동")까지 모두 포함한다.
    private static func categoryLabel(_ category: String?) -> String? {
        switch category {
        case "morning": return "기상"
        case "lunch": return "점심 식사"
        case "evening": return "퇴근"
        case "night": return "밤"
        case "health": return "건강"
        case "medication": return "약"
        case "study": return "공부"
        case "cheer": return "응원"
        case "love": return "사랑"
        case "exercise": return "운동"
        default: return nil
        }
    }
}

/// 스톡 클립 한 행. 본문 탭 = 선택, 재생 버튼 = 미리듣기.
private struct StockClipRow: View {
    let categoryLabel: String?
    let text: String
    let selected: Bool
    let previewing: Bool
    /// 네트워크 다운로드 중이면 재생/정지 아이콘 대신 스피너를 보여준다(change 2).
    /// Android `VoicePreviewButtonIcon(active, preparing)` (VoiceInputControls.kt:62-84) 미러.
    let preparing: Bool
    let onPreview: () -> Void
    let onSelect: () -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onSelect()
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    if let categoryLabel {
                        Text(categoryLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(selected ? theme.palette.onSecondaryContainer : theme.palette.onSurfaceVariant)
                    }
                    Text(text)
                        .font(theme.typography.bodyMedium)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .foregroundStyle(selected ? theme.palette.onSecondaryContainer : theme.palette.onSurface)
                }
                Spacer(minLength: 8)
                Button(action: onPreview) {
                    Group {
                        if preparing {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: previewing ? "stop.fill" : "play.fill")
                                .font(.headline)
                                .foregroundStyle(theme.palette.primary)
                        }
                    }
                    // 아이콘은 작게 두되 탭 영역은 44×44 로 넓혀 누르기 쉽게 한다(HIG 최소 터치 타깃).
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(preparing)
                .accessibilityLabel(Text(preparing ? "준비 중" : (previewing ? "정지" : "미리듣기")))
                if selected {
                    Image(systemName: "checkmark")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.palette.primary)
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.palette.secondaryContainer : theme.palette.surface.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
#Preview("StockClipPicker") {
    StockClipPicker(
        clips: [
            StockClip(messageId: "1", voiceProfileId: "v", voiceName: "샘", category: "morning", language: "ko", text: "좋은 아침이에요! 일어나세요!", audioUrl: nil),
            StockClip(messageId: "2", voiceProfileId: "v", voiceName: "샘", category: "lunch", language: "ko", text: "점심 시간이에요. 맛있게 드세요!", audioUrl: nil),
            StockClip(messageId: "3", voiceProfileId: "v", voiceName: "Sam", category: "morning", language: "en", text: "Good morning! Time to wake up!", audioUrl: nil),
        ],
        selectedMessageID: "1",
        previewingMessageID: nil,
        preparingMessageID: "2",
        onPreview: { _ in },
        onSelect: { _ in }
    )
    .padding()
    .voiceAlarmPreviewEnvironment()
}
#endif
