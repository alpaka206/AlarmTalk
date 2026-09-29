// 직접 입력의 글자 웃음 → `[laughs]`(`lib/typed-laughter.ts`). 스펙 `docs/spec/voice-and-message.md` §9.
//
// 근거(2026-09-29 v3·v4·v4 Turbo 비교, 받아쓰기): `ㅋㅋㅋ` 는 "크크크" 로 읽히거나 건너뛰었고, `www`·`(笑)`·`lol`
// 도 글자로 읽혔다. `[laughs]` 는 한국어에서 세 모델 모두 웃음소리가 났다.
import { describe, expect, it } from 'vitest';
import { LAUGH_TAG, typedLaughterToTags } from '../src/lib/typed-laughter';

describe('typedLaughterToTags — 글자 웃음을 소리 태그로', () => {
  it('한국어 자모 웃음(ㅋ·ㅎ 연속)을 [laughs] 로 바꾼다', () => {
    expect(typedLaughterToTags('일어나 ㅋㅋㅋ 벌써 8시야')).toBe('일어나 [laughs] 벌써 8시야');
    expect(typedLaughterToTags('좋은 아침 ㅎㅎ 물 한 잔 마시자')).toBe(
      '좋은 아침 [laughs] 물 한 잔 마시자',
    );
    expect(typedLaughterToTags('일어나ㅋㅋ벌써')).toBe('일어나 [laughs] 벌써');
    expect(typedLaughterToTags('ㅋㅎㅋㅎ 일어나')).toBe('[laughs] 일어나');
    expect(typedLaughterToTags('ㅋ 일어나')).toBe('[laughs] 일어나');
  });

  it('영어 haha·hehe·lol·lmao 를 바꾼다 — 대소문자 무관', () => {
    expect(typedLaughterToTags("haha wake up, lol it's 8 already")).toBe(
      "[laughs] wake up, [laughs] it's 8 already",
    );
    expect(typedLaughterToTags('Hahaha get up!')).toBe('[laughs] get up!');
    expect(typedLaughterToTags('ahaha hehe LOL lmfao up')).toBe('[laughs] up');
    expect(typedLaughterToTags('get up lmaooo')).toBe('get up [laughs]');
  });

  it('일본어 w·ｗ·(笑)·문장 끝 笑 를 바꾼다', () => {
    expect(typedLaughterToTags('おはよう www もう8時だよ')).toBe('おはよう [laughs] もう8時だよ');
    expect(typedLaughterToTags('起きて(笑)')).toBe('起きて [laughs]');
    expect(typedLaughterToTags('起きて（笑）')).toBe('起きて [laughs]');
    expect(typedLaughterToTags('起きて(爆笑)')).toBe('起きて [laughs]');
    // 가나 바로 뒤면 한 글자도 웃음이다.
    expect(typedLaughterToTags('もう8時だよw')).toBe('もう8時だよ [laughs]');
    expect(typedLaughterToTags('もう8時だよｗｗ')).toBe('もう8時だよ [laughs]');
    expect(typedLaughterToTags('もう8時だよ笑')).toBe('もう8時だよ [laughs]');
    expect(typedLaughterToTags('もう8時だよ笑。起きて')).toBe('もう8時だよ [laughs]。起きて');
  });

  it('붙어 있는 웃음은 한 번만 웃는다 — 사용자가 이미 친 [laughs] 옆의 ㅋㅋ 도', () => {
    expect(typedLaughterToTags('일어나 ㅋㅋ haha 늦었어')).toBe('일어나 [laughs] 늦었어');
    expect(typedLaughterToTags('[laughs] ㅋㅋ 일어나')).toBe('[laughs] 일어나');
  });

  it('문장부호 앞에는 공백을 남기지 않는다', () => {
    expect(typedLaughterToTags('좋아ㅋㅋ. 일어나!')).toBe('좋아 [laughs]. 일어나!');
    expect(typedLaughterToTags('Up haha!')).toBe('Up [laughs]!');
  });

  it('웃음이 없으면 한 글자도 바꾸지 않는다 — 이중 공백·줄바꿈까지 그대로(캐시 키가 바뀌면 안 된다)', () => {
    const text = '일어나  벌써\n8시야 ';
    expect(typedLaughterToTags(text)).toBe(text);
  });

  it('소리 나는 낱말·다른 자모와 붙은 ㅋㅎ·낱말 속 글자·주소는 건드리지 않는다', () => {
    for (const text of [
      '일어나 하하하 벌써 8시야', // 하하하는 이미 웃음으로 난다
      '호호 크크 히히',
      'ㅇㅋ 알겠어', // 오케이
      'ㅎㅇ 좋은 아침', // 하이
      'ㅎㄷㄷ 늦었다', // 후덜덜
      'ㅋㅋㅠㅠ 일어나기 싫다', // 웃음만이 아니다
      'Lolita, the lollipop is here', // 낱말 속 lol
      'aha, found it', // 깨달음의 aha
      'Time to work', // work 의 w
      'Check www.example.com today', // 주소
      'Visit lol.com or hahaha.net', // 주소 속 lol·haha
      'https://example.com/lol 에 들어가 봐', // 주소 경로
      'www.예시.한국 확인', // 한글 도메인
      'lol@example.com 으로 보내', // 메일 주소
      'example.com/lol 봐', // 스킴 없는 주소 경로
      'example.com/haha?x=1', // 스킴 없는 주소 경로
      '笑顔で起きよう', // 笑顔
      '微笑むあなたへ', // 微笑む
      'おはよう、苦笑', // 苦笑(앞이 한자)
      'w', // 한 글자 w 는 흔한 약어다
      'WW2 documentary', // 뒤에 숫자
    ]) {
      expect(typedLaughterToTags(text)).toBe(text);
    }
  });

  it('대괄호 안(사용자가 친 태그·대괄호 글)은 건드리지 않는다 — [ [laughs] ] 같은 깨진 지시를 만들지 않는다', () => {
    expect(typedLaughterToTags('[haha] Wake up')).toBe('[haha] Wake up');
    expect(typedLaughterToTags('[lol] Wake up lol')).toBe('[lol] Wake up [laughs]');
    expect(typedLaughterToTags('[after lunch ㅋㅋ] 일어나 ㅋㅋ')).toBe(
      '[after lunch ㅋㅋ] 일어나 [laughs]',
    );
    expect(typedLaughterToTags('[excited]ㅋㅋ 일어나')).toBe('[excited] [laughs] 일어나');
  });

  // Codex #830: 스킴 없는 IP 주소도 통째로 주소다 — 경로의 lol·haha 를 웃음으로 바꾸지 않는다.
  it('스킴 없는 IP 주소(IPv4·IPv6)와 그 경로는 건드리지 않는다 — 주소 밖의 웃음은 바꾼다', () => {
    for (const text of ['192.168.0.1/lol', '127.0.0.1:8080/haha', '[::1]/lol', '[::1]:8080/haha?x=lol']) {
      expect(typedLaughterToTags(text)).toBe(text);
    }
    expect(typedLaughterToTags('192.168.0.1/lol 들어가 봐 ㅋㅋ')).toBe('192.168.0.1/lol 들어가 봐 [laughs]');
    expect(typedLaughterToTags('버전 1.2.3.4 나왔어 lol')).toBe('버전 1.2.3.4 나왔어 [laughs]');
    // 콜론이 없는 대괄호는 IPv6 가 아니다 — 사용자가 친 태그로 그대로 두고 뒤의 웃음은 바꾼다.
    expect(typedLaughterToTags('[face] lol')).toBe('[face] [laughs]');
  });

  it('스킴 없는 도메인은 라틴 글자로만 본다 — 띄어 쓰지 않은 문장의 웃음은 바꾼다', () => {
    expect(typedLaughterToTags('일어나.ㅋㅋ')).toBe('일어나. [laughs]');
  });

  it('웃음만 있어도 여기서는 바꾼다 — 낭독할 말이 남는지는 호출부(speakTypedLaughter)가 본다', () => {
    expect(typedLaughterToTags('ㅋㅋㅋ')).toBe(LAUGH_TAG);
  });
});
