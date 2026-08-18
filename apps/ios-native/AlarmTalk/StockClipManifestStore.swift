import Foundation
import os

/// 스톡 클립 매니페스트(클립 목록 + 카테고리별 기대 개수)를 **디스크에 남긴다.**
///
/// ⚠ **이게 없으면 '모른다' 라는 상태가 생기고, 관문과 저장이 정반대로 답한다**(2026-08-18).
/// - 관문(`AlarmEditorSheet.needsPreparation`)은 `expectedVariants == nil` 을 **'막지 않음'** 으로 읽고,
/// - 저장(`hasCompleteBucket`)은 같은 값을 `?: return false` 로 **'불완전'** 으로 읽는다.
///
/// 즉 매니페스트 요청이 한 번 실패한 세션에서는 **고를 수는 있는데 저장은 안 된다.** 둘 다
/// 메모리 상태라 그 세션 내내 그렇다. 지금은 라이브 랜덤 생성이 이 모순을 덮고 있어서
/// 드러나지 않을 뿐이다.
///
/// 같은 구멍이 오프라인 콜드스타트에서도 난다: 비행기모드로 앱을 **새로 켜면** 클립을 전부
/// 받아 둔 기기에서도 알람을 만들 수 없다 — 막는 것은 오디오가 아니라 메모리에 없는
/// 매니페스트다. 선다운로드가 약속한 "비행기모드에서도 내일 알람" 의 전제가 이것이다.
///
/// 그래서 판정을 한쪽으로 기울이는 대신 **'모른다' 상태 자체를 없앤다.**
///
/// 안드로이드 짝은 `data/StockClipManifestStore.kt` 다.
enum StockClipManifestStore {
    private static let logger = Logger(subsystem: "com.alarmtalk.app", category: "StockClipManifest")
    private static let fileName = "stock-clip-manifest.json"

    private static var fileURL: URL? {
        guard let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else { return nil }
        // Application Support 는 처음엔 없을 수 있다.
        if !FileManager.default.fileExists(atPath: base.path) {
            try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        }
        return base.appendingPathComponent(fileName)
    }

    /// 매니페스트를 저장한다. 실패해도 조용히 넘어간다 — 이번 세션은 메모리 값으로 돈다.
    static func save(_ manifest: StockClipListResponse) {
        guard let url = fileURL else { return }
        do {
            let data = try JSONEncoder().encode(manifest)
            // ⚠ `.atomic` — 쓰다 죽으면 반쪽 JSON 이 남아 다음 실행이 매니페스트를
            // 못 읽는다. 그러면 이 파일을 둔 이유가 그대로 사라진다.
            try data.write(to: url, options: .atomic)
        } catch {
            logger.warning("Failed to persist the stock clip manifest")
        }
    }

    /// 디스크에 남은 매니페스트. 없거나 깨졌으면 nil.
    static func load() -> StockClipListResponse? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try JSONDecoder().decode(StockClipListResponse.self, from: data)
        } catch {
            // 깨진 파일은 지운다 — 남겨 두면 매번 디코드에 실패하며 같은 로그만 쌓인다.
            logger.warning("Discarding an unreadable stock clip manifest")
            try? FileManager.default.removeItem(at: url)
            return nil
        }
    }

    /// 로그아웃·탈퇴에서만 부른다. ⚠ 자동 401 에서는 지우지 말 것 — 같은 사람이 다시
    /// 로그인할 때 오프라인 판정이 통째로 '모른다' 로 되돌아간다.
    static func clear() {
        guard let url = fileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
