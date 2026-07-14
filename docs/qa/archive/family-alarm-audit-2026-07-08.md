> ⚠️ 아카이브(2026-07-15): 이 감사의 P0/P1 은 이후 반영됨(alarm_recipient_state 신설, FCM push 배선 #548). 현행 코드 설명이 아님.

# 가족 알람 심층 감사 — 수신자 정지(A) · 목소리 소멸 시 알람 처리(B)

> 작성: 2026-07-08. 멀티에이전트 심층 감사(finder 8 → 종합 2 → 적대적 검증 → 리포트) 산출물.
> 최상위 P0 데이터손실(B-1)·권한게이트(A-3)·좀비알람(B-2)은 리뷰어가 원본 코드로 직접 재확인함.
> 코드 미변경 상태 기준 진단 문서(수정 전 스냅샷).

모든 핵심·의외 주장을 원본 코드로 독립 확인했다. 특히 billing-cancel.ts:185-188 주석은 "멤버 데이터는 보존(deleteVoiceData:false)"을 명시하는데, 바로 그 보존 의도가 owner 본인 정리(line 149, deleteVoiceData:true)가 먼저 도는 것을 막지 못해 수신자 알람이 삭제되는 비대칭을 오히려 더 선명하게 드러낸다. 아래가 최종 리포트다.

---

# AlarmTalk 감사 리포트 — 반복 가족알람 수신자 정지(A) · 목소리 소멸 시 알람 처리(B)

> 리포지토리 루트: `C:\Users\gyuwo\Desktop\AlarmTalk` (본문 `file:line`은 루트 기준 상대경로). 모든 판정은 이번 세션에서 원본 코드로 직접 확인함. 확인 불가 지점은 **미확정**으로 명시.

---

## 영역 A — 수신자가 반복 가족알람을 "그만받기/삭제"할 수 있는가

### 한 줄 판정
**부분적으로만 가능. 유일하게 동작하는 정지는 "개별 받은알람 로컬 토글 OFF" 하나뿐이며, 그마저도 안드로이드에 실동작 FCM 경로가 없다는 우연에 기대어 성립한다. 서버에 내구적 수신자 정지 수단이 전무하여 삭제·재설치·DB 마이그레이션으로 정지가 소실되고, 수신자의 "삭제"는 오히려 부활+재알림 스팸을 유발한다. (심각도 High)**

### 실제 동작 흐름 (확인됨)
1. **쓰기 경로는 생성자 전용.** 알람의 유일한 변경 경로 PATCH/DELETE `/:id`는 예외 없이 `WHERE a.id = ? AND a.user_id = ?`(=생성자) 게이트다(`packages/backend/src/routes/alarm-mutation.ts:427`, `:620-621`, args=`[id, userId]`). 가족알람은 `user_id=발신자·target_user_id=수신자`로 저장되므로 수신자가 호출하면 0행 → 404(`alarm-mutation.ts:624`). `family-alarm.ts`에는 라우트가 `POST /alarms`(:25)·`POST /alarms/voice`(:208) **2개뿐** — 수신자 mute/decline/opt-out 엔드포인트가 라우터 전체에 부재. **→ IDOR/과권한 구멍은 없으나, 수신자가 서버에서 알람을 끌 수단이 원천 부재.**
2. **서버 발화 파이프라인은 `is_active=1`을 정확히 존중.** cron(`index.ts:344-348`, `WHERE is_active = 1`), `/tick`(`alarm-query.ts:24-27`)이 모두 정상. 그러나 그 `is_active=0`을 만들 주체가 생성자뿐이라 수신자는 도달 불가.
3. **서버 push는 현재 완전한 무효(no-op).** cron은 firing 알람마다 `sendAlarmPush(target_user_id ?? user_id)`를 호출하지만(`index.ts:388`), `sendAlarmPush`는 토큰이 비면 즉시 `return []`(`fcm.ts:170-171`). `push_tokens` 테이블은 모노레포 전역에서 **INSERT/UPSERT가 단 한 곳도 없다**(생성은 `migrations.ts:365`의 CREATE TABLE뿐, 쓰기는 전부 DELETE). 안드로이드에는 `firebase/FirebaseMessaging/google-services/getToken` 매칭 **0건**(grep 결과 파일 없음), 매니페스트에 수신 서비스도 없음. **→ 수신자 울림은 100% 안드 로컬 AlarmManager 예약이 구동.**
4. **유일하게 동작하는 정지 = 로컬 토글 OFF.** `resolveReceivedRemoteEnabled`는 기존 RECEIVED_REMOTE 행에 대해 `existing.enabled && remoteEnabled`의 AND를 반환한다(`RemoteAlarmPullSyncService.kt:222-229`). 로컬 OFF(`existing.enabled=false`)면 서버 `is_active=1`이어도 결과 false → `enabled=false`로 upsert되고 스케줄을 건너뛴다(`:76`). 받은 알람은 서버로 push되지 않으므로(수신자 토글은 로컬 전용) 서버 `is_active`는 영원히 1이지만 로컬 OFF가 매 pull을 이긴다. **여기까지는 정상 동작.**

### 발견된 버그/구멍 (심각도순)

**A-1 · High — 수신자의 "삭제"는 스티키하지 않고 부활+재알림 스팸을 유발**
- `deleteAlarm`은 로컬 하드삭제만 수행하고 서버 통지/tombstone/decline이 없다: `alarmScheduler.cancel` + `alarmDao.delete(current)` (`apps/android-native/.../data/AlarmRepository.kt:319-330`). 서버 DELETE 호출 자체가 없다.
- 다음 백그라운드 동기화(WorkManager 주기, 통상 15분 하한 + 로그인/포그라운드 진입)에서 `getByRemoteAlarmId==null` → `existing==null` 분기 → 새 엔티티로 재구성 → `enabled=resolveReceivedRemoteEnabled(null, is_active)` = `remoteEnabled`(=`is_active!=false`) = **true** → 스케줄 재예약(`:76-81`) + `existing==null`이므로 `notifyReceivedAlarm` 재발송·`imported++`(`RemoteAlarmPullSyncService.kt:82-91`).
- **재현:** 수신자가 받은 반복 알람을 목록에서 스와이프/롱프레스 삭제 → 다음 sync 회차 → 알람이 새로 예약되고 "새로 받은 알람" 알림이 다시 뜬다. 반복 알람이라 매 회차 재발생 가능.

**A-2 · High — 정지 상태가 로컬 Room 단일 지점에만 존재 → 재설치/데이터삭제/DB 마이그레이션으로 소실·부활**
- OFF는 오직 Room의 `enabled=false`에만 산다. 행이 사라지면 `existing==null` → `resolveReceivedRemoteEnabled(null, true)=true` → `enabled=true` 부활·재알림.
- `AndroidManifest.xml`의 `allowBackup=false`(감사 근거)로 OS 백업 복원 없음. 로컬 DB는 `AlarmDatabase.kt:49`의 `fallbackToDestructiveMigration()`로 스키마 버전 상승 시 전체 와이프됨.
- 서버에는 이 OFF를 기억하는 필드가 없다(`alarm-mutation.ts:427`의 소유권 게이트 탓에 수신자는 서버 `is_active=0`을 쓸 수 없음).
- **재현:** 앱 재설치 또는 데이터 삭제 후 첫 로그인 → 받은 반복 알람 전부 `enabled=true`로 부활 + "새로 받은 알람" 재알림.

**A-3 · High — 수신자에게 서버측 정지 권한이 원천 부재(제품/신뢰 공백)**
- PATCH·DELETE 모두 `user_id=creator` 게이트(`alarm-mutation.ts:427`, `:621`), 가족 라우터엔 생성(POST)만(`family-alarm.ts:25`, `:208`). "원치 않는 반복 가족알람을 수신자가 스스로·내구적으로 차단"하는 계약이 서버에 존재하지 않는다. A-1·A-2는 이 근본 공백의 증상.

**A-4 · Medium — `allow_family_alarms` 마스터 토글은 소급 없음(미래 생성만 차단)**
- 검사는 생성 시점에만: `alarm-mutation.ts:228`(및 `family-alarm.ts:98`). pull이 쓰는 GET `/alarm`(`alarm-query.ts:72`)·`/tick`(`alarm-query.ts:24-27`)·cron(`index.ts:344-348`) 어디에도 `users.allow_family_alarms`를 조인/재검사하지 않음. 안드 수신 필터도 `target/sender` 존재 여부만 본다(`RemoteAlarmPullSyncService.kt:39-45`).
- **재현:** 수신자가 나중에 "가족알람 전체 차단"을 켜도, 이미 생성된 반복 가족알람은 계속 내려와 로컬 재예약·울림 지속. 사용자 기대(전체 차단)와 실제(미래 생성만 차단)가 불일치.

**A-5 · Medium (잠재 파국) — 현재 push 무효는 "FCM 미구현"이라는 우연에 의존**
- cron push 페이로드는 `data:{type:'alarm', alarmId, channelId}`만 싣고(`fcm.ts:178`) 로컬 `enabled`/`allow_family`/수신자 정지를 검사하지 않는다. 이미 `target_user_id`로 전송을 시도 중(`index.ts:388`)이라 **토큰만 채워지면 즉시 살아난다**(`fcm.ts:171`).
- 향후 안드에 `FirebaseMessagingService`+토큰 등록을 붙이거나 iOS가 FCM/APNs를 구현하면, push가 로컬 토글 OFF·`allow_family` off·A-1/A-2의 로컬 정지를 **모두 우회**해 수신자를 울릴 수 있다.

### 반복 유지 결정 하의 최소 수정 제안
"반복 알람은 반복 유지" 전제를 깨지 않으면서 수신자 정지를 내구화하는 최소안:
1. **수신자 상태 서버 저장 도입(핵심).** 공유 `alarms.is_active`(생성자 소유)를 건드리지 않고, 별도 `alarm_recipient_state(alarm_id, recipient_user_id, muted, declined, updated_at)`를 신설. 수신자에게는 이 상태만 쓰는 엔드포인트(mute/decline)를 열어 소유권 모델을 유지(생성자는 여전히 알람 소유).
2. **읽기 경로 전체를 이 상태로 게이트.** GET `/alarm`·`/tick`·cron·(미래의)push가 `target_user_id`로 `alarm_recipient_state`를 LEFT JOIN하여 `declined/muted` 수신자에게는 제외/미발화. → A-1·A-2·A-5를 한 번에 봉합(정지가 서버에 남아 재설치·마이그레이션·push를 모두 이김).
3. **클라 "삭제"를 서버 decline으로 배선.** 받은 알람 삭제 시 로컬 하드삭제 대신 서버 decline 호출 → 다음 pull에서 재생성/재알림 억제(현재 미사용인 삭제 의미를 서버 tombstone으로 연결).
4. **`allow_family_alarms` 소급 처리.** (2)의 읽기 게이트에 `target_user_id`의 `users.allow_family_alarms`도 함께 조인해 read-time 억제(생성자 알람을 파괴하지 않고 배달만 중단). A-4 해소.
5. **push 가드 선반영.** `sendAlarmPush` 진입부에서 수신자 mute/decline/allow_family를 확인 후 전송하도록 지금 추가해, FCM 수신부가 붙는 순간 A-5가 재발하지 않게 함.

---

## 영역 B — 목소리 소멸 시 알람 처리

### 모델 전제 (확인됨)
발화는 **순수 pull 모델**이다. cron은 `is_active=1` 알람의 `alarmId/mode/voice_profile_id/speaker_id`만 뽑아 FCM으로 `alarmId`만 실어 보내고 **fire 시점 재합성이 없다**(`index.ts:344-391`). 실제 바이트는 안드가 동기화 시 `GET /tts/messages/:id/audio`로 받아 로컬 캐시(`localAudioUri`)에 저장하고, 발화 시 `RingingService`가 그 로컬 파일만 재생한다. 서버는 R2 오브젝트 부재 시 404만 낼 뿐 재생성 폴백이 없다(`tts.ts:1213-1226`). **→ "목소리 소멸"의 영향은 서버 DB 알람 행을 어떻게 정리하느냐 + 그 정리가 기기 캐시에 언제 반영되느냐로 갈린다.**

### 시나리오별 알람 최종 상태 판정

| 트리거 | 코드 경로 | 알람 최종 상태 | 판정 |
|---|---|---|---|
| ① 음성 소유자가 **목소리 직접 삭제** | `voice-profile.ts:1112-1124` | **알람만**(mode=`sound-only`, voice_profile_id/message_id/speaker_id/raw NULL) | 안전(정상) |
| ① 메시지 강제삭제 · 스톡클립 삭제 | `tts.ts:1270-1286` · `stock-clips.ts:239` | **알람만**(동일 강등 UPDATE) | 안전(정상) |
| ② **본인** 구독취소/만료(자기 데이터, `deleteVoiceData=true`) | `paid-voice-cleanup.ts:42-57` | 본인 알람 **삭제**(의도된 계정정리) | 정상, 단 아래 ③ 부작용 동반 |
| ③ **공유자(owner) 취소** → owner 본인 정리(`deleteVoiceData=true`) | `billing-cancel.ts:147-149` → `paid-voice-cleanup.ts:42-57` | owner 공유 목소리를 쓴 **수신자 알람까지 하드 삭제** | **버그(데이터 손실)** |
| ④ owner 취소로 **강등되는 멤버** · RTDN deactivate(`deleteVoiceData=false`) | `billing-cancel.ts:69-72`, `:189` | 멤버 목소리 `is_shared=0`만, **수신자 알람은 캐시로 계속 발화** | **버그(오펀/좀비)** |
| ⑤ **그룹 탈퇴/제거**(`leavePlanGroupMember`, `deleteVoiceData=true`) | `billing-cancel.ts:239`, `:243` | 탈퇴자 자기+그 공유 목소리 쓴 **수신자 알람 삭제** | **버그(데이터 손실, ③과 동일 계열)** |
| ⑥ draft 목소리 TTL 소프트삭제 | `audio-retention.ts:200-211` | 굽힌 오디오 생존, 알람 정상 재생 | **오펀 아님(REFUTED)** |
| ⑦ `speaker_id`-only 알람의 목소리 소멸 | `alarm-mutation.ts:369` / `voice-profile.ts:1121` | 잠재적 `mode='tts'`+오펀 speaker_id → 404 | **미확정** |

### 발견된 버그/구멍 (심각도순)

**B-1 · High — ③ 공유자(owner) 취소가 수신자의 기상 알람을 하드 삭제(데이터 손실)**
- 수신자 B가 owner의 공유 목소리로 자기 알람을 만들면, `voiceProfileBelongsToCaller`가 같은 plan group·`is_shared=1`·non-draft 조건에서 이를 허용하고(`alarm-mutation.ts:142-149`), `alarms.voice_profile_id`에 **owner UUID**가 그대로 저장된다(`alarm-mutation.ts:368`; 공유 모델은 owner 프로필 행 자체를 반환 `tts.ts:284-302`). 메시지도 `messages.voice_profile_id=owner`(합성 시점 저장).
- owner가 취소하면 `cancelSubscriptionImmediate` 기본값 `{deleteVoiceData:true}`(`billing-cancel.ts:147`)로 owner 본인 정리가 **가장 먼저** 실행되고(`:149`), 그 `DELETE FROM alarms`의 절 `voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (owner))`에 **B의 알람이 매칭되어 하드 삭제**된다(`paid-voice-cleanup.ts:42-57`). 서브쿼리에 `is_shared/is_draft/deleted_at` 필터가 없어 owner의 모든 프로필을 잡는다. B의 메시지도 `DELETE FROM messages ... voice_profile_id IN (owner)`로 삭제되고(`:86-93`) R2 오디오까지 외부삭제 큐에 적재(`:23`).
- **비대칭의 핵심:** 동일한 "공유 목소리 소멸" 상황에서 명시적 삭제 경로(B의 ①)는 타인 알람을 `sound-only`로 **강등·보존**하는데(`voice-profile.ts:1112-1124`), 이 결제 정리 경로만 **하드 삭제**한다. `billing-cancel.ts:185-188` 주석은 "멤버 데이터 보존"을 명시하지만, 그 보존 로직(`user_id/target_user_id` 매칭, `deleteVoiceData:false`)은 **owner 본인 정리가 `voice_profile_id` 절로 크로스멤버 알람을 지우는 것을 막지 못한다.**
- 트리거 실경로: 즉시취소 `billing-mutation.ts:707`(`deleteVoiceData:true`), 만료 `billing-cancel.ts:361`(`!nextPlanId`)·`:402`. ⑤ 탈퇴/제거도 동일 계열(`:239`, `:243`).
- **재현:** 가족플랜 owner A가 공유 목소리 V 제공 → 멤버 B가 V로 자기 기상알람 생성 → A가 구독 취소 → B의 기상 알람 행·메시지·오디오가 무통보로 서버에서 소멸.

**B-2 · High — ④ 강등 멤버/RTDN deactivate가 좀비(권한 우회) 알람을 남김**
- `deleteVoiceData=false` 경로는 `UPDATE voice_profiles SET is_shared=0 WHERE user_id=? AND is_shared=1`만 실행하고 알람/메시지/오디오는 무처리(`billing-cancel.ts:69-72`). owner 취소 시 비개시 멤버 전원이 이 경로(`:189`), RTDN deactivate도 전원 이 경로(`billing-google-rtdn.ts:260`, 감사 근거).
- 그 멤버의 공유 목소리로 수신자가 만든 알람은 그대로 살아 **이미 로컬 캐시된 사전렌더 오디오로 계속 발화**한다. 발화용 오디오 제공 `GET /tts/messages/:id/audio`는 `user_id` 소유 OR `alarms.target_user_id` 매칭 OR 시스템 프리셋만 게이트하고 **`is_shared`/같은그룹을 재검하지 않는다**(`tts.ts:1180-1195`). cron도 재검 없음(`index.ts:344-348`). → 접근권(`is_shared`)은 취소됐는데 목소리는 계속 울리는 좀비.
- **재현:** 멤버 M이 공유한 목소리로 수신자가 알람 생성 → M이 강등(owner 취소/RTDN) → M의 목소리는 un-share되지만 수신자 알람은 캐시 오디오로 무기한 계속 울림.

**B-3 · Medium — 안드 수신 동기화가 upsert-only라 서버 삭제/강등이 기기에 미반영**
- `RemoteAlarmPullSyncService`는 upsert만 하고(`RemoteAlarmPullSyncService.kt:70`) 원격에서 사라진 알람을 로컬에서 삭제하지 않으며, `target=me·sender!=me`인 **받은 알람만** 스코프한다(`:38-45`).
- 결과 (a): B-1에서 서버가 수신자 알람을 하드 삭제해도 **로컬 유령 알람**이 남아 캐시 오디오로 계속 울릴 수 있다(서버 데이터는 소실됐는데 기기는 계속 울리는 이중 파손). 결과 (b): 소유자 본인이 자기 목소리를 삭제해 서버가 자기 알람을 `sound-only`로 강등해도, 이 경로는 소유자 self 알람을 다루지 않아 강등이 소유자 기기에 반영되지 않을 수 있다(로컬 stale 음성 계속 재생). **소유자 self 알람의 서버→로컬 강등 전파 경로 존재 여부는 미확정.**

**B-4 · Medium (미확정) — `speaker_id`-only 알람이 강등 스윕에서 누락될 여지**
- `speaker_id`는 생성 시 소유권/존재 검증 없이 그대로 INSERT된다(`alarm-mutation.ts:369`; `voice_profile_id`는 `voiceProfileBelongsToCaller`로 검증되는 것과 대조). 목소리 삭제 강등 UPDATE의 WHERE는 `voice_profile_id`와 message 경유만 매칭하고 **`speaker_id` 분기가 없다**(`voice-profile.ts:1121-1122`).
- `speaker_id`가 세팅되고 `voice_profile_id`가 NULL이며 message가 그 프로필과 무관한 알람이 실제로 도달 가능하다면, 목소리/업로드 소멸 시 그 알람은 `mode='tts'`+오펀 `speaker_id`로 남아 cron이 tts 발화 시도 → 오디오 404. **해당 알람 형태의 실제 생성 가능성은 미확정**(코드상 방어 제약 미확인).

**B-5 · Low — 이론적 무음 구멍**
- 안드 발화에서 시스템 URI가 모두 실패하고 번들 raw 리소스(`R.raw.voice_alarm_default`) 로드까지 실패하면 `mediaPlayer=null`로 그 알람은 무음(`RingingService.kt:227`). 다만 진동+풀스크린이 독립 유지돼 각성 자체는 실패하지 않으며, 앱 내장 리소스 로드 불가는 비현실적.

### 정상 동작(방어)으로 확인된 것
- ① 명시적 목소리 삭제·메시지 강제삭제·스톡클립 삭제는 직접(`voice_profile_id`)+메시지경유(`message_id IN messages.voice_profile_id`) 참조 알람을 모두 `sound-only`로 강등하고 오디오·R2·`messages.audio_url`까지 정리(`voice-profile.ts:1107-1136`). 오펀 없음.
- 안드 발화는 서버 `voice_profile_id`에 런타임 의존하지 않고 로컬 캐시만 재생하며, 파일없음/손상/플레이어실패에 대해 번들 알람음→진동→풀스크린 다단 폴백(`RingingService.kt`). 캐시 실패 시 `ALARM_ONLY`로 그레이스풀 강등(`RemoteAlarmPullSyncService.kt:125-141`). **크래시·무음 사실상 없음.**
- TTL 정리는 활성 알람이 `raw_audio_url` 또는 `message_id→audio_url`로 참조 중인 R2 오브젝트를 `NOT EXISTS` 이중 가드로 보존(`audio-retention.ts:260-272`).

### 수정 제안 — "삭제할지 강등할지" 권고
**권고: 모든 목소리 소멸 경로를 "알람만(sound-only) 강등"으로 통일하라. 남의 기상 알람을 조용히 하드 삭제하지도(B-1/⑤), 취소된 목소리를 계속 울리지도(B-2) 않는 단일 정책이 옳다.**
1. **B-1 봉합 — `paid-voice-cleanup`의 알람 처리를 분기.** 삭제 대상 사용자 **본인 소유** 알람(`user_id`/`target_user_id`=강등 사용자)만 삭제하고, **타인 소유이지만 강등 사용자의 `voice_profile_id`를 참조하는 알람**은 `voice-profile.ts:1112-1124`와 동일한 `sound-only` 강등 UPDATE로 보존한다. 메시지 삭제 절도 동일 원칙으로 크로스멤버 message는 오디오 링크만 끊고 보존/강등.
2. **B-2 봉합 — `deleteVoiceData=false`(un-share)에서도 타인 알람 강등.** `is_shared=0`으로 끌 때, 그 목소리를 참조하는 **타 사용자 알람**을 `sound-only`로 강등한다(접근권 취소를 데이터 계층에 반영). 서버 게이트만으로는 이미 캐시된 오디오를 막지 못하므로 강등 + 클라 reconcile이 함께 필요.
3. **B-3 봉합 — 클라 reconcile 추가.** 안드에 (a) 소유자 self 알람의 서버 `sound-only` 강등을 로컬에 반영, (b) 원격에서 사라졌거나 강등된 받은알람을 로컬에서 삭제/강등하는 경로를 추가(현재 upsert-only의 사각 제거).
4. **B-4 대비 — 강등 스윕 WHERE에 `speaker_id` 분기 추가** 및/또는 생성 시 `speaker_id` 소유권 검증(도달 가능성 확정 후).
5. **정책 방어선 — 발화 오디오 제공에 `is_shared`/같은그룹 재검을 선택적으로 추가**해, 향후 캐시 무효화·재다운로드 시 취소된 목소리가 재서빙되지 않게 함(좀비 재발 차단).

> ⑥ draft TTL은 수정 불필요(아래 REFUTED 참조). 굽힌 `audio_url`을 건드리지 않아 알람 재생이 정상 유지된다.

---

## 검증(반증) 결과 요약

### 영역 A
| # | 주장 | 판정 | 근거(핵심 file:line) |
|---|---|---|---|
| A-a | 서버 push는 현재 안드 수신자에게 완전한 no-op이며, 수신자 울림은 오직 로컬 AlarmManager가 구동 | **CONFIRMED** | `push_tokens` INSERT 0건(`migrations.ts:365`만 CREATE) · `fcm.ts:170-171` 빈 토큰 `return []` · 안드 firebase 매칭 0건 · `AlarmReceiver`는 로컬 `ACTION_ALARM_TRIGGER`만 · iOS도 원격 토큰 등록 부재 |
| A-b | `resolveReceivedRemoteEnabled` AND 게이트가 로컬 OFF를 모든 후속 pull에서 유지, 서버 `is_active=1`이 되살리는 경로 없음 | **CONFIRMED** | `RemoteAlarmPullSyncService.kt:222-229` · 유일 null(skip)은 `parseTime` 실패(`:120`), 오디오 실패는 `getOrNull`→ALARM_ONLY(`:125-138`) · 편집(PATCH)은 alarm id 불변 |
| A-c | `allow_family_alarms=false`가 이미 생성된 반복 가족알람의 pull/발화를 소급 차단하지 못함 | **CONFIRMED** | 검사는 생성시점만(`alarm-mutation.ts:228`, `family-alarm.ts:98`) · `/tick`(`alarm-query.ts:24-27`)·list(`:72`)·cron(`index.ts:344-348`)에 조인/필터 없음 · 클라 필터도 target/sender만(`RemoteAlarmPullSyncService.kt:39-45`) |
| A-d | 로컬 삭제 후 다음 pull이 부활+재알림 수행 | **CONFIRMED(이번 세션 직접 확인)** | `AlarmRepository.kt:319-330` 로컬 하드삭제만 · `existing==null`→`notifyReceivedAlarm`+`imported++`(`RemoteAlarmPullSyncService.kt:82-91`). ※ 적대적 검증 배열에서는 별도 반환 없었으나 원본으로 확인 |
| A-e | 정지 상태가 로컬 단일 지점 → 재설치로 소실·부활 | **CONFIRMED(메커니즘)** | AND 게이트 반증 경로(`existing==null`→`remoteEnabled=true`) + `allowBackup=false` + `fallbackToDestructiveMigration`(`AlarmDatabase.kt:49`). ※ 재설치 트리거 단독 반증은 미수행 |

### 영역 B
| # | 주장 | 판정 | 근거(핵심 file:line) |
|---|---|---|---|
| B-a | `deleteVoiceData=false`(멤버 강등/RTDN)가 수신자 좀비 알람 생성 | **CONFIRMED** | `billing-cancel.ts:69-72`(is_shared=0만)·`:189`·`billing-google-rtdn.ts:260` · 발화 오디오 게이트 `is_shared` 무재검(`tts.ts:1180-1195`) · cron 무재검(`index.ts:344-348`) |
| B-b | owner 취소(`deleteVoiceData=true`)가 수신자 알람을 강등 아닌 하드 삭제 → 데이터 손실 | **CONFIRMED (broken)** | `paid-voice-cleanup.ts:42-57`(`voice_profile_id IN owner-profiles`) · owner 본인 정리 선행(`billing-cancel.ts:149`) · 멤버 보존 가드가 owner의 `voice_profile_id` 절을 못 막음(`:185-190`) · 트리거 `billing-mutation.ts:707` |
| B-c | `speaker_id`-only 알람이 강등에서 누락되어 tts+404 오펀 성립 | **미확정(반증 미완)** | 강등 WHERE에 speaker_id 없음은 확인(`voice-profile.ts:1121`)·무검증 저장 확인(`alarm-mutation.ts:369`)이나, 해당 알람 형태의 실제 도달 가능성 미확정 |
| B-d | draft TTL 소프트삭제가 알람을 `mode='tts'`+404 오펀으로 남김 | **REFUTED** | `cleanupStaleDraftVoices`는 `deleted_at`만 세팅+클론 큐잉뿐, `messages.audio_url`/R2/알람 미처리(`audio-retention.ts:200-211`). 굽힌 audio_url 생존 → `GET /tts/messages/:id/audio` 200 반환(`tts.ts:1212` 이후). 클라도 default 폴백 → 오펀/무음 아님 |
| B-e | 안드가 소유자 self 알람의 서버 강등/삭제를 반영하는 별도 reconcile 부재 | **CONFIRMED(부재)/일부 미확정** | upsert-only·received-only 확인(`RemoteAlarmPullSyncService.kt:38-45`, `:70`). 소유자 self 알람의 서버→로컬 강등 전파 경로 존재 여부는 미확정 |

---

## 우선순위 수정 목록

### P0 (출시 차단급 — 데이터 손실 / 권한 우회 / 신뢰 파손)
- **P0-1 (B-1) · 공유자 취소가 수신자 기상 알람을 하드 삭제.** `paid-voice-cleanup.ts:42-57`의 `DELETE FROM alarms`에서 타인 소유 알람은 `sound-only` 강등으로 전환하고, 삭제는 강등 사용자 본인 소유 알람으로 한정. 메시지 삭제 절도 동일 원칙. (실경로 `billing-mutation.ts:707`, `billing-cancel.ts:149/239/361/402`)
- **P0-2 (B-2) · 강등/RTDN 후 취소된 공유 목소리가 좀비로 계속 울림.** `deleteVoiceData=false`(`billing-cancel.ts:69-72`, `:189`; `billing-google-rtdn.ts:260`)에서 un-share 시 타 사용자 알람을 `sound-only`로 강등 + 클라 reconcile로 캐시 무효화.
- **P0-3 (A-1/A-2/A-3) · 수신자에게 내구적 서버측 정지 부재 → 삭제 부활·재알림 스팸·재설치 소실.** 수신자 상태(`alarm_recipient_state`) 신설 + 읽기 경로(list/tick/cron/push) 게이트 + 클라 삭제→서버 decline 배선. (안드 `AlarmRepository.kt:319-330`, 서버 `alarm-mutation.ts:427/620-621`, `family-alarm.ts`)

### P1 (중요 — 정합/기대 불일치)
- **P1-1 (A-4) · `allow_family_alarms` 소급 미적용.** P0-3의 읽기 게이트에 `target_user_id`의 `allow_family_alarms` 조인 포함(`alarm-query.ts:24-27/72`, `index.ts:344-348`).
- **P1-2 (B-3) · 안드 upsert-only의 사각.** 소유자 self 알람 강등 반영 + 원격 삭제/강등분 로컬 reconcile 추가(`RemoteAlarmPullSyncService.kt:38-45/70`).
- **P1-3 (A-5) · push 가드 선반영.** `sendAlarmPush` 진입부에서 수신자 mute/decline/allow_family 확인 후 전송(`fcm.ts:162-184`, `index.ts:388`) — FCM 수신부 부착 시점의 파국 예방.

### P2 (낮음 — 방어 강화 / 조건부)
- **P2-1 (B-4) · `speaker_id` 오펀 대비.** 강등 스윕 WHERE에 speaker_id 분기 추가 및/또는 생성 시 소유권 검증(`voice-profile.ts:1121`, `alarm-mutation.ts:369`). **선행: 해당 알람 형태 도달 가능성 확정(미확정).**
- **P2-2 (정책 방어선) · 발화 오디오 제공에 `is_shared`/같은그룹 재검 추가**(`tts.ts:1180-1195`) — 캐시 재다운로드 시 취소 목소리 재서빙 차단.
- **P2-3 (B-5) · 번들 톤 로드 실패 무음** — 진동/UI로 각성은 보완되나 로깅 강화(`RingingService.kt:227`). 비현실적 케이스.

### 조치 불필요
- **draft TTL 오펀 (B-d) — REFUTED.** 굽힌 오디오가 생존하여 알람 재생이 정상 유지됨. 현 코드 유지.
