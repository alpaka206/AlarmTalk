import { describe, expect, it } from 'vitest';
import { VOICE_ENROLLMENT_SCRIPTS } from '@alarmtalk/shared';
import {
  ENROLLMENT_SCRIPT_NUMBER_LINES,
  ENROLLMENT_SCRIPT_READ_THRESHOLD,
  enrollmentScriptCoverage,
  isEnrollmentScriptReading,
} from '../src/lib/enrollment-script';

/**
 * 등록 녹음 전사가 제시 대본을 읽은 것인지 가린다(스펙 §4-2 '제시 대본을 읽은 녹음의 어체는 화자의 것이 아니다').
 * 대본을 읽은 녹음은 일부만 읽어도·전사 오류가 있어도 대본으로, 자유 발화는 주제가 비슷해도 대본이 아닌 것으로 본다.
 */
describe('isEnrollmentScriptReading — 제시 대본을 읽은 전사인가', () => {
  it('세 언어 대본을 그대로 읽은 전사는 대본이다', () => {
    for (const script of Object.values(VOICE_ENROLLMENT_SCRIPTS)) {
      expect(enrollmentScriptCoverage(script)).toBe(1);
      expect(isEnrollmentScriptReading(script)).toBe(true);
    }
  });

  it('iOS 영어 대본(줄표)·문장부호·띄어쓰기·줄바꿈만 다른 것은 같은 대본이다', () => {
    const ios = VOICE_ENROLLMENT_SCRIPTS.en
      .replace('love. Doesn', 'love — doesn')
      .replace('breath. The day', 'breath — the day');
    expect(enrollmentScriptCoverage(ios)).toBe(1);
    expect(isEnrollmentScriptReading(VOICE_ENROLLMENT_SCRIPTS.ko.replace(/[\s,.?!"]+/g, ' '))).toBe(
      true,
    );
  });

  it('앞의 두 문장만 읽어도 대본이다(등록 최소 길이 12초)', () => {
    expect(
      isEnrollmentScriptReading(
        '안녕하세요 지금부터 알람톡에서 쓸 목소리를 함께 만들어 볼게요 매일 아침 이 목소리가 좋아하는 사람을 깨워 준다니 설레지 않나요',
      ),
    ).toBe(true);
    expect(
      isEnrollmentScriptReading(
        'こんにちは。これからAlarmTalkで使う声を、一緒に作っていきましょう。毎朝この声が大切な人を起こしてくれるなんて、ワクワクしませんか？',
      ),
    ).toBe(true);
    expect(
      isEnrollmentScriptReading(
        "Hello, let's create your voice for AlarmTalk together. Every morning, this voice will wake someone you love, doesn't that sound exciting?",
      ),
    ).toBe(true);
  });

  it('전사 오류(띄어쓰기·받아쓰기 틀림·숫자·한자/가타카나 바꿈)가 있어도 대본이다', () => {
    // 한국어: 띄어쓰기가 갈리고 '알람 톡'·'설레이지'·아라비아 숫자.
    expect(
      isEnrollmentScriptReading(
        '안녕하세요. 지금부터 알람 톡에서 쓸 목소리를 함께 만들어 볼게요. 매일 아침 이 목소리가 좋아하는 사람을 깨워준다니 설레이지 않나요? 오늘은 하늘도 맑고 바람도 부드러운 걷기 좋은 날이에요. 이런 날엔 따뜻한 커피 한잔을 들고 동네를 한바퀴 돌고 싶어지는 것 같아요. 이번에는 숫자도 읽어볼까요? 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.',
      ),
    ).toBe(true);
    // 한국어: 받아쓰기가 여럿 틀렸다('아람톡'·'조아하는'·'막고'·'걸기').
    expect(
      isEnrollmentScriptReading(
        '안녕하세요 지금부터 아람톡에서 쓸 목소리를 함께 만들어 볼께요 매일 아침에 이 목소리가 조아하는 사람을 깨워 준다니까 설레지 안나요 오늘은 하늘도 막고 바람도 부드러운 걸기 좋은 날이에요',
      ),
    ).toBe(true);
    // 일본어: 가나를 한자·가타카나로, 숫자를 아라비아 숫자로 받아썼다.
    expect(
      isEnrollmentScriptReading(
        'こんにちは。これからアラームトークで使う声を一緒に作っていきましょう。毎朝この声が大切な人を起こしてくれるなんてワクワクしませんか？今日は空も晴れて風も柔らかい、散歩にぴったりの日です。こんな日は温かいコーヒーを片手に近所を一回りしたくなりますよね。次は数字も読んでみましょうか？1、2、3、4、5、6、7、8、9、10。嬉しい日は思い切り笑って、疲れた日は今日もお疲れ様と声をかけてあげてください。',
      ),
    ).toBe(true);
    // 영어: 숫자·문장부호·'Alarm Talk'.
    expect(
      isEnrollmentScriptReading(
        "Hello. Let's create your voice for Alarm Talk together. Every morning this voice will wake someone you love. Doesn't that sound exciting? The sky is clear and the breeze is soft today, a perfect day for a walk, isn't it? On days like this don't you feel like wandering around with a warm cup of coffee? Now shall we read some numbers together? 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.",
      ),
    ).toBe(true);
  });

  it('사투리로 읽은 대본도 대본이다 — 사투리 판정은 그대로 두고 어체만 버린다', () => {
    expect(
      isEnrollmentScriptReading(
        '안녕하십니꺼, 지금부터 알람톡에서 쓸 목소리를 함께 만들어 볼게예. 매일 아침 이 목소리가 좋아하는 사람을 깨워 준다카니, 설레지 않나예? 오늘은 하늘도 맑고 바람도 부드러운, 걷기 좋은 날이라예.',
      ),
    ).toBe(true);
  });

  it('대본을 읽고 조금 덧붙인 것은 대본, 자유 발화에 대본 한 문장이 섞인 것은 대본이 아니다', () => {
    const [firstParagraph, secondParagraph] = VOICE_ENROLLMENT_SCRIPTS.ko.split('\n\n');
    expect(
      isEnrollmentScriptReading(
        `${firstParagraph}\n${secondParagraph}\n아 다 읽었다. 우리 딸 잘 자.`,
      ),
    ).toBe(true);
    expect(
      isEnrollmentScriptReading(
        '안녕하세요, 지금부터 알람톡에서 쓸 목소리를 함께 만들어 볼게요. 아 근데 뭐라고 하지. 우리 딸 일어나, 밥 먹어야지. 오늘 학교 가는 날이잖아. 엄마가 맛있는 거 해 놨으니까 얼른 씻고 나와. 늦으면 또 뛰어가야 돼.',
      ),
    ).toBe(false);
  });

  // 말투 분석 평가(`scripts/eval-gemini-prompts.ts` F)의 자유 발화 전사 — 대본과 주제가 비슷한 것(날씨·산책·커피)까지.
  it('자유 발화는 정중체·반말·사투리 모두 대본이 아니다', () => {
    const freeSpeech = [
      '안녕하세요. 오늘은 날씨가 맑고 기온도 적당해서 산책하기 좋은 날이에요. 아침은 꼭 챙겨 드시고 좋은 하루 보내세요.',
      '안녕하세요, 저는 지금 알람톡에서 쓸 목소리를 녹음하고 있어요. 매일 아침 우리 딸을 깨워 줄 목소리예요. 오늘은 날씨가 참 좋네요. 커피 한 잔 마시고 산책하고 싶어요.',
      '야 오늘 날씨 진짜 좋다. 밥은 먹었어? 나 어제 시장 갔는데 사람 엄청 많더라. 너도 밥 잘 챙겨 먹고 다녀.',
      '아이고 오늘은 날씨가 참 좋네예. 밥은 묵었나? 내 어제 시장 댕겨왔는데 사람이 억수로 많더라카이. 니도 밥 잘 챙겨 묵고 댕기래이.',
      '제가요, 아침마다 커피를 꼭 마시거든요. 그래야 정신이 들거든요. 오늘도 힘내세요, 진짜로요.',
      'おはようございます。今日はとてもいい天気ですね。朝ごはんをしっかり食べて、気をつけて行ってきてください。',
      'こんにちは。今日は晴れていて散歩日和ですね。私は毎朝コーヒーを飲んでから仕事に行きます。皆さんも良い一日をお過ごしください。',
      'おはよう。今日はほんまにええ天気やねん。朝ごはんちゃんと食べなあかんで。ほな、気ぃつけて行ってきてな。',
      'おはようございます。今日は晴れるそうです。朝ごはんはちゃんと食べてくださいね。ほな、行ってらっしゃい。',
      'Good morning. I hope you slept well. Please remember to take your medicine and have a wonderful day at work.',
      "Hey! Morning, buddy. Gonna be a great day, y'know? Grab some coffee and let's roll. Don't forget your keys again, dude.",
      "Hello! I'm recording my voice for AlarmTalk. Every morning I want to wake my daughter. The sky is blue today and it's a perfect day for a walk with a cup of coffee.",
    ];
    for (const transcript of freeSpeech) {
      expect(enrollmentScriptCoverage(transcript), transcript).toBeLessThan(
        ENROLLMENT_SCRIPT_READ_THRESHOLD,
      );
      expect(isEnrollmentScriptReading(transcript), transcript).toBe(false);
    }
  });

  it('빈 전사·글자가 없는 전사는 대본이 아니다', () => {
    expect(isEnrollmentScriptReading('')).toBe(false);
    expect(isEnrollmentScriptReading('… ?! ♪')).toBe(false);
  });

  // Codex #864 — 대본에 있는 짧은 말을 되풀이한 자유 발화는 포함률만 보면 대본처럼 보였다(되풀이를 따로 셌다).
  it('대본에 있는 짧은 말을 되풀이한 자유 발화는 대본이 아니다 — 되풀이는 세지 않고 대본 분량을 요구한다', () => {
    expect(isEnrollmentScriptReading('안녕하세요. 안녕하세요. 안녕하세요. 안녕하세요.')).toBe(
      false,
    );
    expect(isEnrollmentScriptReading('こんにちは。こんにちは。こんにちは。こんにちは。')).toBe(
      false,
    );
    expect(isEnrollmentScriptReading('Hello! Hello! Hello! Hello! Hello! Hello!')).toBe(false);
  });

  // Codex #864 — 받아쓰기가 숫자 줄을 아라비아 숫자로 적으면 그 부분이 통째로 대본 밖으로 세어졌다.
  it('숫자 줄을 아라비아 숫자·한자 숫자로 받아써도 대본이다', () => {
    expect(
      isEnrollmentScriptReading('이번에는 숫자도 읽어 볼까요? 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.'),
    ).toBe(true);
    expect(
      isEnrollmentScriptReading(
        '이번에는 숫자도 읽어 볼까요? 하나, 둘, 셋, 넷, 다섯, 여섯, 일곱, 여덟, 아홉, 열.',
      ),
    ).toBe(true);
    expect(
      isEnrollmentScriptReading(
        'つぎは、数字も読んでみましょうか？1、2、3、4、5、6、7、8、9、10。',
      ),
    ).toBe(true);
    expect(
      isEnrollmentScriptReading(
        '次は数字も読んでみましょうか？一、二、三、四、五、六、七、八、九、十。',
      ),
    ).toBe(true);
    expect(
      isEnrollmentScriptReading(
        'Now, shall we read some numbers together? 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.',
      ),
    ).toBe(true);
    // 대본 전체를 숫자로 받아쓴 것도 그대로 1 이다.
    for (const [language, { spoken, written }] of Object.entries(ENROLLMENT_SCRIPT_NUMBER_LINES)) {
      for (const form of written) {
        const script = VOICE_ENROLLMENT_SCRIPTS[language as keyof typeof VOICE_ENROLLMENT_SCRIPTS];
        expect(enrollmentScriptCoverage(script.replace(spoken, form)), `${language} ${form}`).toBe(
          1,
        );
      }
    }
  });

  // 숫자 줄의 다른 꼴은 대본 글을 바꿔 끼워 만든다 — 대본의 숫자 줄이 바뀌면 바꿔 끼울 자리가 없어 그 꼴이 조용히 사라진다.
  it('숫자 줄(spoken)은 대본에 그대로 있다', () => {
    for (const [language, { spoken }] of Object.entries(ENROLLMENT_SCRIPT_NUMBER_LINES)) {
      expect(
        VOICE_ENROLLMENT_SCRIPTS[language as keyof typeof VOICE_ENROLLMENT_SCRIPTS],
        language,
      ).toContain(spoken);
    }
  });
});
