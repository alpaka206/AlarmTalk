package com.alarmtalk.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue

/**
 * 지금 **자기 창을 연 모달**(알럿·바텀시트·`Dialog`)이 몇 개 떠 있는가.
 *
 * 왜 필요한가: 개인 플랜 종료 안내는 **앱에 들어올 때마다** 뜨는데, '들어옴' 은 프로세스
 * ON_START 라 문서 선택기·시스템 설정·브라우저에서 돌아오는 것도 진입이다. 그때 목소리 등록
 * 창 같은 모달이 아직 열려 있으면 안내가 그 **위에** 얹힌다 — 모달이 둘이면 둘 다 못 읽는다
 * (`docs/spec/gates-and-overlays.md` 「개인 플랜 종료 안내」). 모달은 화면 곳곳에서 로컬
 * 상태로 열리므로 하나하나 뷰모델 플래그로 끌어올리는 대신, **창을 여는 껍데기**가 스스로
 * 여기에 이름을 적는다([TrackOpenModal]).
 *
 * ⚠ **새 `Dialog`·`ModalBottomSheet` 를 직접 만들면 거기에도 [TrackOpenModal] 을 부를 것.**
 *   빠뜨리면 그 모달 위로 진입 안내가 겹쳐 뜬다. 껍데기(`IosAlertDialog`·`WakerSelectionSheet`·
 *   `WakerFormSheet`)를 쓰면 이미 들어 있다.
 *
 * 프로세스에 하나다 — 안내를 띄우는 화면(`MainActivity`)이 하나라 전역으로 충분하다.
 * 값은 스냅샷 상태라 읽는 컴포지션이 바뀌면 다시 그려진다.
 */
internal object OpenModalRegistry {
    var openCount by mutableIntStateOf(0)
        private set

    fun opened() {
        openCount += 1
    }

    fun closed() {
        openCount = (openCount - 1).coerceAtLeast(0)
    }
}

/**
 * 이 컴포지션이 살아 있는 동안 [OpenModalRegistry] 에 '모달 하나가 떠 있다' 고 적는다.
 * 모달을 그리는 **같은 조건 블록 안에서**, 창을 여는 호출 바로 앞에 부른다.
 */
@Composable
internal fun TrackOpenModal() {
    DisposableEffect(Unit) {
        OpenModalRegistry.opened()
        onDispose { OpenModalRegistry.closed() }
    }
}
