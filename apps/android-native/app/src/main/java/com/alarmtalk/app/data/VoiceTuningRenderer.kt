package com.alarmtalk.app.data

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/**
 * 목소리 높이 보정(`VoiceTuning`)을 건 **사본 파일**(16-bit 모노 WAV)을 만든다.
 *
 * 높이 변환(`VoicePitchShifter`)은 재생 중에 걸 수 없는 처리라, 원래 클립을 한 번 디코딩해 사본을 굽고
 * 미리듣기·울림 모두 그 사본을 튼다 — 등록 때 들은 소리와 울리는 소리가 **같은 파일**이다.
 * 사본은 `noBackupFilesDir/voice_tuning` 에 (원본 경로·크기·수정 시각 + 높이) 이름으로 남겨 두고,
 * 같은 클립·같은 높이면 다시 굽지 않는다. 오래된 것부터 [MAX_FILES] 개 넘게는 지운다.
 *
 * ⚠ **사본도 사용자 목소리의 복사본이다** — 원본을 지우는 때 같이 지운다(스펙 §4-3). 사본은 캐시라
 * 통째로 지워도 잃는 것이 없다(다음 울림·미리듣기에서 다시 굽는다):
 *  - 목소리를 잃을 때(삭제·민감 동의 철회·접근 회수·교체·잠금 확정) — `AlarmRepository.deleteAudioNoAlarmUses`
 *    와 목소리 삭제·동의 철회 경로가 [clearAll] 을 부른다.
 *  - 명시적 로그아웃·탈퇴 — `MainViewModel.clearSignedInSession`.
 *  - 원본이 다른 이유(30일 캐시 정리 등)로 사라진 사본은 앱 시작 때 [pruneStale] 이 정리한다.
 *
 * ⚠ 디코딩·변환이 수백 ms 걸린다 — **메인 스레드에서 부르지 말 것.** 실패하면 null 이고, 부르는 쪽은
 * 원래 소리를 튼다(높이 보정이 알람을 막으면 안 된다).
 */
object VoiceTuningRenderer {
    private const val TAG = "VoiceTuningRenderer"
    private const val DIR = "voice_tuning"

    /** 알고리즘이 바뀌면 올린다 — 옛 사본을 다시 쓰지 않게 이름에 들어간다. */
    private const val VERSION = "psola1"
    private const val MAX_FILES = 200

    /** 이만큼 쓰이지 않은 사본은 앱 시작 때 지운다 — 음성 캐시 정리(`AlarmAudioStore.sweepStaleCache`)와 같은 30일. */
    private const val STALE_AFTER_MILLIS = 30L * 24 * 60 * 60 * 1000

    /** 쓰다 남은 임시 파일(굽다가 죽음)은 이만큼 지나면 지운다. */
    private const val TMP_STALE_AFTER_MILLIS = 60L * 60 * 1000
    private const val MAX_DURATION_MILLIS = 120_000L
    private const val WAV_HEADER_BYTES = 44

    /** [source] 에 [tuning] 을 건 사본의 `file://` Uri. 중립이거나 실패하면 null. */
    fun render(context: Context, source: Uri, tuning: VoiceTuning?): Uri? {
        val pitch = tuning?.normalized()?.pitchSemitones ?: return null
        if (pitch == 0f) return null
        return runCatching {
            val dir = File(context.noBackupFilesDir, DIR).apply { mkdirs() }
            val out = File(dir, "${cacheKey(source)}_${pitchTag(pitch)}.wav")
            if (out.length() > WAV_HEADER_BYTES) {
                out.setLastModified(System.currentTimeMillis())
                return@runCatching Uri.fromFile(out)
            }
            val started = System.nanoTime()
            val decoded = VoiceAudioDecoder.decodeMono(context, source, maxDurationMillis = MAX_DURATION_MILLIS)
                ?: error("decode failed")
            val shifted = VoicePitchShifter.shift(decoded.samples, decoded.sampleRate, pitch)
            // 임시 파일 이름은 굽기마다 다르다 — 미리듣기와 울림이 같은 사본을 동시에 구워도 서로의 반쪽 파일을
            // 덮지 않는다. 이름 바꾸기는 원자적이라 먼저 끝난 쪽이 놓고, 뒤에 끝난 쪽이 같은 내용으로 덮는다.
            val tmp = File(dir, "${out.name}.${java.util.UUID.randomUUID()}.tmp")
            writeWav(tmp, shifted, decoded.sampleRate)
            if (!tmp.renameTo(out)) {
                tmp.delete()
                error("rename failed")
            }
            Log.i(
                TAG,
                "Rendered pitch=$pitch st ${shifted.size / decoded.sampleRate.toFloat()}s " +
                    "in ${(System.nanoTime() - started) / 1_000_000}ms",
            )
            prune(dir)
            Uri.fromFile(out)
        }.onFailure { error ->
            Log.w(TAG, "Failed to render voice tuning pitch=$pitch", error)
        }.getOrNull()
    }

    /** [source] 로 구운 사본(모든 높이)만 지운다 — 버린 초안의 미리듣기 클립처럼 원본이 아직 있을 때. */
    fun deleteCopiesOf(context: Context, source: Uri) {
        runCatching {
            val prefix = "${cacheKey(source)}_"
            File(context.noBackupFilesDir, DIR).listFiles { f -> f.name.startsWith(prefix) }?.forEach { it.delete() }
        }.onFailure { Log.w(TAG, "Failed to delete voice tuning copies", it) }
    }

    /** 사본을 모두 지운다. 다시 필요하면 울릴 때·미리듣기 때 새로 굽는다. 메인 스레드에서 부르지 말 것. */
    fun clearAll(context: Context) {
        runCatching { File(context.noBackupFilesDir, DIR).deleteRecursively() }
            .onFailure { Log.w(TAG, "Failed to clear voice tuning copies", it) }
    }

    /** 오래 쓰이지 않은 사본과 남은 임시 파일을 지운다(앱 시작 — `AlarmTalkApplication`). */
    fun pruneStale(context: Context, nowMillis: Long = System.currentTimeMillis()) {
        val files = File(context.noBackupFilesDir, DIR).listFiles() ?: return
        files.filter { file ->
            val age = nowMillis - file.lastModified()
            if (file.name.endsWith(".tmp")) age > TMP_STALE_AFTER_MILLIS else age > STALE_AFTER_MILLIS
        }.forEach { it.delete() }
    }

    internal fun cacheKey(source: Uri): String {
        val file = source.takeIf { it.scheme == "file" || it.scheme == null }?.path?.let(::File)
        val identity = buildString {
            append(VERSION).append('|').append(source.toString())
            if (file != null) append('|').append(file.length()).append('|').append(file.lastModified())
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray())
        return digest.take(12).joinToString("") { "%02x".format(it) }
    }

    /** −3.5 → "m3_5", 2.0 → "p2_0" — 파일 이름에 점·부호를 넣지 않는다. */
    private fun pitchTag(pitch: Float): String {
        val sign = if (pitch < 0f) "m" else "p"
        val tenths = Math.round(kotlin.math.abs(pitch) * 10f)
        return "$sign${tenths / 10}_${tenths % 10}"
    }

    private fun writeWav(file: File, samples: FloatArray, sampleRate: Int) {
        val dataBytes = samples.size * 2
        val buffer = ByteBuffer.allocate(WAV_HEADER_BYTES + dataBytes).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray()).putInt(36 + dataBytes).put("WAVE".toByteArray())
        buffer.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
            .putInt(sampleRate).putInt(sampleRate * 2).putShort(2).putShort(16)
        buffer.put("data".toByteArray()).putInt(dataBytes)
        for (v in samples) buffer.putShort((v.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
        FileOutputStream(file).use { it.write(buffer.array()) }
    }

    private fun prune(dir: File) {
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".wav") } ?: return
        if (files.size <= MAX_FILES) return
        files.sortedBy { it.lastModified() }.take(files.size - MAX_FILES).forEach { it.delete() }
    }
}
