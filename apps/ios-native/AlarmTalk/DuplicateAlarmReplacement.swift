import Foundation

/// 서버의 영구 삭제/그만받기에 성공한 충돌만 로컬에서 정리한다. 실패 이후 행은 건드리지 않는다.
@MainActor
func removeReplacementConflicts<Conflict>(
    _ conflicts: [Conflict],
    deleteRemote: (Conflict) async -> Bool,
    deleteLocal: (Conflict) async -> Bool
) async -> Bool {
    for conflict in conflicts {
        guard !Task.isCancelled, await deleteRemote(conflict) else { return false }
        guard !Task.isCancelled, await deleteLocal(conflict) else { return false }
    }
    return !Task.isCancelled
}
