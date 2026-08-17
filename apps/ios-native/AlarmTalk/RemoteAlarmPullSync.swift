import Foundation
import os

// MARK: - RemoteAlarmPullSync
//
// Android `RemoteAlarmPullSyncService.kt` 와 동등 기능.
//
// 책임:
//   1. 서버에서 알람 목록을 받아 로컬과 머지한다.
//   2. 신규 receivedRemote 알람은 자동으로 AlarmKit 에 스케줄한다.
//   3. 서버에 남아 있는 알람에 한해 TTS 음원을 캐싱한다.
//   4. 서버에서 사라진 receivedRemote 알람은 로컬에서도 cascade 삭제한다.
//
// 충돌 정책:
//   - 로컬이 dirty 면 서버 응답을 덮어쓰지 않는다 (다음 push 에서 로컬 변경을 반영).
//   - **받은 알람을 수신자가 한 번이라도 고쳤으면 서버 응답을 다시 입히지 않는다**
//     (`locallyEditedByRecipient`). 받은 뒤로는 그 알람이 수신자 것이고, 보낸 사람에게는
//     고칠 수단이 없어 서버 값은 최초 씨앗일 뿐이다 → docs/spec/family-alarm.md 1-1절.
//     받은 알람은 항상 `.synced` 로 파생되므로(`nextLocalSyncState`) dirty 로는 못 지킨다.
//   - 그 외에는 last write wins: lastSyncedAtMillis 가 더 최신인 쪽을 채택한다.
//
// 호출 컨텍스트:
//   - `BackgroundSyncTask` 가 15분 주기로 호출 (pull 먼저, push 뒤)
//   - 로그인 직후 / 포그라운드 진입 시 `RemoteAlarmSyncViewModel.refresh()` 가 호출
//
// Sendable 안전성:
//   - 모든 mutable state 와 메서드가 `@MainActor` 격리되어 외부 race condition 이
//     본질적으로 발생하지 않는다. `BGTaskScheduler.shared.register` 가 요구하는
//     `@Sendable` 클로저 안에서 인스턴스를 capture 해야 하므로 (Swift 6 strict
//     concurrency 대비), `@unchecked Sendable` 로 명시적 인증을 표기한다.
//     실제 transfer 는 MainActor 로 즉시 hop 한 뒤에만 사용된다.
@MainActor
final class RemoteAlarmPullSync: @unchecked Sendable {

    enum PullError: LocalizedError, Equatable {
        case noSession

        var errorDescription: String? {
            switch self {
            case .noSession: return "Pull sync requires an active session."
            }
        }
    }

    /// 한 pull 사이클의 집계. Android `RemoteAlarmPullResult` 와 동일한 카운터를
    /// 가지며, `PushResult` 와 같은 스타일을 따른다.
    ///   - imported: 신규 import (로컬에 없던 receivedRemote 를 새로 저장)
    ///   - updated:  기존 receivedRemote 갱신
    ///   - skipped:  time 등이 유효하지 않아 mapped 가 nil 인 행 (07:00 보정 없이 skip)
    ///   - failed:   단일 알람 머지 중 throw 된 행 (사이클 전체를 중단시키지 않음)
    struct PullResult: Equatable, Sendable {
        var imported: Int
        var updated: Int
        var skipped: Int
        var failed: Int
    }

    /// 단일 remote 알람 머지의 결과 분류. `runOnce` 의 카운터 집계에만 쓰인다.
    private enum MergeOutcome {
        case imported
        case updated
        /// 충돌 정책(`shouldApplyRemote == false`)으로 서버 응답을 적용하지 않음.
        /// Android 와 동일하게 imported/updated/failed 어디에도 포함되지 않는다.
        case unchanged
    }

    private let api: AlarmTalkAPI
    private let store: LocalAlarmStore
    private let alarmKit: AlarmKitViewModel
    private let audioCache: AudioCacheStore
    private let auth: AuthViewModel

    /// 캐싱 실패 등 비정상 경로 기록용. 코드베이스에 공용 로깅 유틸이 없어
    /// os.Logger 를 직접 사용한다 (print 금지 — 콘솔/Instruments 에서 필터 가능).
    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "AlarmTalk",
        category: "RemoteAlarmPullSync"
    )

    init(
        api: AlarmTalkAPI = .shared,
        store: LocalAlarmStore,
        alarmKit: AlarmKitViewModel,
        audioCache: AudioCacheStore = .shared,
        auth: AuthViewModel
    ) {
        self.api = api
        self.store = store
        self.alarmKit = alarmKit
        self.audioCache = audioCache
        self.auth = auth
    }

    /// **타입 단위** 겹침 가드. push 쪽(`RemoteAlarmPushSync`)과 같은 이유다 —
    /// 인스턴스는 둘(`RemoteAlarmSyncViewModel` / `AlarmTalkApp` 백그라운드)인데
    /// `LocalAlarmStore` 는 하나다.
    ///
    /// pull 쪽 증상은 push 보다 직접적이다: `mergeRemote` 가 기존 행을 찾은 뒤
    /// `recordWithCachedTTSIfNeeded` 에서 **음원을 통째로 내려받고**(수 초) 그 다음에야
    /// upsert 한다. 그 창에서 겹치면 같은 받은-알람이 **로컬에 두 행**으로 들어오고 둘 다
    /// 예약돼 **같은 알람이 두 번 울린다.** 하나를 꺼도 다른 하나가 울린다.
    private static var isRunning = false
    private static var requestedWhileRunning = false

    /// pull 사이클을 수행한다. **동시 호출은 이 함수가 직렬화한다** — 호출자가 막지
    /// 않아도 된다(예전 주석은 "호출자가 동시 호출을 방지해야 한다" 였는데, 실제로는
    /// 아무도 막고 있지 않았다).
    ///
    /// 반환하는 `PullResult` 는 Android `RemoteAlarmPullSyncService.pullReceivedAlarms`
    /// 의 카운터와 동일한 의미를 가진다. `BackgroundSyncTask` 가 retry 판단에 사용한다.
    /// 미뤄 둔 회차가 함께 돌면 카운터는 **합산**된다.
    @discardableResult
    func runOnce() async throws -> PullResult {
        if Self.isRunning {
            Self.requestedWhileRunning = true
            return PullResult(imported: 0, updated: 0, skipped: 0, failed: 0)
        }
        Self.isRunning = true
        defer { Self.isRunning = false }

        var total = PullResult(imported: 0, updated: 0, skipped: 0, failed: 0)
        repeat {
            Self.requestedWhileRunning = false
            let cycle = try await runCycle()
            total = PullResult(
                imported: total.imported + cycle.imported,
                updated: total.updated + cycle.updated,
                skipped: total.skipped + cycle.skipped,
                failed: total.failed + cycle.failed
            )
        } while Self.requestedWhileRunning
        return total
    }

    /// 한 회차. **세션은 회차마다 다시 읽는다**(안드로이드 `2836ebcf`) — 미뤄 둔 회차가
    /// 앞 회차의 왕복 뒤에 도는데, 그 사이 로그아웃/계정 전환이 있었으면 옛 토큰으로 나간다.
    private func runCycle() async throws -> PullResult {
        guard let session = auth.session else { throw PullError.noSession }
        let userID = session.user.id
        let token = session.token

        let remoteAlarms = try await api.listAlarms(token: token)
        let receivedRemoteAlarms = remoteAlarms.filter {
            Self.isReceivedRemoteCandidate($0, currentUserID: userID)
        }
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)

        // 1. 신규/갱신 처리.
        // Android `buildLocalAlarm` 과 동일하게, time 이 유효하지 않은 행(mapped == nil)은
        // 07:00 같은 디폴트로 보정하지 않고 그대로 skip 하고 카운트만 남긴다.
        var imported = 0
        var updated = 0
        var skipped = 0
        var failed = 0
        for remote in receivedRemoteAlarms {
            guard let mapped = RemoteAlarmMapper.toLocalRecord(
                remote,
                currentUserID: userID,
                nowMillis: nowMillis
            ) else {
                skipped += 1
                continue
            }
            // Android 의 per-alarm `runCatching` 와 동일하게, 단일 알람 머지 실패가
            // 사이클 전체를 중단시키지 않도록 격리하고 failed 만 누적한다. (현재 iOS
            // 머지 경로는 throw 하지 않으므로 failed 는 0 이지만, Android 카운터 의미를
            // 보존하고 향후 throwing 작업이 추가돼도 retry 판단이 그대로 동작한다.)
            do {
                switch try await mergeRemote(remote: remote, mapped: mapped, token: token) {
                case .imported: imported += 1
                case .updated: updated += 1
                case .unchanged: break
                }
            } catch {
                failed += 1
                Self.logger.error(
                    "Pull sync: failed to merge remote alarm (id: \(remote.id, privacy: .public)): \(error.localizedDescription, privacy: .public)"
                )
            }
        }

        if skipped > 0 {
            Self.logger.warning(
                "Pull sync: skipped \(skipped, privacy: .public) remote alarm(s) with invalid time"
            )
        }

        // 2. 수신자 상태 반영 — 그만받기(삭제) vs 목소리 철회(목소리만 제거).
        //
        // 목록(`GET /alarm`)은 그만받기 한 알람을 빼서 내려주므로 "목록에서 사라짐" 만으로는
        // 이유를 알 수 없다. 서버에 따로 물어 셋을 구분한다(`GET /alarm/declined`).
        // **못 물어보면 아무것도 지우지 않는다** — 네트워크 실패를 이유로 남의 알람을 지우는
        // 쪽으로 기울면 안 된다.
        await applyRecipientState(
            servedReceivedIDs: Set(receivedRemoteAlarms.map(\.id)),
            allRemoteIDs: Set(remoteAlarms.map(\.id)),
            token: token
        )

        return PullResult(imported: imported, updated: updated, skipped: skipped, failed: failed)
    }

    // MARK: Merge

    /// 단일 remote 알람을 로컬 store 와 머지하고, 집계용 결과를 반환한다.
    @discardableResult
    private func mergeRemote(remote: RemoteAlarm, mapped initialMapped: LocalAlarmRecord, token: String) async throws -> MergeOutcome {
        var mapped = initialMapped
        if let existing = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) {
            // ── 1차 거르기(다운로드 전). 통과해도 **확정이 아니다.**
            guard Self.shouldApplyRemote(existing: existing, mapped: mapped) else { return .unchanged }
            guard !Self.isInFlight(existing) else { return .unchanged }

            // 여기가 유일한 서스펜션이다 — 음원을 통째로 내려받으므로 수 초가 걸린다.
            mapped = await recordWithCachedTTSIfNeeded(mapped, token: token)

            // ── 반영 구간: 위 `existing` 은 **다운로드 전 값**이다. 그걸로 판단·머지하면
            // 그 사이에 사용자가 한 일이 조용히 뒤집힌다. 전부 최신 행에서 다시 가져온다.
            guard let current = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) else {
                // 대기 중 지워졌다 — **되살리지 않는다.** 받아 둔 음성은 주인이 없으니 정리한다.
                if let key = mapped.audioCacheKey?.nilIfBlank, store.countByAudioCacheKey(key) == 0 {
                    try? audioCache.deleteCachedAudio(cacheKey: key)
                }
                Self.logger.info("Pull sync: row deleted during download; skipping (remoteId: \(remote.id, privacy: .public))")
                return .unchanged
            }
            // 대기 중 울리기 시작했거나 스누즈로 넘어갔으면 건드리지 않는다.
            guard !Self.isInFlight(current) else { return .unchanged }
            // 대기 중 로컬 편집이 붙었으면 로컬이 우선한다(그 dirty 를 여기서 처음 본다).
            guard Self.shouldApplyRemote(existing: current, mapped: mapped) else { return .unchanged }

            let merged = Self.merge(existing: current, mapped: mapped)
            // `syncedNow` — 서버본을 그대로 쓴 행이므로 '수신자가 손대지 않았다' 로 남긴다.
            // ([locallyEditedByRecipient] 가 두 시각의 등호로 판정한다.)
            store.upsert(merged, syncedNow: true)

            // receivedRemote 라면 일정 변경이 있을 수 있으므로 다시 스케줄.
            if merged.originEnum == .receivedRemote && merged.enabled {
                await rescheduleReceivedRemote(record: merged, existing: current)
            }
            return .updated
        } else {
            mapped = await recordWithCachedTTSIfNeeded(mapped, token: token)

            // 다운로드 사이에 다른 회차가 같은 remote 를 먼저 넣었을 수 있다. 그대로 upsert 하면
            // `RemoteAlarmMapper` 가 매번 새 UUID 를 만들기 때문에 **행이 둘 생기고 둘 다 울린다.**
            if let raced = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) {
                guard !Self.isInFlight(raced) else { return .unchanged }
                guard !Self.locallyEditedByRecipient(raced) else { return .unchanged }
                store.upsert(Self.merge(existing: raced, mapped: mapped), syncedNow: true)
                return .updated
            }

            // 신규 import.
            store.upsert(mapped, syncedNow: true)

            // receivedRemote 신규 알람이면 곧바로 AlarmKit 스케줄.
            if mapped.originEnum == .receivedRemote && mapped.enabled {
                await alarmKit.schedule(record: mapped, store: store)
            }
            await SocialNotificationTracker.notifyReceivedAlarm(
                alarmID: mapped.id,
                title: RemoteAlarmMapper.resolveLabel(remote),
                time: String(format: "%02d:%02d", mapped.hour, mapped.minute)
            )
            return .imported
        }
    }

    /// existing 의 보존 필드와 mapped 의 서버 권위 필드를 합친다.
    /// Android `RemoteAlarmPullSyncService.buildLocalAlarm` 의 existing 보존 동일.
    ///
    /// `internal` 로 노출해 `@testable import AlarmTalk` 에서 직접 호출 가능하게 한다.
    /// **받은 뒤부터는 받는 사람 것이다.**
    ///
    /// ⚠ 예전 구현은 '무엇을 보존할지 세는' 방식이었고, 그러다 **시각·요일·스누즈 간격·
    /// 스누즈 토글·발화시각**을 빠뜨려 서버 값으로 덮고 있었다. 수신자가 받은 알람을
    /// 07:00 → 06:30 으로 고쳐도 다음 pull 에 07:00 으로 되돌아간다 —
    /// **고쳐 뒀다고 믿고 그 시각에 못 일어난다.**
    ///
    /// 안드로이드는 같은 버그를 네 번 겪고(시각 → 끄기 → 스누즈 상태 → 볼륨·알람음)
    /// 세는 방식을 폐기했다(`2cafd54f`, `850b9032`). 여기서도 방향을 뒤집는다:
    /// **받은 알람은 수신자 것이 기본이고, 서버에서 오는 것만 명시한다.**
    ///
    /// 서버가 권위인 것은 '보낸 사람이 정한 내용' 뿐이다 — 라벨·음성/문구·진동 패턴.
    /// (보낸 알람은 한 번 보내면 발신자가 못 고치므로, 서버 값은 사실상 최초 씨앗이다.)
    ///
    /// ⚠ **그 '씨앗' 조차 수신자가 고친 뒤에는 다시 뿌리지 않는다**(2026-08-18).
    /// 여기 남은 보존 목록은 **수신자가 아직 손대지 않은 행**에만 쓰인다 —
    /// 고친 행은 [locallyEditedByRecipient] 가 `shouldApplyRemote` 에서 통째로 막는다.
    /// 그전에는 이 목록에 없는 값(재생 방식·문구·목소리)이 매 pull 마다 되돌아왔다:
    /// 받은 알람을 '목소리' 로 고쳐도 보낸 사람 행에 message 가 없으면 `mapped` 는
    /// 음성 없는 행이라 **알람음으로 되돌아간다**(2026-08-17 실기기 재현).
    ///
    /// ⚠ `shouldApplyRemote` 의 **dirty 가드만으로는** 받은 알람을 못 지킨다 —
    /// `nextLocalSyncState` 가 받은 알람을 항상 `.synced` 로 되돌리기 때문이다.
    /// 그래서 판정을 시각(`updatedAtMillis` vs `lastSyncedAtMillis`)으로 따로 둔다.
    static func merge(existing: LocalAlarmRecord, mapped: LocalAlarmRecord) -> LocalAlarmRecord {
        var merged = mapped
        merged.id = existing.id                                  // 로컬 ID 유지
        merged.alarmKitID = existing.alarmKitID                  // 스케줄러 ID 보존
        merged.createdAtMillis = existing.createdAtMillis

        // ── (1) **서버에 사본이 없는 로컬 전용 값**은 origin 과 무관하게 지킨다.
        // 매퍼는 이 값들을 기본치(100·nil·false 등)로 만들어 내므로, 여기서 잃으면 영영 잃는다.
        //
        // ⚠ **기준은 `RemoteAlarm` 이 그 값을 표현할 수 있는가**다(AlarmTalkAPIModels.swift).
        // 서버가 내려주는 것은 time / repeatDays / isActive / snoozeMinutes / mode /
        // vibrationPattern / wakeMode / voiceProfileId / messageId / messageText /
        // category / messageAudioUrl / sender·target 뿐이다. **그 밖은 전부 로컬 전용이다.**
        // 필드를 새로 추가하면 이 목록에 넣을지 먼저 판단할 것 — 빠뜨리면 pull 이 돌 때마다
        // 조용히 기본값으로 되돌아간다.
        merged.snoozeCount = existing.snoozeCount
        merged.snoozeEnabled = existing.snoozeEnabled
        merged.snoozeRepeatLimit = existing.snoozeRepeatLimit
        merged.voiceRepeat = existing.voiceRepeat
        merged.voiceVolumePercent = existing.voiceVolumePercent
        merged.alarmVolumePercent = existing.alarmVolumePercent
        merged.alarmSoundUri = existing.alarmSoundUri
        merged.alarmSoundLabel = existing.alarmSoundLabel
        merged.defaultAlarmSoundId = existing.defaultAlarmSoundId
        merged.holidayOff = existing.holidayOff
        // ⚠ 아래 셋도 **서버에 사본이 없다**(2026-08-07 추가). 빠져 있던 동안 pull 이 돌
        // 때마다 조용히 nil 이 됐다:
        //  - `preLockPlayMode` — 무료 전환 잠금 전의 재생 방식. 잃으면 재결제해도 목소리
        //    알람이 안 돌아온다.
        //  - `ownerUserId` — 잠금이 다른 계정 알람을 건드리지 않게 막는 가드.
        //  - `bucketId` — 고른 무료 테마.
        merged.preLockPlayMode = existing.preLockPlayMode
        merged.ownerUserId = existing.ownerUserId
        merged.bucketId = existing.bucketId

        // 동적 문구(날씨·운세·랜덤) 설정 일체. 서버는 이 개념을 모른다 —
        // 매퍼가 `voiceRandomPrompt: false` 로 만들어 내므로 지키지 않으면 **pull 한 번에
        // 날씨 알람이 고정 문구 알람으로 바뀐다**(DynamicVoiceRefreshService 의
        // `isRepeatingDynamicAlarmTalk` 가 false 가 되어 갱신 대상에서 아예 빠진다).
        merged.voiceRandomPrompt = existing.voiceRandomPrompt
        merged.voiceRandomContext = existing.voiceRandomContext
        merged.voiceWeatherCountry = existing.voiceWeatherCountry
        merged.voiceWeatherCity = existing.voiceWeatherCity
        merged.voiceFortuneGender = existing.voiceFortuneGender
        merged.voiceFortuneBirthDate = existing.voiceFortuneBirthDate
        merged.voiceFortuneBirthTime = existing.voiceFortuneBirthTime
        merged.voiceLanguage = existing.voiceLanguage
        merged.voiceListenerTitle = existing.voiceListenerTitle
        // "이 발사 시각용 음성은 이미 만들어 뒀다" 표식. 잃으면 다음 갱신 주기에
        // **다시 합성해 이번 달 목소리 생성 한도를 깎는다.**
        merged.dynamicVoicePreparedForFireAtMillis = existing.dynamicVoicePreparedForFireAtMillis

        // 내려받은 음원 경로가 이번 회차에 잡혔으면 그걸 쓰고, 없으면 갖고 있던 것을 지킨다.
        // 무조건 덮으면 로컬 녹음(voiceSource == .localAudio)을 쓰는 알람이 음원을 잃는다.
        merged.localAudioUri = mapped.localAudioUri ?? existing.localAudioUri

        guard existing.originEnum == .receivedRemote else {
            // 내가 보낸 알람은 로컬이 권위다 — 올리는 쪽은 push 다.
            return merged
        }

        // ── (2) 받은 알람은 **일정까지 수신자 것이다.** 세지 않고 전부 로컬에서 가져온다.
        merged.hour = existing.hour
        merged.minute = existing.minute
        merged.repeatDaysMask = existing.repeatDaysMask
        merged.fireAtMillis = existing.fireAtMillis
        // snoozeEnabled 는 (1) 에서 이미 지켰다(서버가 표현하지 못하는 값).
        merged.snoozeMinutes = existing.snoozeMinutes
        // 사용자가 껐으면 그 의도를 존중한다(서버가 켜도 다시 켜지지 않는다).
        merged.enabled = existing.enabled && merged.enabled

        // 스누즈 회차는 **한 묶음으로** 지킨다. 상태만 지키고 마감을 갈아 끼우면
        // '5분 뒤 다시 울림' 이 사라져 다음 정규 회차로 밀린다.
        let keepSnoozeEpisode = merged.enabled && existing.runtimeStateEnum == .snoozed
        if keepSnoozeEpisode {
            merged.state = AlarmRuntimeState.snoozed.rawValue
            merged.fireAtMillis = existing.fireAtMillis
            merged.snoozeCount = existing.snoozeCount
        } else {
            merged.state = merged.enabled
                ? AlarmRuntimeState.armed.rawValue
                : AlarmRuntimeState.disabled.rawValue
        }
        return merged
    }

    /// "이번 사이클의 mapped 가 서버 권위 응답으로서 existing 을 덮어써도 되는가?" 결정.
    /// 정책:
    ///   - existing.syncState == .dirty 이면 false (로컬 변경 우선)
    ///   - 받은 알람을 수신자가 고쳤으면 false ([locallyEditedByRecipient])
    ///   - mapped.lastSyncedAtMillis >= existing.lastSyncedAtMillis 이면 true
    ///   - 그 외 false
    static func shouldApplyRemote(existing: LocalAlarmRecord, mapped: LocalAlarmRecord) -> Bool {
        if existing.syncStateEnum == .dirty { return false }
        if locallyEditedByRecipient(existing) { return false }
        return (mapped.lastSyncedAtMillis ?? 0) >= (existing.lastSyncedAtMillis ?? 0)
    }

    /// 받은 알람을 **수신자가 고쳤는가**. 고쳤으면 서버본을 다시 입히지 않는다
    /// (docs/spec/family-alarm.md — 보낸 사람은 '만든 뒤 고치기: 못 한다',
    /// 받은 사람은 '자기 기기에서 자유롭게').
    ///
    /// 받은 알람은 항상 `.synced` 라(`LocalAlarmStore.nextLocalSyncState`) dirty 플래그로는
    /// 이걸 구분할 수 없다. 대신 시각을 본다 — pull 이 쓴 행은
    /// `updatedAtMillis == lastSyncedAtMillis`(`upsert(_:syncedNow:)`)이고, 수신자가 저장하면
    /// `upsertPreservingServerSyncFields` 가 `lastSyncedAtMillis` 를 보존한 채
    /// `updatedAtMillis` 만 올린다.
    ///
    /// Android `RemoteAlarmPullSyncService.locallyEditedByRecipient` 와 같은 판정이다.
    static func locallyEditedByRecipient(_ existing: LocalAlarmRecord) -> Bool {
        guard existing.originEnum == .receivedRemote else { return false }
        guard let lastSynced = existing.lastSyncedAtMillis else { return true }
        return existing.updatedAtMillis > lastSynced
    }

    /// Android `RemoteAlarmPullSyncService.pullReceivedAlarms` 의 대상 필터와 같은 의도.
    /// 내가 만든 서버 알람은 push sync 의 결과물이므로 received import 대상으로 삼지 않는다.
    static func isReceivedRemoteCandidate(_ remote: RemoteAlarm, currentUserID: String) -> Bool {
        guard let target = remote.targetUserId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !target.isEmpty,
              target == currentUserID,
              let sender = remote.senderUserId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !sender.isEmpty,
              sender != currentUserID else {
            return false
        }
        return true
    }

    private func rescheduleReceivedRemote(record: LocalAlarmRecord, existing: LocalAlarmRecord) async {
        // 새 예약을 먼저 성공시킨 뒤 기존 AlarmKit ID 를 해제해 로컬 레코드가
        // 삭제되거나 무예약 상태로 남는 일을 막는다.
        let scheduled = await alarmKit.schedule(record: record, store: store)
        if scheduled, existing.alarmKitID != nil {
            await alarmKit.cancelScheduledAlarm(record: existing)
        }
    }

    // MARK: Cascade delete

    /// 로컬에 receivedRemote 로 들고 있으나 서버 응답에 사라진 알람을 정리.
    /// AlarmKit 도 함께 해제한다.
    /// 받은 알람의 수신자 상태를 반영한다. Android `RemoteAlarmPullSyncService` 와 1:1.
    ///
    /// - Parameter servedReceivedIDs: 이번 pull 에서 **받은 알람으로** 내려온 remote id 들.
    /// - Parameter allRemoteIDs: `GET /alarm` 이 내려준 **전체** remote id 들(내가 보낸 것 포함).
    private func applyRecipientState(
        servedReceivedIDs: Set<String>,
        allRemoteIDs: Set<String>,
        token: String
    ) async {
        guard let state = await fetchRecipientState(token: token) else {
            // 못 물어봤다 — 아무것도 건드리지 않는다.
            Self.logger.warning("Pull sync: /alarm/declined unavailable; skipping recipient-state pruning")
            return
        }

        let received = store.recordsBy(origin: .receivedRemote)

        // (1) 목소리 철회 — **목소리만 걷어내고 알람은 남긴다.**
        //
        // 복제 목소리는 발신자의 생체정보라 파기 대상이지만, 시각·요일은 수신자가 기대고
        // 자는 자기 정보다. 통째로 지우면 그날 못 일어난다.
        //
        // 대상은 `hasSenderVoice` — '목소리가 있는 행' 이 아니라 '발신자 음성을 든 행' 이다.
        // 서버는 철회 기록을 영구히 들고 있어서, 넓게 잡으면 수신자가 나중에 넣은 자기
        // 목소리까지 매번 걷어낸다.
        for staleRecord in received {
            guard let remoteID = staleRecord.remoteAlarmId,
                  state.revoked.contains(remoteID) else { continue }
            // ⚠ `received` 는 루프 **시작 전** 스냅샷이다. 아래에 await 가 있어 앞 회차가
            // 도는 동안 사용자가 이 행을 편집했을 수 있다 — 스냅샷으로 upsert 하면 그 편집을
            // 조용히 되돌린다. 반영 직전에 최신 행을 다시 읽는다(mergeRemote 와 같은 순서).
            guard let record = store.alarms.first(where: { $0.remoteAlarmId == remoteID }) else { continue }
            guard Self.hasSenderVoice(record) else { continue }
            // 지금 울리는 중이거나 스누즈 회차 중이면 건드리지 않는다 — 취소·재예약이
            // 그 회차를 끊는다. 다음 사이클에 다시 본다(서버는 철회 기록을 계속 들고 있다).
            guard !Self.isInFlight(record) else { continue }
            let releasedKey = record.audioCacheKey
            let revoked = Self.withVoiceRevoked(record)
            _ = store.upsert(revoked)
            // 먼저 upsert 해 이 행의 참조를 지운 뒤 센다 — 같은 캐시를 여러 행이 쓰고 있어도
            // 마지막 행에서 0 이 되어 파일이 실제로 지워진다.
            if let key = releasedKey?.nilIfBlank, store.countByAudioCacheKey(key) == 0 {
                try? AudioCacheStore.shared.deleteCachedAudio(cacheKey: key)
                // ⚠ 캐시 파일만 지우면 부족하다. 예약할 때 `AlarmSoundStaging` 이
                // `Library/Sounds/` 로 **사본**을 떠 두는데, 그건 별도 파일이라 그대로 남는다.
                // 파기 대상인 생체정보(복제 음성)를 디스크에 남기면 안 된다.
                AlarmSoundStaging.clearStagedSound(forKey: key)
            }
            // ⚠ **로컬 행만 고치면 알람은 여전히 그 목소리로 운다.**
            // 안드로이드는 RingingService 가 울릴 때 DB 를 다시 읽어서 행만 고쳐도 됐지만,
            // iOS 는 발사 시점에 우리 코드가 돌지 않는다 — 이미 AlarmKit 에 넘긴 사운드가
            // 그대로 울린다(PaidVoiceGate 주석과 같은 이유). 반복 알람은 재예약 계기도
            // 없어 사실상 무기한이다. 그래서 **다시 깔아 준다.**
            await alarmKit.cancelScheduledAlarm(record: record)
            if revoked.enabled {
                _ = await alarmKit.schedule(record: revoked, store: store)
            }
            Self.logger.info("Pull sync: revoked sender voice on received alarm (remoteId: \(remoteID, privacy: .public))")
            // ⚠ **여기는 백그라운드다.** 목소리만 걷어내고 말면 사용자는 왜 알람이
            // 기본 알람음이 됐는지 알 길이 없다 — 대기표에 적어 두면 다음에 앱을 열 때
            // 모달이 알려 준다(안드로이드 `VoiceAccessSyncWorker` 와 같은 처리).
            DowngradeNoticeStore().record(
                userID: auth.session?.user.id,
                cause: .sharedReleased,
                count: 1
            )
        }

        // (2) 그만받기 — 알람을 지운다.
        //
        // 서버 목록에서 빠지는 이유는 셋이고 **하나만 남겨야 한다**:
        //  (a) 수신자가 그만받기      → 지운다(이 계정의 다른 기기에서도 지워져야 한다)
        //  (b) 옛 네임스페이스 버그로 **내가 보낸 알람**을 받은 것으로 잘못 임포트한 잔재
        //      → 지운다. 그 행의 remote id 는 전체 목록에는 있는데 '받은 것' 에는 없다.
        //      생성자는 자기 알람을 decline 할 수 없어 (a) 만 두면 이 잔재가 영영 남아
        //      진짜 알람과 함께 울린다.
        //  (c) 발신자가 삭제          → **남긴다.** 받은 뒤부터는 받는 사람 것이라,
        //      내가 기대고 자는 알람이 남의 조작으로 사라지면 안 된다.
        for staleRecord in store.recordsBy(origin: .receivedRemote) {
            guard let remoteID = staleRecord.remoteAlarmId,
                  !servedReceivedIDs.contains(remoteID),
                  state.declined.contains(remoteID) || allRemoteIDs.contains(remoteID)
            else { continue }
            // 여기도 최신 행을 다시 읽는다. 앞 회차의 await 동안 사용자가 이 알람을 편집해
            // 재예약됐으면 `alarmKitID` 가 바뀌어 있는데, 스냅샷의 옛 id 로 취소하면
            // **새 예약이 남은 채 행만 지워져** 주인 없는 알람이 울린다.
            guard let record = store.alarms.first(where: { $0.remoteAlarmId == remoteID }) else { continue }
            await alarmKit.cancel(record: record, store: store)
            Self.logger.info("Pull sync: pruned received alarm (remoteId: \(remoteID, privacy: .public))")
        }
    }

    /// `GET /alarm/declined` 를 **끝까지** 받아 온다. 한 페이지만 보고 지우면 뒤 페이지에
    /// 있는 그만받기 알람이 계속 울린다. 실패하면 nil — 호출자가 아무것도 안 한다.
    private func fetchRecipientState(token: String) async -> (declined: Set<String>, revoked: Set<String>)? {
        var declined = Set<String>()
        var revoked = Set<String>()
        var offset = 0
        // 서버가 limit 을 100 으로 클램프한다. 무한 루프 방지용 상한도 둔다.
        for _ in 0..<100 {
            do {
                let page = try await api.declinedAlarms(limit: 100, offset: offset, token: token)
                declined.formUnion(page.alarmIds)
                revoked.formUnion(page.revokedAlarmIds)
                let rows = page.alarmIds.count + page.revokedAlarmIds.count
                if !page.hasMore || rows == 0 { return (declined, revoked) }
                // 서버는 한 페이지에 **두 종류를 섞어** 보낸다. 합만큼 전진해야 오프셋이
                // 어긋나지 않는다(한쪽 크기로 전진하면 같은 행을 다시 읽거나 건너뛴다).
                offset += rows
            } catch {
                return nil
            }
        }
        return (declined, revoked)
    }

    /// 지금 pull 이 **건드리면 안 되는** 행 — 울리는 중이거나 스누즈 회차가 살아 있다.
    ///
    /// 안드로이드는 `RingingService` 가 울리는 알람 집합을 런타임으로 들고 있지만 iOS 에는
    /// 그런 게 없어 저장된 `state` 로 판단한다.
    ///
    /// `.snoozed` 를 포함하는 이유는 안드로이드와 다르다: iOS 재예약(`makeSchedule`)은
    /// `.relative(hour:minute)` 라 `fireAtMillis` 를 읽지 않는다. 상태를 이어받아도
    /// AlarmKit countdown 이 취소돼 '5분 뒤' 가 사라지므로, **회차 자체를 건드리지 않는다.**
    ///
    /// ⚠ 이 판정을 `recoverScheduledAlarms` 로 옮기지 말 것 — 거기서 배제 조건으로 쓰면
    /// 상태가 굳은 행이 영구 제외된다.
    static func isInFlight(_ record: LocalAlarmRecord) -> Bool {
        record.runtimeStateEnum == .ringing || record.runtimeStateEnum == .snoozed
    }

    /// 이 행이 **발신자가 준 음성**을 들고 있는가.
    ///
    /// 받은 알람의 캐시 키는 `remote-message-<id>` 로 만들어진다(`RemoteAlarmMapper`).
    /// 키 없이 파일 경로만 든 옛 행도 포함한다 — 지금 코드로는 안 만들어지지만, 그렇다고
    /// 단정하고 생체정보를 남겨 둘 수는 없다. 수신자가 고른 음성은 항상 키가 있으므로
    /// 오탐이 되지 않는다.
    static func hasSenderVoice(_ record: LocalAlarmRecord) -> Bool {
        if let key = record.audioCacheKey?.nilIfBlank {
            return key.hasPrefix("remote-message-")
        }
        return record.localAudioUri?.nilIfBlank != nil
    }

    /// 발신자가 탈퇴해 목소리가 철회된 받은 알람 — 목소리만 걷어내고 알람은 남긴다.
    /// 보낸 사람 이름이 든 라벨도 파기 대상이라 기본 라벨로 되돌린다.
    /// 알람음만 남긴 채(`alarmOnly`) 같은 시각에 그대로 울린다.
    ///
    /// 음성 **파일**은 여기서 지우지 않는다 — 같은 캐시를 다른 알람이 쓸 수 있어,
    /// 호출한 쪽이 참조 수를 보고 지운다.
    static func withVoiceRevoked(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        var next = record
        next.label = "알람"
        next.playMode = AlarmPlayMode.alarmOnly.rawValue
        next.localAudioUri = nil
        next.audioCacheKey = nil
        next.rawAudioUri = nil
        next.voiceSource = VoiceSource.localAudio.rawValue
        next.voiceProfileId = nil
        next.voiceListenerTitle = nil
        next.voiceText = nil
        next.voiceCategory = nil
        next.ttsMessageId = nil
        next.updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        return next
    }

    // MARK: Audio fetch

    private func fetchAndCacheTTS(
        messageId: String,
        cacheKey: String,
        rawAudioUri: String?,
        token: String
    ) async {
        do {
            let audio = try await api.getTtsAudio(messageId: messageId, token: token)
            _ = try audioCache.cacheBytes(
                audio.bytes,
                cacheKey: cacheKey,
                mimeType: audio.mimeType,
                source: "tts",
                messageId: messageId,
                rawAudioUri: audio.rawAudioUri ?? rawAudioUri,
                durationOverrideMs: audio.durationMs,
                enforceMaxDuration: false
            )
        } catch {
            // 캐싱 실패는 sync 전체를 실패시키지 않는다. 무음 알람을 막기 위해
            // 원본 오디오 URL 직다운로드 폴백을 먼저 시도한다.
            Self.logger.warning(
                "TTS 캐싱 실패 (messageId: \(messageId, privacy: .public)): \(error.localizedDescription, privacy: .public) — 원본 오디오 폴백 시도"
            )
            await cacheRawAudioFallback(rawAudioUri: rawAudioUri, cacheKey: cacheKey, messageId: messageId)
        }
    }

    /// TTS 메시지 오디오 API 가 실패했을 때 레코드의 원본 오디오 URL(rawAudioUri)을
    /// 직접 다운로드해 **같은 cacheKey** 로 저장하는 폴백.
    /// 이것마저 실패하면 호출자(`recordWithCachedTTSIfNeeded`)가 캐시 키를 비워
    /// 두므로 다음 sync 사이클의 fresh mapped 레코드에서 재시도된다.
    private func cacheRawAudioFallback(rawAudioUri: String?, cacheKey: String, messageId: String) async {
        guard let raw = rawAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            Self.logger.warning(
                "원본 오디오 폴백 불가 — rawAudioUri 없음/비 http(s) (messageId: \(messageId, privacy: .public)). 다음 sync 에서 재시도"
            )
            return
        }
        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  !data.isEmpty else {
                throw APIError.invalidResponse
            }
            // Content-Type 이 audio/* 가 아니면 (예: octet-stream) URL 확장자로 추정.
            let responseMime = http.mimeType?.lowercased()
            let mimeType: String
            if let responseMime, responseMime.hasPrefix("audio/") {
                mimeType = responseMime
            } else {
                mimeType = AudioCacheStore.mimeType(
                    forFormat: AudioCacheStore.normalizedFormat(url.pathExtension)
                )
            }
            _ = try audioCache.cacheBytes(
                data,
                cacheKey: cacheKey,
                mimeType: mimeType,
                source: "raw_audio",
                messageId: messageId,
                rawAudioUri: raw,
                durationOverrideMs: nil,
                enforceMaxDuration: false
            )
        } catch {
            Self.logger.error(
                "원본 오디오 폴백 실패 (messageId: \(messageId, privacy: .public)): \(error.localizedDescription, privacy: .public) — 캐시 키를 비워 두고 다음 sync 에서 재시도"
            )
        }
    }

    private func recordWithCachedTTSIfNeeded(_ record: LocalAlarmRecord, token: String) async -> LocalAlarmRecord {
        var copy = record
        guard let cacheKey = copy.audioCacheKey,
              let messageId = copy.ttsMessageId,
              !messageId.isEmpty else {
            return copy.playModeEnum == .alarmOnly ? copy : Self.withoutUnavailableRemoteAudio(copy)
        }

        if audioCache.cachedURL(for: cacheKey) == nil {
            await fetchAndCacheTTS(
                messageId: messageId,
                cacheKey: cacheKey,
                rawAudioUri: copy.rawAudioUri,
                token: token
            )
        }
        if let cached = audioCache.cachedURL(for: cacheKey) {
            copy.localAudioUri = cached.lastPathComponent
        } else {
            // 1차 캐싱 + 원본 오디오 폴백 모두 실패. 캐시 키를 비운 alarmOnly 로
            // 강등해 두면, 다음 sync 의 mapped 레코드가 다시 캐싱을 시도한다.
            copy = Self.withoutUnavailableRemoteAudio(copy)
        }
        return copy
    }

    static func withoutUnavailableRemoteAudio(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        var copy = record
        copy.playMode = AlarmPlayMode.alarmOnly.rawValue
        copy.localAudioUri = nil
        copy.audioCacheKey = nil
        copy.rawAudioUri = nil
        copy.voiceSource = VoiceSource.localAudio.rawValue
        copy.voiceProfileId = nil
        copy.voiceText = nil
        copy.voiceCategory = nil
        copy.voiceLanguage = nil
        copy.voiceRandomPrompt = false
        copy.voiceRandomContext = nil
        copy.voiceWeatherCountry = nil
        copy.voiceWeatherCity = nil
        copy.voiceFortuneGender = nil
        copy.voiceFortuneBirthDate = nil
        copy.voiceFortuneBirthTime = nil
        copy.dynamicVoicePreparedForFireAtMillis = nil
        copy.ttsMessageId = nil
        return copy
    }
}
