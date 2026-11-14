import Foundation

/// 편집기 저장이 끝나는 갈래(`AlarmEditorSheet.finishScheduling`).
///
/// 성공 마무리 — 선택 기억·저장 사건·성공 햅틱·"N 후에 울려요"(스펙 alarm-editor.md §7)·편집기 닫기 — 는 **끝까지 성공한 갈래
/// 하나**에서만 돈다(스펙 「iOS 중복 시각 알람 교체의 실패 처리」 — 정리 완료 뒤에만). 예약이 실패했거나 교체 정리가 실패해
/// 롤백한 갈래에서 띄우면 남지 않은 알람의 남은 시간을 말하게 된다.
enum AlarmSaveOutcome: Equatable {
    /// AlarmKit 예약이 실패했다 — 교체 정리는 돌지 않는다.
    case scheduleFailed
    /// 예약은 됐지만 같은 시각 교체의 충돌 정리가 실패했다(그 사이 계정이 바뀐 것도 여기다) — 새 예약을 롤백한다.
    case replacementFailed
    /// 예약도, 같은 시각 교체였다면 충돌 정리도 끝났다.
    case completed
}

/// 저장의 걸음 — 예약 → (같은 시각 교체면) 충돌 정리. 앞 걸음이 실패하면 뒤 걸음은 돌지 않는다. 충돌 알람은 새 알람이 예약된
/// 뒤에만 지운다 — 먼저 지우면 둘이 함께 쓰는 음성이 마지막 참조로 지워진다(`AlarmEditorSheet.confirmReplaceDuplicate`).
@MainActor
func runAlarmSaveSteps(
    schedule: @MainActor () async -> Bool,
    clearConflicts: (@MainActor () async -> Bool)?
) async -> AlarmSaveOutcome {
    guard await schedule() else { return .scheduleFailed }
    if let clearConflicts, !(await clearConflicts()) { return .replacementFailed }
    return .completed
}

/// 충돌 알람을 차례로 지운다 — 하나라도 실패하면 거기서 멈추고 그 뒤 행은 건드리지 않는다. 서버에는 알람 사본이 없어
/// (2026-10-29) 지울 것은 기기의 예약과 행뿐이다.
@MainActor
func removeReplacementConflicts<Conflict>(
    _ conflicts: [Conflict],
    // 함수뿐 아니라 콜백도 같은 actor에 묶어야 Conflict를 격리 밖으로 보내지 않는다.
    deleteLocal: @MainActor (Conflict) async -> Bool
) async -> Bool {
    for conflict in conflicts {
        guard !Task.isCancelled, await deleteLocal(conflict) else { return false }
    }
    return !Task.isCancelled
}

/// 인증은 사라져도 로컬 알람의 소유자와 임시 예약은 남는다. 그 행이 여전히 같은
/// 편집본일 때만 되돌린다. 서버 응답의 메타데이터는 편집 세대에 포함하지 않는다.
private func sameStagedEdit(_ lhs: LocalAlarmRecord, _ rhs: LocalAlarmRecord) -> Bool {
    func snapshot(_ value: LocalAlarmRecord) -> LocalAlarmRecord {
        var copy = value
        copy.remoteAlarmId = nil
        copy.lastSyncedAtMillis = nil
        copy.syncState = AlarmSyncState.localOnly.rawValue
        copy.updatedAtMillis = 0
        return copy
    }
    return snapshot(lhs) == snapshot(rhs)
}

/// 충돌 정리가 실패한 임시 예약만 취소하고 이전 행을 복원한다. 현재 세션은 조건이 아니다.
@MainActor
func rollbackAlarmReplacement(
    staged: LocalAlarmRecord,
    previous: LocalAlarmRecord?,
    store: LocalAlarmStore,
    cancelScheduled: @MainActor (LocalAlarmRecord) async -> Bool
) async {
    if let current = store.record(id: staged.id), !sameStagedEdit(current, staged),
       current.alarmKitID == staged.alarmKitID {
        // 다른 편집/끄기가 같은 핸들을 넘겨받았다. 새 상태의 예약까지 끊지 않는다.
        return
    }
    _ = await cancelScheduled(staged)
    guard let current = store.record(id: staged.id) else { return }
    guard sameStagedEdit(current, staged) else {
        // 취소 await 중 행이 바뀌었어도 끊은 핸들을 가리키게 두지는 않는다.
        if current.alarmKitID == staged.alarmKitID {
            store.clearScheduleHandle(id: staged.id)
        }
        return
    }
    if var previous {
        // 자동 만료가 소유자 미기록의 옛 행을 새겼을 때도 그 연결을 되돌리지 않는다.
        previous.ownerUserId = staged.ownerUserId
        store.upsertPreservingServerSyncFields(previous)
    } else {
        // 재시도에 쓰는 음원은 남긴다. 반환된 캐시 키를 여기서 삭제하지 않는다.
        store.deleteByID(staged.id)
    }
}
