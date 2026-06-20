import Foundation

/// 알람 에디터에서 현재 어떤 미리듣기가 활성인지 가리키는 단일 진실 공급원(SSOT).
///
/// Android `AudioPreviewTarget` (AlarmEditorScreen.kt:80-85)
/// `{ SelectedCrop, CachedAudio, SharedVoiceInfo, StockClip }` 를 미러하되,
/// iOS 의 준비된 음성 칩(prepared chip)을 위해 `preparedVoice` 케이스를 추가했다
/// (Android 의 prepared 칩은 동작이 달라 대응 케이스가 없다).
///
/// 기존에 흩어져 있던 두 플레이어(voiceStudio.previewPlayer + localPreviewPlayer)와
/// `previewingStockMessageID` 상태를 하나로 합치며, `stockClip` 의 연관 id 가
/// `previewingStockMessageID` 를 대체한다.
enum AudioPreviewTarget: Equatable {
    /// 준비된 TTS/스톡 음성 칩의 캐시 재생(네트워크 없음).
    case preparedVoice
    /// 로컬 오디오(녹음/파일)의 크롭 윈도우 미리듣기.
    case selectedCrop
    /// 기존 알람에 저장돼 있던 로컬 오디오 캐시 재생.
    case cachedLocalAudio
    /// 공유받은 목소리 설정 시트의 미리듣기.
    case sharedVoiceInfo
    /// 스톡 클립 미리듣기. 연관 값은 클립의 messageId.
    case stockClip(String)
}
