import Foundation

/// 서버의 영구 삭제/그만받기에 성공한 충돌만 로컬에서 정리한다. 실패 이후 행은 건드리지 않는다.
@MainActor
func removeReplacementConflicts<Conflict>(
    _ conflicts: [Conflict],
    // 함수뿐 아니라 콜백도 같은 actor에 묶어야 Conflict를 격리 밖으로 보내지 않는다.
    deleteRemote: @MainActor (Conflict) async -> Bool,
    deleteLocal: @MainActor (Conflict) async -> Bool
) async -> Bool {
    for conflict in conflicts {
        guard !Task.isCancelled, await deleteRemote(conflict) else { return false }
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
        copy.remoteDeliveryVersion = nil
        copy.syncState = AlarmSyncState.localOnly.rawValue
        copy.updatedAtMillis = 0 // markRemote/markSyncFailed도 이 시각을 바꾼다.
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
