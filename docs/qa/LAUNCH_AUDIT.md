# AlarmTalk 출시 전 감사 리포트

생성: 멀티에이전트 감사(8개 차원, 적대적 검증) · 확정 54건, 기각 7건

심각도: high 7 / medium 17 / low 30


---

## 심각도: HIGH


### [be-auth-billing] Google OAuth login never checks email_verified, enabling email-based account takeover

- **파일**: `packages/backend/src/lib/oauth.ts` :120-140 (verifyGoogleIdToken); consumed at packages/backend/src/routes/auth.ts:385-431
- **설명**: verifyGoogleIdToken declares email_verified in ExternalTokenPayload (oauth.ts:4) but never reads it. /auth/google then links accounts by `WHERE google_id = ? OR email = ?` (auth.ts:396) and, when a row matches by email, overwrites that existing account's google_id with the caller's Google sub and issues a session for it (auth.ts:417-436). The same gap exists for Apple where `email` from the token is trusted unconditionally (auth.ts:540-554). Google explicitly requires verifying email_verified before trusting the email claim; without it, a Google identity whose email claim is unverified that collides with a victim's email+password account (users.email is UNIQUE, migrations.ts:163) can be linked to and take over the victim account. This is the canonical OAuth account-linking vulnerability.
- **수정안**: In verifyGoogleIdToken, reject tokens where email_verified is not true (boolean true or string 'true') before returning the payload. For Apple, only trust payload.email when email_verified is true and never fall back to a client-supplied email for linking. Do not auto-link an OAuth identity to a pre-existing email+password account by email alone; require an explicit, authenticated link step.


### [be-alarm-tts-voice] Daily TTS limit has a read-then-increment race that lets users burn unlimited paid ElevenLabs calls

- **파일**: `packages/backend/src/routes/tts.ts` :642-653, 884-892, 961-964
- **설명**: The free/plus daily cap is enforced by (1) reading `daily_tts_count` into an in-memory snapshot (lines 642-653), (2) re-checking that snapshot's `dailyLimitExceeded` boolean right before synthesis (lines 884-892), and (3) incrementing with `UPDATE users SET daily_tts_count = daily_tts_count + 1` only AFTER a successful synthesis (lines 961-964). There is no atomic slot reservation. If a user fires N concurrent /tts/generate requests, every request reads the same count (e.g. 2 < free limit 3), every one passes the guard, every one calls ElevenLabs textToSpeech, and only then does each increment. The cap of 3/day is trivially bypassed to N synthesis calls per burst. Each ElevenLabs v3 call costs real money, so this is a direct cost-blowup vector. The project's own docs/tech/backend-findings.ko.md:72-74 already documents this exact issue and proposes an atomic `UPDATE ... WHERE daily_tts_count < :limit` reservation, but the code still uses the non-atomic pattern.
- **수정안**: Reserve the slot atomically BEFORE synthesis: `UPDATE users SET daily_tts_count = daily_tts_count + 1 WHERE (id=? OR google_id=?) AND daily_tts_count < :limit` and treat rowsAffected===0 as DAILY_TTS_LIMIT_EXCEEDED. On synthesis failure or cache hit, compensate by decrementing. This closes the concurrent-burst window that currently allows uncapped paid regeneration.


### [be-alarm-tts-voice] Alarm create/update rejects system stock-clip message_id, breaking free-plan stock-clip alarms

- **파일**: `packages/backend/src/routes/alarm-mutation.ts` :261-269
- **설명**: Stock clips are stored as messages owned by SYSTEM_VOICE_LIBRARY_USER_ID ('70000000-0000-4000-9000-000000000001') with is_preset=1 (stock-clips.ts:308-325). The free plan is explicitly allowed to build TTS alarms from these stock clips: usesOnlySystemStockVoice() (alarm-mutation.ts:57-87) deliberately accepts a message_id that JOINs to a system voice. However, the actual alarm INSERT validation that runs when a client sends message_id only accepts messages the caller owns: `SELECT id FROM messages WHERE id = ? AND user_id IN (userPk, userId)` (lines 262-264). A system stock-clip message_id has user_id = SYSTEM_VOICE_LIBRARY_USER_ID, so this returns 0 rows and the request fails with 404 MESSAGE_NOT_FOUND. The same ownership-only check exists implicitly on PATCH (effectiveVoiceFields uses current.message_id, but a newly-provided system message_id is never re-validated as owned, and GET /tts/messages/:id/audio at tts.ts:1115-1122 DOES special-case is_preset+is_system — confirming the system anticipated stock message_ids flow through the alarm path). The two halves of the design disagree: usesOnlySystemStockVoice green-lights stock message_ids for plan gating, but the ownership SELECT blocks them. If the Android client attaches the stock-clip message_id (TtsApi StockClip exposes message_id and RemoteAlarmMapper sends ttsMessageId), free-plan stock-clip alarms cannot be created server-side.
- **수정안**: In the message_id branch of alarm POST/PATCH, also accept system stock-clip messages: extend the validation to `... AND (user_id IN (?, ?) OR (COALESCE(is_preset,0)=1 AND EXISTS(SELECT 1 FROM voice_profiles vp WHERE vp.id = messages.voice_profile_id AND COALESCE(vp.is_system,0)=1)))`, mirroring the audio endpoint. Otherwise free users can preview a stock clip but cannot set an alarm with it.


### [be-family-social-voucher] Family voucher redemption silently dissolves the redeemer's existing family group and downgrades its members

- **파일**: `packages/backend/src/lib/voucher-redemption.ts` :242-260
- **설명**: During redemption, cancelActiveSubscriptionsForUser(db, userPk, ...) is called before creating the new subscription (line 242). If the redeeming user currently OWNS a family plan group, cancelSubscriptionImmediate (billing-cancel.ts:151-192) detects ownerUserId===userPk and cascades: it cancels every other member's subscription, downgrades them all to free, and DELETEs all plan_group_members rows (billing-cancel.ts:169-191). So a family owner who redeems any INV/GIFT code (e.g. a friend's invite) instantly and irreversibly dissolves their own paid family group and strips all their members' access — with no warning and no confirmation surfaced by the voucher path. This is a data/access-loss footgun that orphans the owner's whole group.
- **수정안**: Before cascading, detect when the redeemer owns an active group and either block the redemption with a clear error (must transfer ownership or dissolve first) or require an explicit confirm flag. At minimum, do not auto-destroy other members' subscriptions as a side effect of one user redeeming a code.


### [voice-file-lifecycle] Deleting a TTS message leaves its R2 audio object orphaned forever

- **파일**: `packages/backend/src/routes/tts.ts` :1221-1229
- **설명**: tts.delete('/messages/:id') deletes the generated_audio_assets row (DELETE FROM generated_audio_assets WHERE message_id = ?) and the messages row, but never deletes the backing R2 object (generated_audio_assets.audio_object_key) nor enqueues it via enqueueExternalDeletion. Once the DB row is gone, the object key is no longer recorded anywhere, so neither the TTL cron (cleanupExpiredAudio only scans existing generated_audio_assets rows, audio-retention.ts:189-200) nor drainExternalDeletions can ever reach it. Compare with the sibling deleters that DO clean R2: alarm-mutation.ts:522-544 and voice-profile.ts:937-949 both delete the R2 object before dropping the asset row. This is the most common user action (deleting a saved message from the library), so on a real launch every message deletion permanently leaks one mp3 in the prod bucket voice-alarm-voices-prod.
- **수정안**: Before deleting the generated_audio_assets rows, SELECT their audio_object_key WHERE message_id = ? AND audio_object_key IS NOT NULL and either call new R2VoiceStorage(c.env.VOICE_BUCKET).delete(key) (like alarm-mutation.ts) or enqueueExternalDeletion(db, 'r2_object', key) for the cron to drain. Also NULL/remove the message before relying on it being gone.


### [voice-file-lifecycle] Raw alarm clips uploaded to R2 are never tracked in the DB, so unattached uploads leak permanently

- **파일**: `packages/backend/src/routes/alarm-source.ts` :86-108
- **설명**: POST /alarm/source writes the clip to R2 at raw-alarms/{userId}/{uuid} via bucket.put and returns the key, but writes NO database row at all. The object only becomes deletable if the client later creates/updates an alarm with raw_audio_url = r2://raw-alarms/... (then alarm DELETE at alarm-mutation.ts:505-513 can enqueue it). If the user uploads a recording and then abandons the flow (closes the app, picks a different clip, network error before alarm save) the object is orphaned: there is no DB row, and no cleanup path enumerates the bucket (grep shows zero .list() calls and cleanupExpiredAudio only scans voice_uploads + generated_audio_assets tables). These orphans accumulate with no TTL and no deleter. At launch scale this is unbounded R2 storage growth plus a GDPR gap (an abandoned upload survives even account deletion, because enqueueUserVoiceArtifacts in audio-retention.ts:88-98 only enqueues raw_audio_url values that are actually referenced by an alarms row).
- **수정안**: Persist every raw-alarms upload in a tracking table (e.g. raw_alarm_uploads(id, user_id, object_key, created_at, attached INTEGER DEFAULT 0)) at upload time, mark attached=1 when an alarm adopts it, and extend cleanupExpiredAudio to enqueue R2 deletion for rows that are still unattached after a short TTL (e.g. 24-48h). Also enqueue these object_keys in enqueueUserVoiceArtifacts for account deletion.


### [android-correctness] Alarm fire can crash the app (FGS start from background) when scheduled via the inexact fallback

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/alarm/AlarmReceiver.kt` :27
- **설명**: AlarmReceiver.onReceive() calls RingingService.start(context, alarmId) (RingingService.kt:606-612), which does ContextCompat.startForegroundService() with NO try/catch anywhere in the chain. The app targets SDK 35, so Android 12+ FGS background-start restrictions apply. An exact-alarm broadcast (setAlarmClock) grants a temporary FGS-start exemption, but the inexact fallback used in AlarmScheduler.schedule() — alarmManager.setAndAllowWhileIdle() at AlarmScheduler.kt:46 — does NOT grant that exemption. The fallback is reachable in production: PermissionGate only blocks NEW alarm creation/enabling when exact-alarm permission is missing, but an already-enabled alarm stays scheduled, and reschedulePendingAlarms() (AlarmRepository.kt:478, run on BOOT_COMPLETED and app start) re-arms it through the same schedule() path. If the user revokes 'Alarms & reminders' after creating an alarm, the next fire arrives as a plain background broadcast and startForegroundService() throws ForegroundServiceStartNotAllowedException, which is uncaught inside a BroadcastReceiver → process crash → the alarm never rings and the app dies. This is exactly the 'alarm silently fails to fire' class of launch blocker.
- **수정안**: Wrap the startForegroundService call (and the AlarmReceiver invocation) in try/catch for ForegroundServiceStartNotAllowedException. On failure, fall back to posting the full-screen-intent ringing notification directly (the RINGING_CHANNEL_ID notification already carries setFullScreenIntent), and/or re-check canScheduleExactAlarms() before relying on the inexact path. Also re-evaluate enabled alarms when exact-alarm permission state changes so users are told their alarms may be delayed/unreliable.


---

## 심각도: MEDIUM


### [be-auth-billing] pending_deletion enforcement fails open if the user-resolution query throws

- **파일**: `packages/backend/src/middleware/auth.ts` :89-152
- **설명**: authMiddleware resolves the user row and enforces the pending_deletion gate inside a try block (lines 89-140). If the SELECT/INSERT throws for any reason, the catch (lines 141-150) sets userIdPK = verified.sub and calls await next() anyway, so the deletion_status check is skipped entirely. An account scheduled for deletion (which is supposed to be blocked from all APIs except GET/DELETE /user/me) would regain full API access on any transient DB error in this path, and the request proceeds with a best-effort PK that may not be the true users.id.
- **수정안**: On user-resolution failure for an authenticated request, fail closed (return 503/500) rather than proceeding, or at minimum re-run the pending_deletion path-restriction before calling next(). Do not grant API access when the deletion gate cannot be evaluated.


### [be-auth-billing] No dedicated rate limiting / brute-force protection on auth endpoints

- **파일**: `packages/backend/src/index.ts` :42, 188; packages/backend/src/middleware/rateLimit.ts:24-25
- **설명**: /api/auth (login, register, email-code, email-code/verify, google, apple) is mounted directly on app (index.ts:188) and is covered only by the single global rateLimitMiddleware (index.ts:42) of 60 req/min shared across ALL endpoints for the same IP key. There is no stricter per-route limit on credential login or on email-code verification. Login attempts return distinct codes (AUTH_INVALID_CREDENTIALS vs AUTH_OAUTH_ONLY) and email-code verification allows up to 5 attempts per code with unbounded code re-requests, so 60/min/IP is far too loose for password brute-force and code guessing at launch. The limiter is also per-isolate in-memory (rateLimit.ts:10-13), so the real global ceiling is multiplied by the number of live isolates.
- **수정안**: Add a tight, separate limiter (e.g. 5-10/min per IP+email) to /auth/login, /auth/register, and /auth/email-code(/verify). Back it with Durable Objects or KV so the limit is global rather than per-isolate, as the file's own comment notes.


### [be-auth-billing] No Apple/Google server-to-server billing notifications; entitlements only refreshed on client confirm or 5-min cron

- **파일**: `packages/backend/src/routes/billing-apple.ts` :whole file; also billing-google.ts and index.ts:223-242
- **설명**: Entitlement state is only created/refreshed when the client calls /billing/apple/confirm, /billing/google/confirm, or /billing/portone/complete, and downgraded by the local cron processSubscriptionExpiry (index.ts:237-242) which only acts once subscriptions.expires_at passes. There is no App Store Server Notifications V2 or Google Real-Time Developer Notifications (Pub/Sub) webhook (grep for webhook/notification/signedPayload finds none in billing). Consequences at launch: refunds, charge-backs, Apple/Google-side cancellations, billing retries, and grace-period transitions are not reflected until the client happens to re-confirm or the store-reported expiry elapses. A user who refunds keeps paid features until expiry; a renewal that the client never reports leaves the subscription to be force-cancelled by cron with deleteVoiceData=true at expiry even though it is still valid at the store.
- **수정안**: Implement signed App Store Server Notifications V2 and Google RTDN webhook endpoints (verify Apple JWS signature chain and Google Pub/Sub auth), and drive entitlement grant/revoke from them. Until then, document the refund/cancellation lag as a known launch limitation and reconcile periodically via the server APIs already wired up here.


### [be-alarm-tts-voice] System-voice cache hit returns another user's message_id, which downstream alarm creation will reject

- **파일**: `packages/backend/src/routes/tts.ts` :853-882, 1289-1298
- **설명**: For system (stock) voices, findCachedGeneratedAudio is called with anyUser:true (line 856-858), and the SQL drops the user filter entirely (`WHERE ${anyUser ? '' : 'ga.user_id IN (?, ?) AND '}ga.request_hash = ?`, line 1295). The returned cached.messageId is whichever user generated that (voice x text) pair first — typically the SYSTEM_VOICE_LIBRARY_USER_ID for true stock clips, but it can also be an ARBITRARY paid user who happened to synthesize the same custom text on a shared/system voice. The /tts/generate response then echoes that foreign message_id (line 861) as `message_id`. The caller is expected to use this message_id to attach an alarm, but POST /alarms only accepts owned message_ids (alarm-mutation.ts:262), so an alarm built from a cache-hit foreign message_id silently 404s. This is both a correctness break (cache hits behave differently from cache misses, which return the caller's own freshly-inserted message_id at line 973) and a minor info leak (one user learns another user's message UUID).
- **수정안**: On a system-voice cache hit, do not return a foreign user's message_id. Either (a) insert a thin per-caller messages row pointing at the same audio_url and return that id, or (b) constrain the anyUser cache lookup to is_preset rows owned by SYSTEM_VOICE_LIBRARY_USER_ID so the returned message_id is always the canonical stock message, and make the alarm path accept it (see related finding).


### [be-alarm-tts-voice] Voice clone has no upload byte-size cap before reading the full file into memory and sending to ElevenLabs

- **파일**: `packages/backend/src/routes/voice-profile.ts` :686, 658-684
- **설명**: POST /voice/clone validates durationMs (60-120s) but never validates the audio byte size. It calls `await audioFile.arrayBuffer()` (line 686) on the raw multipart file with no MAX_BYTES guard, unlike POST /voice/upload which caps at MAX_UPLOAD_BYTES = 25 MiB (voice-upload.ts:79-87) and POST /alarm/source which caps at 5 MiB (alarm-source.ts:76-84). A client can claim durationMs=90000 while uploading an arbitrarily large file; the whole buffer is loaded into the Worker's memory and forwarded to ElevenLabs createInstantClone. On Cloudflare Workers this risks hitting the 128 MB memory limit (request OOM / 1102) and forwards oversized payloads to a paid provider. durationMs is client-supplied and untrusted, so it is not a real size bound.
- **수정안**: Add the same byte-size cap (e.g. 25 MiB) on the clone audio buffer before arrayBuffer()/enrollment, returning 413 AUDIO_FILE_TOO_LARGE. Do not trust durationMs as a size proxy.


### [be-family-social-voucher] Character /xp endpoint grants XP twice on concurrent duplicate-nonce requests (no transaction, check-then-insert race)

- **파일**: `packages/backend/src/routes/character-mutation.ts` :48-146
- **설명**: POST /character/xp does NOT run inside a write transaction. The client_nonce idempotency is implemented as a non-atomic read-then-write: it SELECTs character_xp_logs for the nonce (lines 48-75), and only much later INSERTs the log row (lines 137-146). Between those two statements the character row is mutated with the granted XP/affection/streak via a bare UPDATE (lines 121-134). Two concurrent requests carrying the SAME client_nonce both see zero rows in the dedup SELECT, both apply the character UPDATE (double XP/affection/level), then both attempt the log INSERT. The unique index idx_character_xp_logs_nonce on (character_id, client_nonce) (migrations.ts:380-382) makes the SECOND insert throw, returning HTTP 500 — but the second character UPDATE already committed, so XP was granted twice. The unique index gives a false sense of safety; it only deduplicates the log, not the XP mutation.
- **수정안**: Wrap the entire /xp handler body (dedup check, character UPDATE, log INSERT, milestone loop, stats update) in withWriteTransaction(db, ...). libSQL write transactions take a single-writer lock so the second concurrent request will serialize behind the first and its dedup SELECT will then see the committed log row. Additionally make the log INSERT the gating step (INSERT first; on unique-constraint failure, treat as duplicate and short-circuit) so the XP mutation can never run twice.


### [be-family-social-voucher] Streak milestone bonus XP (up to 2000) can be double-granted via concurrent /xp requests

- **파일**: `packages/backend/src/routes/character-mutation.ts` :148-189
- **설명**: The milestone-bonus loop reads streak_achievements to check whether the milestone was already awarded (lines 150-154, 'SELECT id FROM streak_achievements WHERE character_id=? AND milestone=?'), then if absent applies the bonus XP and INSERTs the achievement row (lines 165-179). With no surrounding transaction, two concurrent alarm_completed requests that both reach a milestone (e.g. streak hits 7/30/90) both read zero existing achievements and both add the bonus XP (100/500/2000) to the character before either inserts. The unique index idx_streak_achievements_unique on (character_id, milestone) (migrations.ts:415-416) makes only the second INSERT fail with 500, but both XP additions already landed via separate UPDATEs (lines 165-173). streak_bonus_* events are cap-exempt (xpRules.ts:35-39) so the daily cap does not contain the leak.
- **수정안**: Run the whole handler in a write transaction (same fix as the XP double-grant finding). The single-writer lock serializes the existence check + insert so the bonus is granted exactly once.


### [be-family-social-voucher] Family invite acceptance has TOCTOU seat-overflow — group can exceed max_members

- **파일**: `packages/backend/src/routes/family-invite.ts` :181-218
- **설명**: POST /family/invites/:code/accept runs WITHOUT a transaction. It checks the live member count (SELECT COUNT(*) ... lines 197-201), compares to max_members (line 202), then INSERTs the new plan_group_members row (lines 206-211). plan_group_members has only UNIQUE(plan_group_id, user_id) (migrations.ts:307) — there is no DB constraint enforcing max_members. Two (or N) distinct users redeeming different valid pending invite codes for the same near-full group concurrently each read memberCount < max and each insert, overflowing the seat cap and yielding extra free family-plan seats. Unlike the voucher path (voucher-redemption.ts wraps capacity check + insert in withWriteTransaction), this invite path has no serialization. The earlier creation-time check in POST /invites (member+pending<=max, lines 57-72) does not prevent concurrent accepts.
- **수정안**: Wrap the accept handler (count check, member insert, invite-status UPDATE) in withWriteTransaction so concurrent accepts serialize behind the single writer. Optionally re-verify count < max immediately before the insert inside the same transaction and fail with GROUP_FULL otherwise.


### [voice-file-lifecycle] Replacing an alarm's raw_audio_url via PATCH orphans the previous R2 recording

- **파일**: `packages/backend/src/routes/alarm-mutation.ts` :437-440
- **설명**: The alarm PATCH handler overwrites raw_audio_url unconditionally (updates.push('raw_audio_url = ?')) without reading or cleaning up the previous value. When a user re-records their alarm voice clip, the old r2://raw-alarms/... object is replaced in the row and becomes unreferenced. Because raw-alarms objects are not tracked in any table (see the alarm-source finding) and no .list()-based GC exists, the previous object leaks forever. The DELETE path (lines 505-513) correctly guards and enqueues raw audio for deletion, but the PATCH/replace path was not given the same treatment.
- **수정안**: In the PATCH handler, when body.raw_audio_url changes the stored value, first SELECT the current raw_audio_url; after the UPDATE, if the old r2:// value is no longer referenced by any alarm, enqueueExternalDeletion(db, 'r2_object', oldKey) — mirroring the DELETE handler logic.


### [voice-file-lifecycle] TTL cleanup of generated_audio_assets leaves messages.audio_url pointing at a deleted R2 object

- **파일**: `packages/backend/src/lib/audio-retention.ts` :189-207
- **설명**: cleanupExpiredAudio enqueues the R2 object for deletion and DELETEs the generated_audio_assets row after 30 days, but does not NULL the matching messages.audio_url. Each generated message stores audio_url = r2://generated-tts/... (tts.ts:911,927) and keeps that pointer indefinitely (messages have no TTL). After the 30-day TTL fires, the message row survives in the user's library with a dangling r2:// URL whose object has been deleted, so GET /tts/messages/:id/audio returns 404 MESSAGE_AUDIO_NOT_FOUND (tts.ts:1149-1154) for a message the UI still lists. Unlike the notes endpoint, which self-heals by nulling the column on a missing object (notes.ts:218-223), the messages path does not, so the broken pointer persists. Not a storage leak, but a correctness/UX bug: previously-saved library messages silently stop playing.
- **수정안**: When expiring a generated_audio_assets row, also run UPDATE messages SET audio_url = NULL WHERE id = <message_id> (or WHERE audio_url = 'r2://' || audio_object_key), and/or have GET /messages/:id/audio null the column on a missing object as notes.ts already does. Reconsider whether 30-day server retention should drop library messages at all.


### [be-refactor-opt] repeat_days JSON parse + alarm mode inference duplicated between cron and /tick row-mapping

- **파일**: `packages/backend/src/index.ts; packages/backend/src/routes/alarm-query.ts; packages/backend/src/routes/alarm-helpers.ts` :index.ts:280-298; alarm-query.ts:31-45; alarm-helpers.ts:27-52
- **설명**: The scheduled() cron handler (index.ts:280-298) maps DB rows into ScheduledAlarm by inlining its own repeat_days JSON.parse IIFE (285-292) and mode inference (`r.mode === 'sound-only' ? 'sound-only' : 'tts'`, 294). The GET /tick handler (alarm-query.ts:31-45) builds the identical ScheduledAlarm from the identical SELECT columns, but routes the parsing through normalizeAlarmRow (alarm-helpers.ts:27) — a third place that parses repeat_days and infers mode. Three implementations of the same row→ScheduledAlarm transform that must stay in lockstep (they query the same columns: id,user_id,target_user_id,time,repeat_days,is_active,mode,voice_profile_id,speaker_id,timezone).
- **수정안**: Add `rowToScheduledAlarm(row): ScheduledAlarm` (and/or `parseRepeatDays(raw): number[]`) in lib/scheduler.ts and call it from both index.ts:280 and alarm-query.ts:31. Removes the inline IIFE and the divergent mode-inference copies; one source of truth for the cron/tick contract.


### [android-ui-ux] Time-picker wheels use fixed-dp row height (72.dp) with sp text — digits clip at large system font scale

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmTimePicker.kt` :54, 98, 123-126
- **설명**: AlarmTimePickerCard hard-codes `itemHeight = 72.dp` and the wheel rows (DraggableTimeWheelColumn, AmPmWheelColumn) are clamped to `.height(itemHeight)` / `.height(itemHeight*3)` with `.clipToBounds()`. The digit glyphs inside are rendered with `MaterialTheme.typography.displayLarge` (~57sp, ~64sp line height) which DOES scale with the OS font-scale setting, while the dp row height does NOT. At the system 'large' font scale (~1.3x) the text line box (~83sp ≈ 83dp) exceeds the 72dp clipped row, so the top/bottom of the hour/minute digits get cut off on the single most important screen (alarm time set). There is no font-scale clamping anywhere (grep for fontScale/nonScaledSp returns nothing). Same pattern in AmPmWheelColumn.kt (hardcoded 38sp/32sp in 72dp rows — less severe but same class). The DraggableTimeWheelColumn.kt also relies on this (lines 102-105, 150-153, 171-174).
- **수정안**: Make the row height scale with text: derive itemHeight from the resolved line height (e.g. `with(density){ displayLargeLineHeight.toDp() } + verticalPadding`), or size the row with `Modifier.heightIn(min = 72.dp)` and remove `clipToBounds()` from the selected-row cell, or cap fontScale just for the wheel via a `LocalDensity` override. Test at Settings > Display > Font size = Largest before launch.


### [android-ui-ux] Swipe-to-delete is the only way to delete an alarm — inaccessible to TalkBack / motor-impaired users

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/ControlsAndPermissions.kt` :201-374 (AlarmRow / DeleteRevealButton)
- **설명**: AlarmRow reveals the delete action only via a horizontal `draggable` gesture; tapping the card opens the editor. The DeleteRevealButton is rendered behind the card and only becomes hittable after a successful drag. TalkBack users and users who cannot perform a precise horizontal swipe have no exposed affordance to delete an alarm from the list, and the row exposes no custom accessibility action. This is a Play Store accessibility gap for a core destructive operation.
- **수정안**: Add a custom accessibility action (`Modifier.semantics { customActions = listOf(CustomAccessibilityAction("알람 삭제", { onDeleteAlarm(); true })) }`) on the AlarmRow, or expose a delete entry in the alarm editor / a long-press menu. Verify the editor offers delete; if not, this is the only delete path.


### [android-correctness] No timezone/DST rescheduling — alarms fire at wrong wall-clock time after travel or DST change

- **파일**: `apps/android-native/app/src/main/AndroidManifest.xml` :67-76
- **설명**: Alarms persist an absolute fireAtMillis (AlarmEntity.fireAtMillis) computed once in the device's then-current timezone (AlarmTimeCalculator.nextFireAtMillis uses ZoneId.systemDefault()). BootCompletedReceiver only listens for BOOT_COMPLETED and MY_PACKAGE_REPLACED; there is no receiver for ACTION_TIMEZONE_CHANGED or ACTION_TIME_CHANGED (grep confirms zero references). reschedulePendingAlarms() only runs on boot and app-start. Consequently, if the user crosses a timezone or a DST transition occurs while the app is not opened, the stored fireAtMillis no longer maps to the intended local time and a 7:00 alarm fires up to an hour early/late (or at the old timezone's instant). For an alarm-clock app this is a serious correctness defect that users will perceive as 'the alarm went off at the wrong time'.
- **수정안**: Register a receiver for android.intent.action.TIMEZONE_CHANGED (and ideally TIME_SET) that calls a recompute-and-reschedule routine which recalculates fireAtMillis from hour/minute/repeatDaysMask in the new zone and re-arms every enabled alarm. Reuse reschedulePendingAlarms but force recomputation (currently it keeps fireAtMillis as-is when it is still in the future, so it must be extended to recompute non-repeating alarms too).


### [android-correctness] Dynamic/random-prompt voice refresh worker is never scheduled (dead code) — repeating dynamic alarms replay stale audio

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/sync/DynamicVoiceRefreshScheduler.kt` :21-46
- **설명**: DynamicVoiceRefreshScheduler.ensurePeriodic()/runOnce() enqueue DynamicVoiceRefreshWorker, which calls AlarmRepository.refreshDueDynamicAlarmTalks() to regenerate fresh TTS for repeating 'random prompt' voice alarms. However, grep shows ensurePeriodic/runOnce are never called from anywhere (not Application.onCreate, not MainViewModel.init, not BootCompletedReceiver). Only RemoteAlarmSyncScheduler is wired. As a result the worker is never enqueued, refreshDueDynamicAlarmTalks runs nowhere, and a repeating dynamic-voice alarm keeps replaying the audio prepared at creation time every day (shouldRefreshDynamicVoice would return true, but nothing invokes it). The advertised 'fresh daily message / weather / fortune' behavior silently does not happen in the background.
- **수정안**: Call DynamicVoiceRefreshScheduler.ensurePeriodic(this) in AlarmTalkApplication.onCreate (and runOnce on app start / boot when a session exists), mirroring the RemoteAlarmSyncScheduler wiring, or remove the feature if intentionally cut. Verify with a log that the worker actually runs.


### [android-correctness] reverseGeocode (Android 13+) never resumes on geocoder error — coroutine hangs

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/location/WeatherLocationProvider.kt` :74-81
- **설명**: On API 33+ the code uses geocoder.getFromLocation(lat, lon, 1) { addresses -> ... } supplying only the onGeocode callback of GeocodeListener. If geocoding fails, the framework invokes onError(...) (default no-op), so the suspendCancellableCoroutine continuation is never resumed and the coroutine suspends indefinitely until the surrounding scope is cancelled. This stalls the weather-location resolution used for dynamic prompts. Not a crash and gated by cancellation, but it can leak a hung coroutine and leave the dynamic-voice weather fetch silently pending.
- **수정안**: Pass an object implementing GeocodeListener with both onGeocode and onError, resuming the continuation (e.g., with ''/'' or null) in onError. Optionally add a withTimeoutOrNull around the reverse-geocode call.


### [android-refactor-opt] AlarmTalkApp is a 767-line God-composable reading ~25 ViewModel states at the top, forcing wide recomposition

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkApp.kt` :43-67 (state reads), 91-174 (permission logic), 438-765 (Scaffold + NavHost)
- **설명**: A single `AlarmTalkApp()` composable (767 lines) reads ~25 distinct ViewModel `State`-backed properties directly in its body (lines 43-67: alarms, message, authSession, authBusy, syncBusy, voiceProfiles, voiceProfileBusy, socialBusy, familyGroup, familyVoices, characterEvents, characterBusy, characterResponse, billingBusy, subscriptionResponse, vouchers, noteBusy, receivedNotes, themeMode, etc.). Because all of these are read in the same composable scope, ANY single state change (e.g. `billingBusy` flipping, a `message` snackbar, a sync busy toggle) recomposes the entire `AlarmTalkApp` body, which re-evaluates the whole `Scaffold`/`NavHost` and re-passes ~70 parameters to the active `AlarmListScreen`. The function also inlines the entire permission state machine (lines 91-174), Google sign-in handling (305-341), and all NavHost wiring. This is the single largest maintainability and recomposition-altitude problem in the UI layer.
- **수정안**: Hoist cohesive slices into dedicated holders/composables: (1) extract the permission flow (missingRuntimePermissions/nextSettingsPermissionTarget/openPermissionSettings/requestPermission/bulk flow + its LaunchedEffect) into a `rememberPermissionFlowController()`; (2) wrap the per-tab refresh throttle LaunchedEffect (259-303) into its own effect-only composable; (3) give each NavHost screen a small state-class param instead of ~70 individual args. At minimum, read volatile states (message, *Busy flags) inside the narrowest child that needs them rather than at the top, so a busy-flag toggle doesn't recompose the NavHost.


---

## 심각도: LOW


### [be-auth-billing] AUTH 401 path logs token error detail and client-id presence to console

- **파일**: `packages/backend/src/middleware/auth.ts` :164-173
- **설명**: On any verification failure the middleware does `console.log('[AUTH 401]', code, '|', message, '| GOOGLE_CLIENT_ID set:', !!c.env.GOOGLE_CLIENT_ID)`. The error message can include token-format/issuer/audience detail derived from attacker-supplied tokens, and the same raw message is returned to the client in the 401 body (line 173). This is inconsistent with the rest of the codebase which uses logStructured and deliberately avoids logging PII (see the comment at auth.ts:142-143). Verbose auth-error reflection aids token-forgery probing and leaks server config state into logs.
- **수정안**: Replace the console.log with logStructured at warn level without echoing attacker-controlled token contents, drop the GOOGLE_CLIENT_ID-set hint, and return a generic error string to the client (keep only the stable error_code).


### [be-auth-billing] Apple transaction JWS payload is decoded without verifying the signature chain

- **파일**: `packages/backend/src/routes/billing-apple.ts` :113-122, 141-149
- **설명**: decodeJwsPayload (lines 113-122) base64-decodes the signedTransactionInfo JWS payload without verifying its x5c certificate chain back to Apple's root. The code relies entirely on the response having been fetched over TLS directly from api.storekit.itunes.apple.com (comment line 113). That is acceptable only as long as the only data source is that exact TLS endpoint and the response envelope is otherwise trusted. It is fragile: any future reuse of decodeJwsPayload on client-supplied JWS (e.g. accepting a JWSTransaction from the app, or an S2S notification body) would accept a forged transaction because no signature is checked. Apple's guidance is to verify the JWS signature even for Server API responses.
- **수정안**: Verify the JWS signature and x5c chain (to Apple's G3 root) before trusting bundleId/productId/expiresDate, so the verification is sound independent of where the JWS originates and is safe to reuse for future S2S notifications.


### [be-auth-billing] Privileged test-code issuance is gated only by a JWT email claim, defaulting to a hardcoded personal Gmail

- **파일**: `packages/backend/src/routes/billing-mutation.ts` :106-118, 324-327
- **설명**: /billing/test-codes mints real paid invite/gift vouchers (up to 50 per call, up to 365-day expiry) and authorizes the caller solely by comparing c.get('userEmail') against TEST_CODE_ISSUER_EMAILS, which defaults to the hardcoded 'gyuwon05@gmail.com' when the env var is unset (line 107). userEmail is populated from the bearer token's email claim (auth.ts:82), including Google/Apple ID tokens. Anyone who controls the Google/Apple account for that email (or any address present in the allowlist) can issue unlimited free paid-plan vouchers. Email-claim-based authorization is weaker than a server-side role flag and the production default should not be a personal address.
- **수정안**: Authorize privileged billing actions via a users.role/is_admin column checked server-side rather than a token email claim, remove the hardcoded personal-email default (fail closed if the allowlist is unset in production), and disable /test-codes entirely when ENVIRONMENT==='production'.


### [be-auth-billing] Stub checkout/change-plan can grant paid plans with zero payment if BILLING_STUB_ENABLED is set in production

- **파일**: `packages/backend/src/routes/billing-mutation.ts` :93-97, 233-322, 614-617
- **설명**: /billing/checkout and /billing/change-plan create fully active paid subscriptions (and family plan groups + invite vouchers) with no payment verification whenever isBillingStubEnabled returns true. isBillingStubEnabled (lines 93-97) is true in any non-production environment and also true in production if BILLING_STUB_ENABLED is '1' or 'true'. A single misconfigured production env var therefore turns /checkout into a free-Plus/Family dispenser. There is no secondary guard (e.g. requiring a real provider confirm) behind these routes.
- **수정안**: Before launch, hard-fail these stub routes in production unconditionally (assert ENVIRONMENT!=='production' regardless of BILLING_STUB_ENABLED) or remove the stub paths from the production build, and verify BILLING_STUB_ENABLED is unset in the production Worker config.


### [be-alarm-tts-voice] POST /voice/diarize reads the full audio buffer before the paid-plan check, allowing unauthenticated-cost reads

- **파일**: `packages/backend/src/routes/voice-upload.ts` :339-358
- **설명**: In POST /voice/diarize the handler parses formData and calls `await audioFile.arrayBuffer()` (line 347) BEFORE checking hasPaidVoiceAccess (line 349). There is also no MIME-type check and no byte-size cap on this endpoint at all (unlike /upload and /uploads/:id/separate). A free-plan or abusive caller can repeatedly POST large bodies; the Worker buffers the entire payload into memory before the plan gate rejects it, and there is no upper bound on the file size that reaches diarize when the caller IS paid. This wastes Worker memory/CPU on requests that will be rejected and exposes the diarize path (a paid ElevenLabs scribe_v2 call) to oversized inputs.
- **수정안**: Move the hasPaidVoiceAccess check before reading the buffer, and add MIME + byte-size validation matching /upload (audio/* only, <=25 MiB). Reject early to avoid buffering rejected payloads and to bound the size sent to the paid diarize provider.


### [be-alarm-tts-voice] ElevenLabs failures throw raw upstream error text back to the client (HTTP 500 detail leak)

- **파일**: `packages/backend/src/lib/elevenlabs.ts` :46-51, 80-86, 163-166
- **설명**: Every ElevenLabsClient method throws `new Error(\`ElevenLabs API error ${status}: ${errorBody}\`)` where errorBody is the raw upstream response text. In /tts/generate the final catch returns `detail: err.message` (tts.ts:1036) in a 500 response; voice-profile clone returns `detail` (voice-profile.ts:752,772,782); voice-upload diarize returns `detail` (voice-upload.ts:228,373). The raw ElevenLabs error body can contain provider-internal identifiers, account/quota messaging, model names, and request context that should not be surfaced to end users at launch. It also conflates client-fixable vs internal errors under a generic 500.
- **수정안**: Map known provider error classes to stable error_codes and a user-safe message; log the raw upstream body server-side only (it is already console.error'd at tts.ts:1001). Do not echo `detail` from upstream provider errors in production responses.


### [be-alarm-tts-voice] Voice profile DELETE calls ElevenLabs with a possibly-empty API key and swallows all errors

- **파일**: `packages/backend/src/routes/voice-profile.ts` :910-917
- **설명**: On voice profile delete, `new ElevenLabsClient(c.env.ELEVENLABS_API_KEY)` is constructed and deleteVoice() is called inside a try/catch that silently swallows ANY error (the catch body is empty, line 915-917). If ELEVENLABS_API_KEY is unset/rotated, or the provider returns a transient 5xx, the cloned voice is NEVER removed from the ElevenLabs account, but the local row is soft-deleted regardless. Because cloned voices consume a finite ElevenLabs voice-slot quota (the code even handles VOICE_SLOT_EXHAUSTED on create, lines 767-776), orphaned remote voices accumulate and will eventually exhaust the paid quota, blocking all new clones for every user. There is no retry queue or deletion-pending marker for the remote voice (unlike R2 objects, which DO get enqueued for external deletion in alarm-mutation.ts:505-513).
- **수정안**: On deleteVoice failure, enqueue the elevenlabs_voice_id for retried external deletion (mirroring enqueueExternalDeletion used for R2), and at minimum log the failure via logRouteError so orphaned provider voices can be reconciled before they exhaust the clone quota at launch.


### [be-alarm-tts-voice] createSynthesisAttempts always uses output_format 'mp3' but never requests it from ElevenLabs, relying on the default

- **파일**: `packages/backend/src/lib/elevenlabs.ts` :89-134
- **설명**: voice-provider.ts hardcodes outputFormat:'mp3' and mimeType:'audio/mpeg' (lines 99,113-116) and the cache key is computed with outputFormat 'mp3' (tts.ts:846). But ElevenLabsClient.textToSpeech never sends an output_format query param / body field to the API; it only sets Accept: audio/mpeg (elevenlabs.ts:128) and trusts the provider default. If ElevenLabs changes its default sample rate/bitrate for eleven_v3, the stored bytes silently change format/quality while the cache key, audio_format column, and mimeType all still claim 'mp3' at the old assumptions. The cached object would then be served with a stale/incorrect format descriptor. This is fragile for a launch that caches audio long-term.
- **수정안**: Explicitly pass `output_format` (e.g. mp3_44100_128) to the ElevenLabs TTS request and include the exact format string in the cache key, so the persisted audio format is pinned and self-consistent with the audio_format / mime_type columns and the cache identity.


### [be-family-social-voucher] /xp endpoint is fully client-authoritative — XP/affection/streak can be farmed for arbitrary entitlements

- **파일**: `packages/backend/src/routes/character-mutation.ts` :24-44
- **설명**: POST /character/xp accepts the reward event verbatim from the request body with no server-side proof the event occurred. A client can POST {event:'friend_invited'} (50 XP, xpRules.ts:19) or {event:'alarm_completed'} repeatedly with fresh client_nonce values to farm XP up to the 200 daily cap, and can pass an attacker-chosen local_date to manufacture consecutive-day streaks (computeStreak only compares the client-supplied local_date to the stored last_wakeup_date — streak.ts:15-36). No alarm/friendship/family record is consulted to corroborate the event. Whether this is monetarily exploitable depends on whether character level/stage gates any paid feature or cosmetic; at minimum it corrupts leaderboards/achievements and trivializes milestone rewards.
- **수정안**: Server-derive the event from durable state instead of trusting the body: for alarm_completed, require and verify an alarm/occurrence id owned by the user; for friend_invited, grant on the friendship-accept path server-side rather than via a client-declared event; clamp/validate local_date against server time (reject future dates and dates far from server 'today'). At minimum, rate-limit per event type.


### [be-family-social-voucher] Gift accept is non-transactional with no pending-guard on UPDATE — duplicate library copies on concurrent accept

- **파일**: `packages/backend/src/routes/gift.ts` :188-207
- **설명**: PATCH /gift/:id/accept SELECTs the gift with status='pending' (lines 189-192), then UPDATEs status to 'accepted' WITHOUT an 'AND status=\'pending\'' guard (lines 198-201), then INSERTs into message_library (lines 203-207) — all outside a transaction. message_library has no unique constraint on (user_id, message_id) (migrations.ts:78-84). Two concurrent accept requests for the same pending gift both pass the SELECT and both INSERT a library row, so the recipient gets the gifted message duplicated in their library. Because rowsAffected of the unguarded UPDATE is not checked, a re-accept after the status already changed still proceeds to insert another library copy. Low monetary impact but a data-integrity/duplication bug at launch.
- **수정안**: Wrap in withWriteTransaction; make the UPDATE conditional (UPDATE gifts SET status='accepted' WHERE id=? AND status='pending') and only insert into message_library when rowsAffected===1. Add a UNIQUE(user_id, message_id) index on message_library (with INSERT OR IGNORE) to make library inserts idempotent.


### [voice-file-lifecycle] TTL preservation guard references a raw_audio_url relationship that no code path ever creates

- **파일**: `packages/backend/src/lib/audio-retention.ts` :192-196
- **설명**: cleanupExpiredAudio skips expiring a generated_audio_assets row when NOT EXISTS (SELECT 1 FROM alarms a WHERE a.raw_audio_url = 'r2://' || g.audio_object_key). This guard is dead: generated TTS objects use keys of the form generated-tts/{user}/{hash}.mp3 (audio-cache.ts:32-35), whereas alarms.raw_audio_url only ever holds raw-alarms/{user}/{uuid} keys uploaded via /alarm/source (alarm-source.ts:87). Alarms reference TTS audio indirectly through message_id, never by putting a generated-tts key into raw_audio_url. So the join condition can never match and the comment ('alarm raw_audio_url referencing object is preserved') is misleading. The practical risk is the opposite of a leak: a generated-tts object that IS still referenced by a live message is deleted at 30 days regardless (the guard does not check messages.audio_url), producing the dangling pointer described in the related finding.
- **수정안**: Replace the alarms.raw_audio_url guard with a check against the actual consumer of generated TTS objects: NOT EXISTS (SELECT 1 FROM messages m WHERE m.audio_url = 'r2://' || g.audio_object_key) — so an object still backing a saved message is not deleted out from under it — or accept deletion and null the message pointer (see related finding).


### [be-refactor-opt] Four duplicate resolveUserPk implementations (same SELECT id FROM users WHERE google_id=?)

- **파일**: `packages/backend/src/lib/family-helpers.ts; packages/backend/src/routes/billing-helpers.ts; packages/backend/src/routes/character-helpers.ts; packages/backend/src/routes/notes.ts` :family-helpers.ts:3-12; billing-helpers.ts:43-52; character-helpers.ts:34-43; notes.ts:9-18
- **설명**: The exact same helper that resolves a google sub to users.id is defined four separate times. character-helpers.ts:34 and notes.ts:9 are byte-for-byte copies of lib/family-helpers.ts:3 (both `(db, googleId) => SELECT id FROM users WHERE google_id = ?`). billing-helpers.ts:43 is a fourth copy that only differs by taking a Hono Context instead of (db, userId). This is pure copy-paste with no behavioral difference.
- **수정안**: Keep one canonical `resolveUserPk(db, googleId)` in lib/family-helpers.ts. Delete the copies in character-helpers.ts and notes.ts and import from there. Replace billing-helpers.ts:resolveUserPk with a thin `resolveUserPk(c) = resolveUserPk(getDB(c.env), c.get('userId'))` wrapper (or have billing routes call the lib version directly). Removes ~30 lines and a divergence risk.


### [be-refactor-opt] resolveUserPk re-queries users table even though auth middleware already put users.id in context (userIdPK)

- **파일**: `packages/backend/src/routes/family-group.ts; packages/backend/src/routes/family-invite.ts; packages/backend/src/routes/notes.ts; packages/backend/src/routes/character-mutation.ts; packages/backend/src/routes/character-query.ts; packages/backend/src/routes/family-alarm.ts` :family-group.ts:21,109,156,224; family-invite.ts:24,102,140,241; notes.ts:24,91,142,193,241; family-alarm.ts:71,270
- **설명**: authMiddleware already resolves the user row and stores users.id in c.set('userIdPK') (auth.ts:121, query `WHERE google_id=? OR apple_id=? OR id=?`). Yet ~20 handlers call `await resolveUserPk(db, userId)` unconditionally, issuing a second `SELECT id FROM users WHERE google_id=?` round-trip per request that returns the value already sitting in context. libSQL/Turso is a remote DB so each call is a network round-trip on the request hot path.
- **수정안**: Add a shared `getUserPk(c): string` that returns `c.get('userIdPK')` (falling back to a query only if unset) and use it in all family-*/notes/character handlers. Eliminates one remote DB round-trip per request for the most-used routes; standardizes the userIdPK-vs-requery inconsistency that already exists across the codebase.


### [be-refactor-opt] ownerIds/viewerIds tuple (userPk + userId) is reconstructed inline in 6+ handlers

- **파일**: `packages/backend/src/routes/alarm-mutation.ts; packages/backend/src/routes/tts.ts; packages/backend/src/routes/alarm-query.ts; packages/backend/src/routes/voice-profile.ts` :alarm-mutation.ts:90-93; tts.ts:514-517,1044-1046,1093-1095,1170-1172; alarm-query.ts:10-12; voice-profile.ts:68-72,87-89
- **설명**: The same 3-4 line preamble `const userId=c.get('userId'); const userPk=c.get('userIdPK')||userId; const ownerIds=[userPk,userId]` is copy-pasted in at least six handlers, and the dedup variant `Array.from(new Set([pk||sub, sub]))` is independently re-implemented as `viewerIds()` in alarm-query.ts:10 and `ownerIds()` in voice-profile.ts:68 with subtly different semantics (tuple-with-dupes vs Set-deduped).
- **수정안**: Add one shared helper, e.g. `ownerIds(c): string[]` in a lib (returning the Set-deduped form) and use it everywhere. Replace the inline tuples and the two local helpers. Removes ~20 lines and unifies the dedup behavior so owner-check WHERE clauses are consistent.


### [be-refactor-opt] 199 inline c.json({error, error_code}, status) calls with no shared error helper

- **파일**: `packages/backend/src/routes (all)` :e.g. alarm-mutation.ts:113,129,267; alarm-query.ts:124,140; billing-mutation.ts (23 occurrences)
- **설명**: Error responses are hand-written as `return c.json({ error: '...', error_code: '...' }, NNN)` in 199 places across 22 route files. There is no shared `apiError(c, status, code, message)` helper (confirmed: no errorResponse/jsonError/fail export exists). This bloats handlers, makes the error envelope easy to get inconsistent (some responses use `warning`/`message` keys instead, e.g. tts.ts:1187-1195), and any future change to the error shape requires touching ~200 call sites.
- **수정안**: Introduce `apiError(c, status: ContentfulStatusCode, code: string, message: string)` returning `c.json({ error: message, error_code: code }, status)` and migrate call sites. Centralizes the envelope, shrinks handlers, and lets you add Sentry tagging / localization in one place.


### [be-refactor-opt] Two family-alarm POST handlers duplicate ~60 lines of recipient validation

- **파일**: `packages/backend/src/routes/family-alarm.ts` :38-110 (POST /alarms) vs 222-312 (POST /alarms/voice)
- **설명**: POST /alarms and POST /alarms/voice repeat an almost identical preamble: recipient_user_id presence/trim, wake_at HH:mm regex check, resolveUserPk(sender), self-alarm check, assertSameGroup check, recipient SELECT (identical column list across both), allow_family_alarms check, normalizeRepeatDays, and isBlockedByFamilyAlarmQuietTime check. Roughly 60 lines are duplicated verbatim with identical error codes (RECIPIENT_REQUIRED, INVALID_WAKE_AT, USER_NOT_FOUND, SELF_ALARM, NOT_SAME_GROUP, RECIPIENT_NOT_FOUND, FAMILY_ALARM_DISABLED, FAMILY_ALARM_QUIET_TIME).
- **수정안**: Extract `async function resolveFamilyAlarmTarget(db, senderUserId, body): Promise<{ ok:true; senderPk; recipient; recipientSettings; repeatDays; wakeAt } | { ok:false; status; body }>` and call it at the top of both handlers. Cuts ~60 duplicated lines and guarantees the two endpoints enforce identical recipient rules.


### [be-refactor-opt] tts.ts is 1337 lines with the /generate handler ~530 lines of mixed routing + business logic

- **파일**: `packages/backend/src/routes/tts.ts` :513-1042 (POST /generate); whole file 1-1337
- **설명**: tts.ts is the largest backend file (1337 lines) but holds only 6 routes; the POST /generate handler alone spans ~530 lines (513-1042) and interleaves request-body normalization (a ~40-field snake_case/camelCase dual-key body type at 520-560), plan/quota logic, voice-profile resolution, dynamic-prompt/weather/relationship lookups, synthesis attempts, and caching. The file also carries many standalone helper functions (geocoding, preset picking, relationship-label resolution) that are not route-specific.
- **수정안**: Split into tts-generate.ts (the /generate handler), tts-messages.ts (messages list/audio/delete), and move pure helpers (weather/geocode, preset pick, relationship-label/listener-title resolution, body-key normalization) into lib/tts-generation.ts. Improves reviewability and lets the dual-key body normalization be unit-tested in isolation.


### [be-refactor-opt] Cron fans out alarm pushes sequentially (await sendAlarmPush in a loop)

- **파일**: `packages/backend/src/index.ts` :310-313
- **설명**: The scheduled() handler sends pushes for all firing alarms with `for (const alarm of firing) { await sendAlarmPush(...) }`. Each sendAlarmPush (fcm.ts:162) does a getTokensForUser DB query plus a sequential per-token FCM fetch, and the outer loop serializes every user. With many alarms firing in the same 5-minute window this latency stacks linearly and risks bumping the Workers subrequest/time budget, delaying later pushes. (The Google OAuth token itself is module-cached, so that part is fine.)
- **수정안**: Batch the token lookup (single `SELECT user_id, token FROM push_tokens WHERE user_id IN (...)` for all firing target users) and dispatch FCM sends with bounded concurrency (e.g. Promise.all over chunks). Cuts wall-clock for multi-alarm ticks and reduces the chance of hitting Worker limits at scale.


### [be-refactor-opt] Per-request inline TTS daily-limit map rebuilt on every /generate call

- **파일**: `packages/backend/src/routes/tts.ts` :649
- **설명**: Inside the hot POST /generate handler, the plan→limit table `const limits: Record<string, number> = { free: 3, plus: 9999, family: 9999 }` is reallocated on every request. Minor, but it sits on the busiest endpoint and the magic numbers (free=3, others effectively unlimited) are also implicitly duplicated by the daily-quota concept elsewhere.
- **수정안**: Hoist to a module-level `const TTS_DAILY_LIMITS = { free: 3, plus: 9999, family: 9999 } as const;` (and consider deriving 'unlimited' from a sentinel). Trivial allocation win and a single place to tune quotas.


### [be-refactor-opt] isValidUUID is an unused export (all callers use UUID_RE.test directly)

- **파일**: `packages/backend/src/lib/validate.ts` :3-5
- **설명**: validate.ts exports both UUID_RE and isValidUUID, but no production code calls isValidUUID — every route imports UUID_RE and calls UUID_RE.test(...) directly. The only reference to isValidUUID is its own unit test. It is effectively dead surface area.
- **수정안**: Either delete isValidUUID (and its test) and standardize on UUID_RE.test, or, conversely, make isValidUUID the single public API and stop exporting the raw regex. Pick one to remove the redundant validation surface.


### [android-ui-ux] Coach-mark / usage-guide cards have no maxWidth — stretch full-bleed on tablets, foldables, large screens

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/guide/CoachMarkOverlay.kt` :212-215 (CoachMarkOverlay), UsageGuideOverlay.kt 74-77
- **설명**: Both first-run guide surfaces (CoachMarkCard in CoachMarkOverlay and the carousel card in UsageGuideOverlay) are laid out with `Modifier.fillMaxWidth().padding(horizontal = 20.dp/28.dp)` and NO `widthIn(max = …)`. On a tablet/foldable/large display the tip card stretches edge-to-edge (minus 20-28dp), producing very long line lengths and an unbalanced look on the exact screens the founder is worried about. The app already knows the right pattern — PlanGateDialog.kt L41 uses `.widthIn(max = 380.dp)` — but the coach marks don't follow it.
- **수정안**: Add `.widthIn(max = 420.dp)` (and center with `Alignment.TopCenter`/horizontal arrangement) to the Surface in CoachMarkCard (CoachMarkOverlay.kt ~L213) and to the Surface in UsageGuideOverlay (~L75), matching PlanGateDialog. Cheap, high-visibility polish.


### [android-ui-ux] AlarmRow label has no maxLines/ellipsis — long alarm names wrap and distort the list item

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/ControlsAndPermissions.kt` :293-302
- **설명**: In AlarmRow the `alarm.label` Text has no `maxLines`/`overflow`. The hero/quick cards (HomeCards.kt) and voice rows correctly cap with `maxLines = 1, overflow = Ellipsis`, but the primary alarm list item does not, so a long user-entered label wraps to multiple lines and unevenly grows the row next to the toggle. The time Text above it is also uncapped (less risky since it is fixed-format HH:MM).
- **수정안**: Add `maxLines = 1, overflow = TextOverflow.Ellipsis` to the label Text (and ideally wrap the Column in `Modifier.weight(1f)` so it doesn't push the switch). Mirror the treatment already used in HomeCards.kt L116-117.


### [android-ui-ux] Onboarding copy uses hardcoded \n line breaks — breaks awkwardly at large font scale / different widths

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/onboarding/OnboardingScreen.kt` :49, 54, 59
- **설명**: Onboarding page descriptions embed manual `\n` newlines (e.g. "녹음하거나 만든 목소리로\n내 알람을 울릴 수 있어요."). With a forced break plus natural wrapping at large font scale or narrow widths, lines can become lopsided or a single word can orphan to a third line, producing ragged centered text on the first screen new users see. LandingScreen.kt L127 has the same manual-break pattern.
- **수정안**: Drop the manual `\n` and let `textAlign = Center` wrap naturally (the Column already has horizontal padding), or move strings to strings.xml so copy/wrapping can be tuned without code. If a controlled break is essential, verify it at Largest font scale.


### [android-ui-ux] User-facing strings are hardcoded in Kotlin rather than strings.xml — no localization / RTL readiness

- **파일**: `apps/android-native/app/src/main/res/values/strings.xml` :1-7
- **설명**: strings.xml contains only app_name and two notification strings; every screen label, button, dialog title/body and coach-mark copy is hardcoded Korean inline (e.g. CoachMarkOverlay.kt L231 "가이드 N / M", AlarmListScreen.kt L55-72 guide copy, PermissionGate.kt L166-185). With no string resources there is no path to localization and no automatic RTL/bidi handling; a Play launch limited to Korean is fine short-term, but it blocks any future locale and means accessibility scanners can't pull labels from resources.
- **수정안**: If a single-locale launch is intentional, document it as a deliberate scope decision. Otherwise begin extracting user-facing strings into strings.xml so they can be translated and so RTL layouts (start/end paddings are already used in most places) render correctly.


### [android-refactor-opt] Audio base64 payloads decoded on the main thread before entering Dispatchers.IO (UI jank on every preview/clip tap)

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/voices/VoiceProfileManagementPanel.kt, apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmEditorScreen.kt` :VoiceProfileManagementPanel.kt:333, 578, 730; AlarmEditorScreen.kt:433, 471, 500, 774
- **설명**: All audio preview/selection flows download a base64-encoded clip and decode it with `Base64.decode(response.audioBase64, Base64.DEFAULT)` while running on `scope = rememberCoroutineScope()` (Main dispatcher). The decode is performed OUTSIDE the subsequent `withContext(Dispatchers.IO){ audioStore.cacheGeneratedAudio(...) }` block — i.e. the CPU-bound base64 decode of a 1-2 minute voice clip (hundreds of KB to several MB) runs on the UI thread, then the already-decoded bytes are handed to IO. Evidence: VoiceProfileManagementPanel.kt line 333 `val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)` sits between the `onDownloadStockAudio(...)` call (332) and `withContext(Dispatchers.IO)` (334); identical ordering at lines 578 and 730, and at AlarmEditorScreen.kt 471, 500, 774. `scope` is `rememberCoroutineScope()` at VoiceProfileManagementPanel.kt:248 and AlarmEditorScreen.kt:164, which dispatches on Main. This causes a visible frame hitch each time a user taps a stock voice greeting or stock clip preview — a core, frequently-used flow at launch.
- **수정안**: Move the `Base64.decode(...)` call inside the existing `withContext(Dispatchers.IO){ ... }` block (or wrap it in its own `withContext(Dispatchers.Default)`), so only the resulting `CachedAlarmAudio` crosses back to Main. Better, push the decode+cache entirely into AlarmAudioStore by adding a `cacheGeneratedAudioFromBase64(base64, format, ...)` helper that decodes on IO, and call that from all 7 sites to remove the duplicated decode logic at once.


### [android-refactor-opt] AlarmListScreen is a single 70-parameter mega-dispatcher for 7 unrelated tab screens with inline lambdas allocated every composition

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/alarms/AlarmListScreen.kt` :76-141 (signature), 195-381 (when(selectedTab) body); call site AlarmTalkApp.kt:529-627
- **설명**: `AlarmListScreen` takes ~70 parameters (lines 77-140) and contains a `when (selectedTab)` (line 195) that renders 7 completely different screens (Home, Voices, Alarms, People, Messages, Growth, Billing) in one function. Every tab gets the full 70-arg surface even though e.g. the Billing tab needs none of the voice/alarm callbacks. Worse, the call site in AlarmTalkApp.kt passes many freshly-allocated lambdas on each composition — e.g. line 559 `onPromoteDraftVoice = { profileId -> viewModel.promoteDraftVoice(profileId); viewModel.loadVoiceProfiles() }`, 566 `onDownloadStockAudio = { messageId -> ... }`, 569, 590-603 (onCreateAlarm/onCreateFamilyAlarm/onToggleEnabled), 611, 615-626 (profileMenu). Non-method-reference lambdas are new instances each recomposition, so even with K2 strong-skipping these params compare unequal and the screen cannot skip — guaranteeing a full re-render of the active tab whenever AlarmTalkApp recomposes.
- **수정안**: Split into per-tab composables (HomeTab, VoicesTab, AlarmsTab, etc.) routed directly in the NavHost, each taking only the state/callbacks it uses. Group the remaining callbacks into a small stable `@Immutable` actions holder (e.g. AlarmScreenActions) created once with `remember`, and wrap multi-statement call-site lambdas in `remember { }` (or move them into the ViewModel) so they are stable across recompositions and let strong-skipping actually skip.


### [android-refactor-opt] DateTimeFormatter allocated per call in label utils (inconsistent with the codebase's own correct pattern)

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/util/PlatformAndLabelUtils.kt` :87, 95, 105, 119, 124
- **설명**: `formatFireTime` (87), `formatVoucherIssuedAt` (95), `formatNoteCreatedAt` (105) and `parseBackendTimestamp` (119, 124) each call `DateTimeFormatter.ofPattern(...)` on every invocation. `DateTimeFormatter` is immutable and thread-safe, so re-parsing the pattern string per call is pure waste. `parseBackendTimestamp` is the worst: it allocates up to three formatters per call, and it is invoked once per message timestamp via `formatNoteCreatedAt` while rendering message lists. The same module BillingCharacterPanel.kt already does this correctly with top-level vals (CharacterEventTimeFormatter/PassDateFormatter/PassShortDateFormatter at lines 409-416), so this is an internal inconsistency.
- **수정안**: Hoist all four patterns to top-level `private val` DateTimeFormatter constants (e.g. `private val FireTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")`) and reference them, mirroring BillingCharacterPanel.kt. Zero behavior change, removes repeated parsing in list rendering.


### [android-refactor-opt] Dead composables CountdownBanner and LegacyPanel are defined but never referenced

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/alarms/AlarmListComponents.kt` :71-100 (CountdownBanner), 134-151 (LegacyPanel)
- **설명**: `CountdownBanner(nextAlarm: AlarmEntity)` (lines 71-100) and `LegacyPanel(modifier, content)` (lines 134-151) are declared `internal fun` but a full-source search across apps/android-native/app/src/main finds no call sites other than their own definitions. They are dead code (the home screen now uses NextAlarmHeroCard instead of CountdownBanner). Dead UI code adds maintenance noise and ships unused bytecode.
- **수정안**: Delete both composables. If kept intentionally for future use, annotate and document; otherwise remove to keep AlarmListComponents.kt focused.


### [android-refactor-opt] LazyColumn items(sortedMembers) has no stable key — defeats item identity/animation and reuse

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/members/MemberManagementScreen.kt` :238
- **설명**: `items(sortedMembers) { member -> MemberRow(...) }` (line 238) omits the `key` parameter, so Compose falls back to positional keys. When the member list changes (a member is removed via `pendingRemoveMember`, or sort order shifts), Compose cannot match items to their prior composition state and animations/reuse degrade. The sibling alarm list does this correctly: AlarmListScreen.kt:284 `items(sortedAlarms, key = { it.id })`. Each member has a stable `member.userId`.
- **수정안**: Add a stable key: `items(sortedMembers, key = { it.userId }) { member -> ... }`, matching the alarm list pattern.


### [android-refactor-opt] voiceProfiles.filter{} and bottom-bar receivedNotes.count{} recomputed every recomposition (not remembered)

- **파일**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/voices/VoiceProfileManagementPanel.kt, apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkApp.kt` :VoiceProfileManagementPanel.kt:300-301; AlarmTalkApp.kt:446
- **설명**: In VoiceProfileManagementPanel the derived lists `systemVoices = voiceProfiles.filter { it.isSystem == true }` and `ownVoices = voiceProfiles.filter { it.isSystem != true }` (lines 300-301) are recomputed on every recomposition of this large, frequently-recomposing panel (see the 250ms waveform finding) instead of being wrapped in `remember(voiceProfiles)`. Similarly, AlarmTalkApp computes `unreadMessageCount = receivedNotes.count { it.readAt.isNullOrBlank() }` inline in the bottomBar lambda (line 446) on every Scaffold recomposition, whereas the analogous `unreadAlarmCount` is correctly memoized with `remember(alarms, ...)` at lines 71-76 — an inconsistency.
- **수정안**: Wrap the filters in `remember(voiceProfiles) { ... }` and the unread count in `remember(receivedNotes) { receivedNotes.count { it.readAt.isNullOrBlank() } }`, mirroring the already-memoized `unreadAlarmCount`. Cheap, removes per-frame list scans during recording and snackbar/busy-flag churn.


---

# 적용 현황 (이번 작업에서 처리)

## ✅ 수정 완료 + 검증됨

### 백엔드 (1360 테스트 통과, typecheck/lint clean)
- **음성파일 라이프사이클 전부 차단 (VF1~VF5)**
  - VF1: 메시지 삭제 시 R2 오브젝트 삭제 큐 적재 (`tts.ts`)
  - VF2: raw-alarms 업로드 추적 테이블(`raw_alarm_uploads`, migration 48) + 미연결 클립 TTL(2일) 정리 크론 + 계정삭제 정리 (`alarm-source.ts`, `audio-retention.ts`, `account-deletion.ts`)
  - VF3: 알람 PATCH 녹음 교체 시 이전 R2 정리 (`alarm-mutation.ts`)
  - VF4: TTL 정리 시 messages.audio_url 댕글링 포인터 NULL 처리 (`audio-retention.ts`)
  - VF5: dead TTL 가드 → 활성 알람(message_id 경유)이 쓰는 TTS 보존(30일 후 무음 버그 수정)
- **OAuth `email_verified` 강제** (Google+Apple) + Apple 클라이언트 이메일 fallback 제거 → 계정연동 탈취 차단 (`oauth.ts`, `auth.ts`)
- **TTS 일일한도 원자적 예약** — read-then-increment 레이스 차단 + 실패 시 슬롯 복구 (`tts.ts`)
- **스톡클립 message_id 알람 허용** — 무료플랜 스톡 알람 차단 버그 수정 (`alarm-mutation.ts`)
- **바우처 그룹 자동해체 방지 가드** — 소유 그룹에 멤버 있으면 차단 (`voucher-redemption.ts`)
- **화자분리 num_speakers 상한** — 1~3명 녹음 과분할 억제(정확도 개선) (`elevenlabs.ts`, `voice-upload.ts`)
- **크론 알람 푸시 병렬화** — 청크 단위 allSettled (`index.ts`)

### Android (assembleDevDebug 빌드 성공, 14건)
- FGS 발화 크래시 가드 + 풀스크린 알림 폴백 / Geocoder 행 수정 / 동적보이스 새로고침 스케줄링 / 시간대·DST 재스케줄 리시버
- 코치마크 maxWidth / 시간피커 폰트스케일 / AlarmRow 말줄임+접근가능 삭제 / 온보딩 \n 제거
- 데드코드 제거 / LazyColumn key / DateTimeFormatter 호이스팅 / base64 IO 디스패처 / filter remember

### 2차 배치 (가족/캐릭터 레이스 + auth)
- character /xp 논스 중복지급 차단(조건부 INSERT 예약), streak 마일스톤 중복 차단,
  가족초대 좌석 초과 TOCTOU(원자적 조건부 INSERT) (`character-mutation.ts`, `family-invite.ts`)
- auth 전용 엄격 레이트리밋(15/분, 별도 버킷)로 무차별 대입 방어 (`rateLimit.ts`, `index.ts`)

## ⏳ 남은 항목

> 이 리포트는 6/22 감사 시점의 스냅샷이다. 그 뒤 코드와 다시 대조해 **미해결로 남은 것만**
> [`docs/qa/launch-tracking.ko.md`](launch-tracking.ko.md) 한 곳에 모았다(읽기 편한 한국어 추적용).
> 출시 전 남은 작업은 그 문서를 단일 출처로 본다.

대조 후 추가로 해결 확인:
- `pending_deletion`은 fail-closed로 전환됨(이전 "의도적 보류" 메모는 무효).
- 캐릭터/성장 기능이 FE+BE에서 제거되면서 character `/xp` 관련 finding(클라 권위·논스 중복지급·streak 마일스톤 중복)은 전부 무효화됨.

여전히 남은 것(상세는 launch-tracking.ko.md):
- 음성 클론 업로드 바이트 상한, diarize 유료확인-선적재, 애플 결제 웹훅, 구글 nonce, RTDN 쿼리토큰, 애플 JWS 서명검증, 외부 클론 삭제 재시도, 제공자 오류 원문 반사, TTS 출력포맷 명시, 선물수락 트랜잭션, 이메일 코드 쿨다운.
- 저위험 리팩토링: resolveUserPk 중복 통합, ownerIds 헬퍼, 공통 에러 헬퍼, family-alarm 중복.
- 대형 구조 리팩토링(AlarmTalkApp God-composable 분할, AlarmListScreen 70-param 분할, strings.xml i18n): 출시 직전 리스크로 보류.
