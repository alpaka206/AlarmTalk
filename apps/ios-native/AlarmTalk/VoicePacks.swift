import CryptoKit
import Foundation

// MARK: - 추가 음성팩 — 상수·모델·판정(`docs/spec/voice-packs.md`)
//
// 팩은 권리를 확인한 **무료 고정 목소리**다. 팩 목소리는 목소리 프로필이 아니라 `voice_id`(아래 대역)를 따로 갖는다 —
// 직접 입력 합성·목소리 등록·접근권 대조(`GET /voice`)가 그 목소리를 모른다(스펙 §1).
// 안드로이드 짝은 `data/VoicePacks.kt` 의 `isVoicePackVoiceId`·`voicePackCacheKey`.

/// 팩 목소리 id 의 대역. 기본 목소리(`…-9000-`)와 겹치지 않는다. 서버 `VOICE_PACK_VOICE_ID_PREFIX` 와 같다.
let voicePackVoiceIDPrefix = "70000000-0000-4000-9100-"

/// 추가 음성팩 목소리 id 인가.
func isVoicePackVoiceID(_ id: String?) -> Bool {
    id?.hasPrefix(voicePackVoiceIDPrefix) == true
}

/// **무료로 쓰는 고정 목소리**인가 — 기본 목소리 4종 또는 추가 팩. 무료 판정(예약·잠금·편집기)이 본다.
///
/// ⚠ 기본 목소리만 뜻하는 자리(접근권 대조·언어 재바인딩·기본 4종 받기 관문·'이미 기본 목소리면 그대로' 대체)에는
/// 쓰지 말 것 — 그 자리는 `isSystemVoiceId` 를 그대로 본다.
func isFreeFixedVoiceID(_ id: String?) -> Bool {
    isSystemVoiceId(id) || isVoicePackVoiceID(id)
}

enum VoicePacks {
    /// 팩 클립 캐시 키 접두. 기본 목소리 `stock_` 와 따로 둔다 — 기본 목소리 매니페스트 기준 정리
    /// (`AudioCacheStore.pruneReplacedStockAudio`)가 팩 파일을 지우지 않게, 오래된 캐시 정리도 건너뛴다.
    static let cacheKeyPrefix = "pack_"

    static func cacheKey(clipID: String) -> String { "\(cacheKeyPrefix)\(clipID)" }

    /// 캐시 메타에 적는 **원격 식별자**. 해시가 바뀌면(같은 자리 교체는 새 clip id 지만 방어로) 낡은 것으로 보고 다시 받는다.
    static func remoteIdentity(packID: String, clipID: String, sha256: String) -> String {
        "voice-pack://\(packID)/\(clipID)?sha256=\(sha256)"
    }

    /// 식별자에서 팩 id 를 되짚는다(편집기 다운로드 폴백이 팩 오디오 경로를 고를 때).
    static func packID(fromIdentity identity: String?) -> String? {
        guard let identity, identity.hasPrefix("voice-pack://") else { return nil }
        let rest = identity.dropFirst("voice-pack://".count)
        guard let slash = rest.firstIndex(of: "/") else { return nil }
        let packID = String(rest[..<slash])
        return packID.isEmpty ? nil : packID
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// 받은 바이트가 **상세가 말한 해시·크기와 같은가**. 다르면 캐시에 넣지 않는다(스펙 §7 「받기」).
    static func bytesMatch(_ data: Data, sha256: String, sizeBytes: Int) -> Bool {
        !data.isEmpty && data.count == sizeBytes && sha256Hex(data) == sha256.lowercased()
    }
}

extension StockClip {
    /// 이 클립의 캐시 키 — 팩 클립은 `pack_<clipId>`, 그 밖은 `stock_<messageId>`.
    var cacheKey: String {
        isVoicePackVoiceID(voiceProfileId)
            ? VoicePacks.cacheKey(clipID: messageId)
            : AudioCacheStore.stockCacheKey(messageId: messageId)
    }
}

extension AudioCacheStore {
    /// 기본 목소리·팩의 **고정 클립** 캐시 키인가(테마 알람의 저장·복원이 본다).
    nonisolated static func isFixedClipCacheKey(_ key: String?) -> Bool {
        guard let key else { return false }
        return key.hasPrefix(stockCacheKeyPrefix) || key.hasPrefix(VoicePacks.cacheKeyPrefix)
    }
}

// MARK: - API 모델(`routes/voice-packs.ts` 의 `toPublicPack` 과 같은 이름 — 디코더가 snake_case 를 바꾼다)

struct VoicePackPreview: Codable, Equatable {
    var clipId: String
    var sizeBytes: Int
}

struct VoicePackClip: Codable, Equatable {
    var clipId: String
    var category: String
    var language: String
    var variant: Int
    var text: String
    var sha256: String
    var sizeBytes: Int
    var audioFormat: String
}

struct VoicePackSummary: Codable, Equatable, Identifiable {
    var packId: String
    var voiceId: String
    var contentRevision: Int
    var speakerName: String
    var description: String
    var usageNote: String
    var language: String
    var categories: [String]
    var clipCount: Int
    var totalBytes: Int
    var preview: VoicePackPreview?
    var clips: [VoicePackClip]?

    var id: String { packId }
}

struct VoicePackWithdrawal: Codable, Equatable {
    var packId: String
    var voiceId: String
    /// ISO-8601. 이 시각까지는 기존 알람이 그 팩으로 운다(스펙 §5).
    var playbackUntil: String

    var playbackUntilDate: Date? { VoicePacks.parseInstant(playbackUntil) }
}

struct VoicePackListResponse: Codable, Equatable {
    var packs: [VoicePackSummary]
    var withdrawn: [VoicePackWithdrawal]
}

struct VoicePackDetailResponse: Codable, Equatable {
    var pack: VoicePackSummary
}

struct VoicePackAudioResponse: Codable, Equatable {
    var clipId: String
    var packId: String
    var audioBase64: String
    var audioFormat: String
    var sha256: String
    var sizeBytes: Int
}

extension VoicePacks {
    static func parseInstant(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
}

// MARK: - 받은 팩(계정별 저장 — `VoicePackStore`)

struct HeldVoicePack: Codable, Equatable, Identifiable {
    enum State: String, Codable {
        case downloading
        case ready
    }

    var packId: String
    var voiceId: String
    var speakerName: String
    var language: String
    var description: String
    var usageNote: String
    /// 적어 둔 상세(`clips`)의 개정.
    var contentRevision: Int
    /// 카탈로그가 마지막으로 말한 개정. `contentRevision` 과 다르면 상세를 다시 받는다.
    var latestRevision: Int
    var clips: [VoicePackClip]
    var state: State
    var previewClipId: String?
    /// 게시가 끝난 팩의 기존 재생 기한(카탈로그 `withdrawn`). nil 이면 게시 중이다.
    var withdrawnPlaybackUntil: Date?

    var id: String { packId }

    var totalBytes: Int { clips.reduce(0) { $0 + $1.sizeBytes } }

    /// 편집기·바인딩이 쓰는 스톡 클립 모양. 캐시 키는 `StockClip.cacheKey`(=`pack_<clipId>`).
    var stockClips: [StockClip] {
        clips.map {
            StockClip(
                messageId: $0.clipId,
                voiceProfileId: voiceId,
                voiceName: speakerName,
                category: $0.category,
                language: $0.language,
                text: $0.text,
                audioUrl: VoicePacks.remoteIdentity(packID: packId, clipID: $0.clipId, sha256: $0.sha256),
                variant: $0.variant,
                renderedForCurrentVoice: true
            )
        }
    }

    /// 편집기 목소리 목록에 넣는 모양. `isSystem: true` — 편집기에서는 기본 목소리처럼(무료·테마 클립) 다룬다.
    var voiceProfile: VoiceProfile {
        VoiceProfile(id: voiceId, name: speakerName, status: "ready", isSystem: true)
    }

    /// 기한이 지났는가(대체 대상).
    func isExpired(now: Date) -> Bool {
        guard let until = withdrawnPlaybackUntil else { return false }
        return until <= now
    }

    /// 알람 테마 클립(미리듣기 인사말 제외) — 받기 진행의 분모.
    var downloadTargets: [VoicePackClip] { clips }
}

extension VoicePacks {
    /// 팩 목소리로 운 알람을 저장했다(`pack_selected`, `docs/spec/usage-events.md` §7.1) — 칸은 `pack_id`(팩 id) 하나다. 원문·문구·
    /// 클립 id 는 싣지 않는다. 저장 성공 한 곳(`AlarmEditorSheet.finishScheduling`)이 부른다. 팩 목소리가 아니거나, 그 목소리로 울지
    /// 않거나(알람 모드·직접 녹음), 받은 팩 목록에서 그 목소리의 팩을 못 찾으면 nil. 안드로이드 `packSelectionProps` 짝.
    static func packSelectionProps(for record: LocalAlarmRecord, held: [HeldVoicePack]) -> UsageEventProps? {
        guard isVoicePackVoiceID(record.voiceProfileId),
              record.voiceSourceEnum == .ttsProfile,
              record.playModeEnum != .alarmOnly,
              let pack = held.first(where: { $0.voiceId == record.voiceProfileId }) else { return nil }
        return UsageEventProps(packID: pack.packId)
    }

    /// **편집기 목소리 목록**에 넣을 팩 — 다 받았고 게시 중인 팩, 그리고 **지금 여는 알람이 이미 쓰는 팩**(게시가 끝나도
    /// 대체 전까지는 그 알람에서 그대로 보이고 저장된다 — 스펙 §5-1).
    ///
    /// ⚠ 지금 알람의 팩은 **새 개정을 받는 중이어도** 남긴다. 빼면 편집기가 그 목소리를 고를 수 없는 것으로 읽고 다른 목소리로
    /// 갈아 끼워, 시각만 고쳐 저장해도 팩 목소리가 바뀐다(코덱스 #960). 새로 고르는 목록에는 다 받은 팩만 나온다.
    static func editorEntries(
        held: [HeldVoicePack],
        keepingVoiceID: String?
    ) -> (profiles: [VoiceProfile], clips: [StockClip]) {
        let chosen = held.filter { pack in
            pack.voiceId == keepingVoiceID || (pack.state == .ready && pack.withdrawnPlaybackUntil == nil)
        }
        return (chosen.map(\.voiceProfile), chosen.flatMap(\.stockClips))
    }

    /// 카탈로그를 받아 둔 팩에 반영한다 — 게시 중이면 기한을 지우고 최신 개정을 적고, `withdrawn` 에 있으면 기한을 적는다.
    /// ⚠ **둘 다에 없는 팩은 그대로 둔다**(최소 빌드·지역으로 안 보일 뿐이다 — 스펙 §5-5).
    static func applyCatalog(_ response: VoicePackListResponse, to held: [HeldVoicePack]) -> [HeldVoicePack] {
        held.map { pack in
            var next = pack
            if let listed = response.packs.first(where: { $0.packId == pack.packId }) {
                next.withdrawnPlaybackUntil = nil
                next.latestRevision = listed.contentRevision
            } else if let gone = response.withdrawn.first(where: { $0.packId == pack.packId }) {
                next.withdrawnPlaybackUntil = gone.playbackUntilDate ?? Date()
            }
            return next
        }
    }

    /// 상세로 받은 팩을 받은 팩 모양으로(새로 받거나 개정이 바뀌었을 때). 상태는 언제나 **받는 중**이다 — 클립 목록이 새로 왔으니
    /// 그 클립을 다 받아 대조할 때까지 '받음' 이 아니다(받기 회차가 `finishDownload` 로 정한다). 앞 상태를 이어받으면 새 클립
    /// 받기가 실패해도 '받음' 으로 남아 편집기가 덜 받은 개정을 내보인다(코덱스 #960). 안드로이드 `HeldVoicePack.fromDetail` 짝.
    static func held(from detail: VoicePackSummary, previous: HeldVoicePack?) -> HeldVoicePack {
        HeldVoicePack(
            packId: detail.packId,
            voiceId: detail.voiceId,
            speakerName: detail.speakerName,
            language: detail.language,
            description: detail.description,
            usageNote: detail.usageNote,
            contentRevision: detail.contentRevision,
            latestRevision: detail.contentRevision,
            clips: detail.clips ?? [],
            state: .downloading,
            previewClipId: detail.preview?.clipId,
            withdrawnPlaybackUntil: previous?.withdrawnPlaybackUntil
        )
    }

    /// 아직 캐시에 없거나 해시가 다른 클립.
    nonisolated static func missingClips(of pack: HeldVoicePack, cache: AudioCacheStore = .shared) -> [VoicePackClip] {
        let requests = pack.clips.map {
            (
                cacheKey: cacheKey(clipID: $0.clipId),
                remoteAudioUri: Optional(remoteIdentity(packID: pack.packId, clipID: $0.clipId, sha256: $0.sha256))
            )
        }
        let missing = cache.missingOrStaleCacheKeys(requests)
        return pack.clips.filter { missing.contains(cacheKey(clipID: $0.clipId)) }
    }
}
