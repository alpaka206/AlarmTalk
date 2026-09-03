import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import { R2VoiceStorage } from './r2-storage';
import { sendVoiceShareChangedPush } from './fcm';
import { computeTtsCacheKey, generatedTtsObjectKey } from './audio-cache';
import { createSynthesisAttempts, normalizeSynthesisLanguage } from './voice-provider';
import { extractDeliveryTags, parseSpeechStyle, prepareAlarmTextWithVertex, generatePrerenderClipText, TAG_BODY_PATTERN, type SpeechStyle } from './vertex-translate';
import { withWriteTransaction, type DbExecutor } from './transactions';
import { appendMp3TrailingSilence } from './mp3-silence';
import { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } from './consent';
import { enqueueExternalDeletion } from './audio-retention';

/** 시스템 스톡 보이스의 소유자(로그인 불가, 발급 전용). migrations.ts #43 과 동일. */
export const SYSTEM_VOICE_LIBRARY_USER_ID = '70000000-0000-4000-9000-000000000001';

/** 스톡 클립 언어. 세 언어 모두 STOCK_CLIP_PRESETS 에 확정 리터럴로 들어 있다(번역 없음). */
export const STOCK_CLIP_LANGUAGES = ['ko', 'en', 'ja'] as const;

/** 목소리 미리듣기(샘플 인사말) 카테고리 — 알람 클립과 구분해 앱에서 따로 쓴다. */
export const STOCK_GREETING_CATEGORY = 'greeting';

/**
 * 스톡 클립 프리셋 — 2026-07-19 확정 대사(voice-preview/대사.md)의 3개 언어 '리터럴'
 * 텍스트다(딜리버리 태그 포함, 예보 전달어법 `~대요`). 합성 시 번역/자동태깅(Vertex)
 * 없이 이 문구가 그대로 ElevenLabs 로 가므로, 재시드해도 항상 같은 문구가 나온다.
 * dev/prod 에 시딩된 실데이터(messages is_preset=1)와 문구가 일치한다 — 문구를 바꾸면
 * /api/admin/seed-stock-clips 로 재시드해야 실데이터에 반영된다.
 *
 * 카테고리를 늘리려면 여기에 추가하면 findMissingStockTargets 가 자동으로
 * (보이스 × 언어 × variant) 매트릭스를 채운다.
 */
export const STOCK_CLIP_PRESETS = [
  // 무료 플랜 알람 "버킷". 카테고리당 여러 variants(문구)를 시스템 보이스마다 3개 언어로
  // 미리 합성해 둔다. 앱은 한 버킷의 변형들을 전부 로컬 캐시한 뒤 완전 오프라인으로 재생한다.
  //  - 무료 버킷 = 날씨(weather) 9문구(조건 매칭) + 약(medication) 2문구(순차 회전).
  //    (보이스당 (9+2)×3언어 = 33클립)
  //  - greeting 은 알람이 아니라 목소리 미리듣기용 1문구(3언어) — 음색 비교를 위해
  //    4보이스 공통 문구를 쓴다.
  //  - 버킷을 늘리려면 카테고리를 추가하고 재시드하면 된다(FREE_BUCKET_CATEGORIES 가 자동 반영).
  // 날씨 9문구 — variant 순서가 CLONE_WEATHER_CONDITIONS(0..7)와 반드시 일치해야 하고,
  // 마지막(8)은 '날씨 미확인' 폴백이다(클라 매칭 규약: 마지막 인덱스 = 폴백).
  // 무료도 저장한 도시 기준으로 전날 조건을 확인해(무료 API) 그날 클립을 매칭 재생한다.
  {
    category: 'weather',
    texts: {
      ko: [
        '[brightly] 오늘은 괜히 어디론가 나가고 싶어질 만큼 날씨가 좋대요. [warmly] 이런 날 계속 누워 있기엔 좀 아깝잖아요. [encouraging] 슬슬 일어나서... 산책이라도 하러 가볼까요?',
        '[warmly] 오늘은 비가 올 수 있대요. 비 오는 날엔 빗소리 들으면서 조금만 더 누워 있고 싶어지죠... [encouraging] 그래도 이제 슬슬 일어나 볼까요? [caring] 나갈 때는 우산 꼭 챙겨요.',
        '[brightly] 오늘은 눈이 올 수 있대요. 눈 내리는 건 가만히 바라보는 것만으로도 참 예쁜 것 같아요. [encouraging] 일단 이불부터 걷고, 창밖을 한 번 볼까요? [caring] 나갈 때는 따뜻하게 입고, 길이 미끄러울 수 있으니까 천천히 가요.',
        '[caring] 오늘은 미세먼지가 심하대요. 겉으로는 괜찮아 보여도 공기가 답답할 수 있어요. [firmly] 이런 날은 조금 귀찮더라도 마스크 꼭 챙겨요. [encouraging] 공기는 좀 답답하더라도 아침은 힘차게 시작해 볼까요?',
        '[warmly] 오늘은 하늘이 흐리대요. 이런 날은 아침이 와도 괜히 더 누워 있고 싶어지죠. [encouraging] 그래도 계속 누워 있으면 더 일어나기 싫어질 테니까... [brightly] 일단 커튼부터 열고, 하루를 시작해 볼까요?',
        '[concerned] 오늘 아침은 안개가 짙대요. 앞이 잘 안 보이면 평소보다 가는 데 시간이 조금 더 걸릴 수도 있어요. [encouraging] 조금 여유 있게 준비하려면, 이제 일어나야겠죠? [firmly] 나갈 때는 앞을 잘 살피고, 서두르지 말고 천천히 가요.',
        '[warmly] 오늘은 정말 덥대요. 이런 날은 에어컨 바람만 쐬면서 하루 종일 쉬고 싶어지죠. [encouraging] 그래도 더 더워지기 전에 슬슬 일어나 볼까요? [caring] 물 자주 마시고, 한낮에는 너무 무리하지 말아요.',
        '[caring] 오늘은 많이 춥대요. 이런 날은 이불 밖으로 나오기가 정말 싫어지죠. [warmly] 그래도 따뜻한 물로 세수하면 잠이 조금 깰 거예요... 이제 용기 내서 일어나 볼까요? [caring] 나갈 때는 옷 따뜻하게 챙겨 입는 것도 잊지 말고요.',
        '[apologetically] 오늘은 날씨 정보를 불러오지 못했어요. [caring] 나가기 전에 창밖을 한 번 보고, 날씨도 꼭 확인해 주세요. [cheerfully] 날씨는 못 알려 드렸지만... 이제 슬슬 일어나서 오늘을 시작해 볼까요?',
      ],
      en: [
        "[brightly] The weather's so nice today, it makes you want to head out somewhere. [warmly] It'd be a shame to stay in bed on a day like this, wouldn't it? [encouraging] How about getting up... and going for a walk?",
        "[warmly] There's a chance of rain today. Rainy days make you want to stay in bed a little longer and listen to the rain... [encouraging] Still, how about getting up now? [caring] And don't forget your umbrella when you head out.",
        "[brightly] There's a chance of snow today. There's something so beautiful about just watching it fall. [encouraging] Let's pull back the covers and take a look outside. [caring] Dress warmly when you go out, and take it slow. The roads may be slippery.",
        "[caring] The air quality is pretty poor today. It may look fine outside, but the air could still feel heavy. [firmly] Even if it's a hassle, make sure to grab a mask before you go out. [encouraging] The air may not be great, but let's start the morning on a bright note.",
        "[warmly] It's going to be cloudy today. Mornings like this make it even harder to get out of bed, don't they? [encouraging] But the longer you stay there, the harder it gets... [brightly] Let's start by opening the curtains and getting the day going.",
        "[concerned] It's pretty foggy this morning. If visibility is low, it could take a little longer than usual to get where you're going. [encouraging] If you want a little extra time, it might be time to get up. [firmly] When you head out, keep an eye on what's ahead and take it slow.",
        "[warmly] It's going to be really hot today. On days like this, you just want to sit in front of the air conditioner all day, don't you? [encouraging] Still, how about getting up before it gets even hotter? [caring] Drink plenty of water, and don't push yourself too hard in the middle of the day.",
        "[caring] It's going to be very cold today. On days like this, getting out from under the covers feels almost impossible, doesn't it? [warmly] But washing your face with warm water should help wake you up a little... so, shall we be brave and get up? [caring] And don't forget to dress warmly when you go out.",
        "[apologetically] I couldn't load today's weather information. [caring] Take a look outside and be sure to check the forecast before you head out. [cheerfully] I couldn't tell you the weather... but how about getting up and starting your day?",
      ],
      ja: [
        '[brightly] 今日はどこかへ出かけたくなるくらい、いいお天気だそうですよ。 [warmly] こんな日にずっと布団の中にいるのは、ちょっともったいないですよね。 [encouraging] そろそろ起きて... お散歩にでも行ってみませんか?',
        '[warmly] 今日は雨が降るかもしれません。雨の日って、雨音を聞きながらもう少しだけ横になっていたくなりますよね... [encouraging] でも、そろそろ起きてみませんか? [caring] 出かけるときは、傘を忘れずに。',
        '[brightly] 今日は雪が降るかもしれません。雪って、ただ眺めているだけでもきれいですよね。 [encouraging] まずは布団から出て、窓の外を見てみませんか? [caring] 出かけるときは暖かくして、道が滑りやすいかもしれないので、ゆっくり歩いてくださいね。',
        '[caring] 今日は空気中の微粒子が多いそうです。見た目は平気でも、空気が重く感じるかもしれません。 [firmly] こういう日は少し面倒でも、マスクを忘れずに。 [encouraging] 空気はすっきりしなくても、朝は元気に始めてみましょうか?',
        '[warmly] 今日は曇り空だそうです。こういう朝は、いつもより布団から出たくなくなりますよね。 [encouraging] でも、寝たままでいるとますます起きづらくなるので... [brightly] まずはカーテンを開けて、一日を始めてみませんか?',
        '[concerned] 今朝は霧がかなり濃いそうです。前が見えにくいと、いつもより移動に時間がかかるかもしれません。 [encouraging] 少し余裕を持って支度するためにも、そろそろ起きましょうか? [firmly] 出かけるときは前をよく見て、急がずゆっくり行ってくださいね。',
        '[warmly] 今日はかなり暑くなるそうです。こんな日は、一日中エアコンの風に当たっていたくなりますよね。 [encouraging] もっと暑くなる前に、そろそろ起きてみませんか? [caring] こまめに水分をとって、日中は無理しすぎないでくださいね。',
        '[caring] 今日はかなり冷え込むそうです。こんな日は、布団から出るのが本当にいやになりますよね。 [warmly] でも、温かいお湯で顔を洗えば、少し目が覚めるはずです... ちょっとだけ勇気を出して、起きてみませんか? [caring] 出かけるときは、暖かい服装も忘れずに。',
        '[apologetically] 今日は天気情報を取得できませんでした。 [caring] 出かける前に窓の外を見て、天気も確認してくださいね。 [cheerfully] お天気はお伝えできませんでしたが... そろそろ起きて、一日を始めてみませんか?',
      ],
    },
  },
  {
    category: 'medication',
    texts: {
      ko: [
        '[warmly] 약 먹을 시간이에요. 이런 건 잠깐 미뤄 두면 금방 잊어버리기 쉽잖아요. [encouraging] 알람 끄기 전에 지금 바로 챙겨 먹어요.',
        '[caring] 혹시 약 먹는 거 잊고 있진 않았어요? 바쁘다 보면 깜빡하게 되잖아요. [encouraging] 하던 건 잠깐만 내려놓고, 지금 약부터 챙겨 먹어요.',
      ],
      en: [
        "[warmly] It's time to take your medicine. If you put it off, it's easy to forget. [encouraging] Before you turn off the alarm, go ahead and take it now.",
        "[caring] Did you forget it was time to take your medicine? When you're busy, it can easily slip your mind. [encouraging] Put down what you're doing for just a moment, and take your medicine first.",
      ],
      ja: [
        '[warmly] お薬の時間ですよ。あとでと思っていると、つい忘れてしまいますよね。 [encouraging] アラームを止める前に、今のうちに飲んでおきましょう。',
        '[caring] お薬の時間、忘れていませんか? 忙しいと、ついうっかりしてしまいますよね。 [encouraging] 今していることを少しだけ止めて、先にお薬を飲みましょう。',
      ],
    },
  },
  // 운세 5문구 — variant 순서가 CLONE_FORTUNE_THEMES(luck/caution/wealth/health/relationship)
  // 와 반드시 일치해야 한다. 클라가 사주+날짜로 **온디바이스** 인덱스를 고르므로 서버가
  // 개인정보를 읽지 않고, 문구도 누구에게나 맞는 말이어야 한다(오락용임을 문장이 밝힌다).
  {
    category: 'fortune',
    texts: {
      ko: [
        '[playfully] 오늘은 운이 좀 따라주는 날이래요. 생각보다 일이 술술 풀릴지도 모르겠네요. [brightly] 미뤄 둔 일이 있다면, 오늘은 가볍게 한 번 해봐도 좋겠어요.',
        '[warmly] 오늘은 서두르지만 않으면 괜찮게 흘러갈 거래요. 마음이 급하면 평소엔 안 하던 실수도 나오잖아요. [encouraging] 오늘은 한 박자만 늦춰서, 하나씩 확인하면서 해봐요.',
        '[playfully] 오늘은 재물운이 조금 따라준대요. 뜻밖에 돈을 아낄 일이 생기거나, 생각지도 못한 곳에서 작은 이득을 볼지도 모르겠네요. [brightly] 이왕이면... 로또 같은 큰 행운까지 따라오면 정말 좋겠는데요?',
        '[caring] 오늘은 몸 상태를 조금 더 잘 살피는 게 좋대요. 괜찮다고 넘긴 피로가 나중에 한꺼번에 몰려올 수도 있거든요. [warmly] 평소보다 조금 천천히 움직이고, 지치면 잠깐 쉬어 가요.',
        '[brightly] 오늘은 사람들과 기분 좋은 일이 생길 수 있대요. 가볍게 건넨 한마디가 생각보다 좋은 분위기를 만들지도 모르겠네요. [warmly] 문득 떠오르는 사람이 있다면, 먼저 안부를 전해 봐요.',
      ],
      en: [
        "[playfully] Luck might be on your side today. Things could go more smoothly than you expect. [brightly] If there's something you've been putting off, today might be a good day to give it a try.",
        "[warmly] Today should go pretty smoothly as long as you don't rush. When you're in a hurry, it's easy to make mistakes you normally wouldn't. [encouraging] Take things one beat slower today, and check them one at a time.",
        "[playfully] You might have a little luck with money today. You could find an unexpected way to save, or get a small benefit from somewhere you didn't expect. [brightly] And while we're at it... wouldn't it be nice if a lottery-sized bit of luck came along too?",
        "[caring] It may be a good day to pay a little more attention to how you're feeling. Fatigue you brush off can sometimes catch up with you all at once. [warmly] Take things a little slower than usual, and give yourself a break when you need one.",
        '[brightly] You may have a nice moment with someone today. Something you say in passing could brighten the mood more than you expect. [warmly] If someone comes to mind, try sending them a quick hello.',
      ],
      ja: [
        '[playfully] 今日は少し運が味方してくれる日だそうですよ。思ったより、物事がすんなり進むかもしれません。 [brightly] 先延ばしにしていたことがあるなら、今日は気軽にやってみてもよさそうですね。',
        '[warmly] 今日は、焦らなければうまく進みそうです。気持ちが急ぐと、普段ならしないようなミスも出てしまいますよね。 [encouraging] 今日はひと呼吸おいて、一つずつ確認しながら進めてみましょう。',
        '[playfully] 今日は少し金運に恵まれるそうですよ。思いがけず出費を抑えられたり、予想外のところでちょっと得をしたりするかもしれません。 [brightly] どうせなら... 宝くじが当たるくらいの大きな幸運まで来てくれたら、うれしいんですけどね。',
        '[caring] 今日は、いつもより少し体調に気を配ったほうがよさそうです。大丈夫だと思っていた疲れが、あとから一気に出ることもありますからね。 [warmly] いつもより少しゆっくり動いて、疲れたらひと休みしてくださいね。',
        '[brightly] 今日は、人との間にちょっと嬉しいことがあるかもしれません。何気なくかけた一言が、思った以上にいい雰囲気を作ってくれそうです。 [warmly] ふと思い浮かぶ人がいたら、こちらから軽く連絡してみてくださいね。',
      ],
    },
  },
  // 응원 3문구.
  // ⚠ **id 는 `cheer` 이고 예전 이름은 `love` 였다**(2026-09-02). 대사가 응원·자기돌봄으로
  //   확정되면서 개념 자체를 바꿨다 — 연애 문구가 아니다. 옛 값 `'love'` 는 이미 저장된
  //   행·구버전 앱이 보내오므로 **읽을 때 접어 준다**(`normalizeRandomContext`,
  //   `randomPromptContextForBucket`, iOS `RandomPromptContext.normalized`).
  {
    category: 'cheer',
    texts: {
      ko: [
        '[warmly] 해야 할 일이 많으면 시작하기도 전에 마음부터 바빠지잖아요. [caring] 그렇다고 처음부터 전부 잘할 필요는 없어요. [encouraging] 지금 할 수 있는 것부터 하나씩 해봐요. 하다 보면 생각보다 잘 풀릴지도 모르니까요.',
        '[warmly] 이것저것 신경 쓰다 보면 정작 스스로를 챙기는 건 자꾸 뒤로 미루게 되죠. [caring] 바쁘더라도 밥은 꼭 챙겨 먹고, 지치면 잠깐이라도 쉬어요. [encouraging] 그래야 하고 싶은 일도 오래 할 수 있잖아요.',
        '[caring] 힘든 일이 생겨도 혼자 괜찮은 척할 필요는 없어요. [warmly] 믿을 만한 사람에게 슬쩍 털어놓으면 생각보다 마음이 가벼워질 때도 있거든요. [encouraging] 너무 혼자 버티려고만 하지는 말아요.',
      ],
      en: [
        "[warmly] When you have a lot to do, your mind can start racing before you even begin. [caring] But you don't have to do everything perfectly from the start. [encouraging] Just take one thing at a time, starting with what you can do now. It may go better than you think.",
        "[warmly] When you're busy taking care of everything else, it's easy to keep putting yourself last. [caring] Even on busy days, make sure you eat, and take a short break when you're tired. [encouraging] Taking care of yourself is what lets you keep doing the things you enjoy.",
        "[caring] When things get hard, you don't have to pretend you're okay. [warmly] Talking it through with someone you trust can make things feel lighter than you expect. [encouraging] So please don't try to carry everything on your own.",
      ],
      ja: [
        '[warmly] やることが多いと、始める前から気持ちばかり焦ってしまいますよね。 [caring] でも、最初から全部うまくやろうとしなくても大丈夫です。 [encouraging] 今できることから、一つずつやってみましょう。始めてみたら、思ったよりうまく進むかもしれませんよ。',
        '[warmly] あれこれ気にかけていると、自分のことはつい後回しになりますよね。 [caring] 忙しくても食事はきちんととって、疲れたら少しでも休んでください。 [encouraging] そうすれば、やりたいことも無理なく長く続けられますから。',
        '[caring] つらいことがあっても、一人で平気なふりをしなくていいんですよ。 [warmly] 信頼できる人に少し話してみるだけで、思ったより気持ちが軽くなることもあります。 [encouraging] 何でも一人で抱え込もうとしないでくださいね。',
      ],
    },
  },
  {
    // 목소리 창에서 "이 목소리는 이런 느낌" 을 들려주는 인사 샘플(미리듣기). 같은 문장을
    // 4개 목소리로 들려줘야 음색 비교가 되므로 보이스별 개별 멘트 없이 공통 문구 하나다.
    category: STOCK_GREETING_CATEGORY,
    texts: {
      ko: [
        '[brightly] 안녕하세요, 만나서 반가워요. [warmly] 앞으로 아침마다 이 목소리로 깨워 드릴게요. [playfully] 어때요? 이 목소리, 마음에 드나요?',
      ],
      en: [
        "[brightly] Hi, it's nice to meet you. [warmly] I'll be waking you up with this voice every morning. [playfully] So, what do you think? Do you like it?",
      ],
      ja: [
        '[brightly] はじめまして。お会いできてうれしいです。 [warmly] これから毎朝、この声で起こしますね。 [playfully] どうですか? この声、気に入ってもらえましたか?',
      ],
    },
  },
] as const;


/**
 * **이름이 바뀐 카테고리의 옛 이름 → 새 이름.**
 *
 * ⚠ **옛 이름을 지우지 말 것.** 스토어에 올라간 앱과 사용자 기기의 로컬 DB 는 우리가
 * 고칠 수 없다 — 구버전 앱은 계속 옛 값을 보내오고, 이미 저장된 알람 행도 그 값을 들고
 * 있다. 받아 주지 않으면 그 앱의 알람 저장·수정·전송이 **전부 400** 이 된다.
 *
 * 2026-09-03: 대사가 응원·자기돌봄으로 확정되면서 `love` → `cheer` 로 개념을 바꿨다.
 */
export const RENAMED_STOCK_CATEGORIES: Readonly<Record<string, string>> = {
  love: 'cheer',
};

/** 옛 카테고리 이름을 현재 이름으로 접는다. 모르는 값은 그대로 돌려준다(검증은 호출부 몫). */
export function normalizeStockCategory(category: string): string {
  return RENAMED_STOCK_CATEGORIES[category] ?? category;
}

/**
 * 무료 플랜이 알람 버킷으로 고를 수 있는 카테고리(greeting 제외). 스톡 프리셋이 단일
 * 출처이므로, STOCK_CLIP_PRESETS 에 카테고리를 추가하면 자동으로 버킷 후보가 된다.
 */
export const FREE_BUCKET_CATEGORIES: readonly string[] = STOCK_CLIP_PRESETS.map(
  (preset) => preset.category,
).filter((category) => category !== STOCK_GREETING_CATEGORY);

/**
 * 유료 클론 목소리에 사전렌더할 알람 버킷 카테고리(greeting 미리듣기는 별도로 항상 포함).
 * 날씨/운세는 '조건·테마'를 variant 인덱스로 담는다(category 는 하나, variant 순서가 조건/테마).
 * 재생 시 클라가 (날씨=지역 신호 / 운세=사주+날짜)로 로컬에서 조건·테마 인덱스를 골라 매칭한다.
 */
export const PAID_BUCKET_CATEGORIES: readonly string[] = [
  'weather',
  'fortune',
  // 옛 이름은 `love` — 2026-09-02 에 개념을 응원으로 바꿨다. 읽는 쪽이 옛 값을 접는다.
  'cheer',
  'medication',
];

/** 유료 클론이 사전렌더 대상으로 삼는 카테고리(알람 버킷 + greeting 미리듣기 겸 기상 인사). */
export const CLONE_PRERENDER_CATEGORIES: readonly string[] = [
  ...PAID_BUCKET_CATEGORIES,
  STOCK_GREETING_CATEGORY,
];

/**
 * 날씨 variant 인덱스 ↔ 조건. 클라가 라이브 날씨 신호를 이 순서의 인덱스로 매핑해 해당 클립을
 * 고른다. 순서를 바꾸면 기존 사전렌더 인덱스와 어긋나므로 append-only 로 관리한다.
 */
export const CLONE_WEATHER_CONDITIONS = [
  'nice',
  'rain',
  'snow',
  'dust',
  'cloud',
  'fog',
  'heat',
  'cold',
] as const;

/** 운세 variant 인덱스 ↔ 테마(오락용, 개인정보 미포함). 클라가 사주+날짜로 인덱스를 고른다. */
export const CLONE_FORTUNE_THEMES = [
  'luck',
  'caution',
  'wealth',
  'health',
  'relationship',
] as const;

/**
 * 유료 클론 사전렌더의 '의미 seed'. 각 문자열은 최종 문구가 아니라 생성 지시(outcome)이며,
 * generatePrerenderClipText 가 그 목소리의 관계/호칭/말투에 맞춰 실제 문구로 만든다. 소량 유지.
 * greeting=기상 인사(미리듣기 겸용). weather=CLONE_WEATHER_CONDITIONS 순서(0..7) + 미해결 안내 1(마지막),
 * fortune=CLONE_FORTUNE_THEMES 순서(기기 결정적이라 미해결 없음).
 */
export const CLONE_CLIP_SEEDS: {
  category: string;
  defaultTag: string;
  seeds: readonly string[];
}[] = [
  {
    category: STOCK_GREETING_CATEGORY,
    defaultTag: 'cheerfully',
    seeds: [
      '다정하게 아침 인사를 하며 잘 잤는지 안부를 묻고, 오늘 하루도 기분 좋게 시작하자고 따뜻하게 깨워 준다.',
    ],
  },
  {
    category: 'weather',
    defaultTag: 'cheerfully',
    // seeds[0..7] = CLONE_WEATHER_CONDITIONS 순서(nice/rain/snow/dust/cloud/fog/heat/cold).
    // seeds[8] = '날씨 미해결' 안내(반드시 마지막). 준비창에서 인터넷이 안 돼 날씨를 못 받아온 경우,
    // 클라가 무음/오재생(맑음) 대신 이 클립으로 폴백해 정직하게 안내한다(클라 bucketVariantIndex 의
    // size-1 규약 = 마지막 클립). resolvePrerenderWeatherIndex 는 0..7 만 반환하므로 8 은 오직 폴백용.
    seeds: [
      '오늘 날씨가 맑고 좋다고 알린 뒤, 이런 날 계속 누워 있기엔 아깝다고 공감해 주고, 슬슬 일어나 바깥바람을 쐬어 보자고 권한다.',
      '오늘 비가 온다고 알리고, 빗소리 들으며 더 누워 있고 싶은 마음에 먼저 공감한 뒤, 그래도 이제 일어나 보자고 하며 우산을 꼭 챙기라고 당부한다.',
      '오늘 눈이 온다고 알리고, 눈 오는 풍경이 예쁘다고 말하며 창밖을 보자고 이끈 뒤, 따뜻하게 입고 미끄러우니 천천히 가라고 챙긴다.',
      '오늘 미세먼지가 심하다고 알리고, 겉보기와 달리 공기가 답답할 수 있다고 일러 준 뒤, 귀찮아도 마스크를 꼭 챙기라고 당부하며 그래도 아침은 힘차게 시작하자고 한다.',
      '오늘 하늘이 흐리다고 알리고, 이런 날 더 눕고 싶어지는 마음에 공감한 뒤, 계속 누워 있으면 더 일어나기 싫어진다며 커튼부터 열고 하루를 시작하자고 한다.',
      '오늘 안개가 짙다고 알리고, 앞이 안 보이면 평소보다 시간이 더 걸릴 수 있다고 일러 준 뒤, 여유 있게 준비하려면 지금 일어나야 한다고 이끌고 서두르지 말라고 당부한다.',
      '오늘 많이 덥다고 알리고, 하루 종일 시원한 데 있고 싶은 마음에 공감한 뒤, 더 더워지기 전에 일어나자고 권하며 물을 자주 마시라고 챙긴다.',
      '오늘 많이 춥다고 알리고, 이불 밖으로 나오기 싫은 마음에 공감한 뒤, 따뜻한 물로 세수하면 잠이 깰 거라고 이끌며 옷 따뜻하게 입으라고 챙긴다.',
      '인터넷이 안 돼 오늘 날씨를 확인하지 못했다고 미안한 듯 알리고, 나가기 전에 창밖과 날씨를 꼭 확인하라고 부탁한 뒤, 그래도 이제 일어나 하루를 시작하자고 응원한다.',
    ],
  },
  {
    category: 'fortune',
    defaultTag: 'playfully',
    seeds: [
      '오늘은 운이 따라주는 날이라고 가볍게 재미로 전하며, 일이 생각보다 술술 풀릴 수도 있으니 미뤄 둔 일을 오늘 해봐도 좋겠다고 권한다.',
      '오늘은 서두르지만 않으면 괜찮게 흘러갈 거라고 전하고, 마음이 급하면 평소 안 하던 실수가 나온다며, 한 박자 늦춰 하나씩 확인하면서 하자고 다독인다.',
      '오늘은 재물운이 조금 따른다고 재미로 전하며, 뜻밖에 아끼거나 작은 이득을 볼지도 모른다고 하고, 이왕이면 더 큰 행운까지 왔으면 좋겠다고 가볍게 덧붙인다.',
      '오늘은 몸 상태를 더 살피면 좋은 날이라고 전하고, 괜찮다고 넘긴 피로가 한꺼번에 몰려올 수 있다고 일러 준 뒤, 천천히 움직이고 지치면 쉬라고 다정하게 당부한다.',
      '오늘은 사람들과 기분 좋은 일이 있을 수 있다고 전하며, 가볍게 건넨 한마디가 좋은 분위기를 만든다고 하고, 떠오르는 사람이 있으면 먼저 안부를 전해 보라고 권한다.',
    ],
  },
  {
    // 응원(옛 이름 `love`). 시드도 응원·자기돌봄으로 맞췄다 — 라벨이 '응원' 인데
    // 시드만 "사랑하는 마음을 담아" 로 두면 클론이 라벨과 다른 말을 한다.
    category: 'cheer',
    defaultTag: 'encouraging',
    seeds: [
      '할 일이 많으면 시작 전부터 마음이 바빠진다고 공감한 뒤, 처음부터 다 잘할 필요는 없다고 하고, 지금 할 수 있는 것부터 하나씩 해보자고 응원한다.',
      '이것저것 신경 쓰다 정작 자기를 챙기는 건 뒤로 미루게 된다고 공감한 뒤, 바빠도 끼니는 챙기고 지치면 잠깐이라도 쉬라고 하며, 그래야 하고 싶은 일도 오래 할 수 있다고 다독인다.',
      '힘든 일이 있어도 혼자 괜찮은 척하지 않아도 된다고 하고, 믿을 만한 사람에게 털어놓으면 마음이 가벼워질 때가 있다고 하며, 혼자 버티려 하지 말라고 따뜻하게 응원한다.',
    ],
  },
  {
    category: 'medication',
    defaultTag: 'cheerfully',
    seeds: [
      '약 먹을 시간이라고 알리고, 미뤄 두면 금방 잊어버리기 쉽다고 일러 준 뒤, 알람 끄기 전에 지금 바로 챙겨 먹으라고 당부한다.',
      '혹시 약 먹는 걸 잊고 있진 않았는지 부드럽게 묻고, 바쁘면 깜빡하게 된다고 공감한 뒤, 하던 일은 잠깐 내려놓고 약부터 챙겨 먹으라고 한다.',
      '약 드실 시간이라고 알리며, 물이랑 같이 챙겨 드시라고 하고, 오늘 하루도 건강하게 잘 보내시라고 따뜻하게 응원한다.',
    ],
  },
];

export interface SystemVoiceRow {
  id: string;
  name: string;
  elevenlabsVoiceId: string;
}

export interface StockClipTarget {
  voiceProfileId: string;
  voiceName: string;
  elevenlabsVoiceId: string;
  /**
   * 이 클립을 소유할 유저. 시스템 보이스는 SYSTEM_VOICE_LIBRARY_USER_ID, 유료 클론은
   * 실소유자 PK. messages/generated_audio_assets.user_id 와 R2 object key owner 로 쓰인다.
   */
  ownerUserId: string;
  category: string;
  baseText: string;
  language: string;
  /** 같은 (보이스·카테고리·언어) 안에서 문구를 구분/정렬하는 0-based 인덱스. */
  variantIndex: number;
  /**
   * true 면 baseText 를 '의미 seed' 로 보고 그 목소리의 관계/호칭/말투에 맞춰 문구를 생성한다
   * (유료 클론). false(시스템)면 baseText 를 리터럴로 번역+태깅만 한다.
   */
  toneAdapt: boolean;
  /** 톤 적응 생성용 관계/호칭(클론만). generatePrerenderClipText 로 전달된다. */
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  /** 톤 적응 생성 시 카테고리 기본 delivery 태그. */
  defaultTag?: string;
  /** 등록 미리듣기에서 확정된 preview_text(클론만) — 톤/어투 스타일 레퍼런스. */
  styleReference?: string | null;
  /** 등록 녹음 전사에서 분석한 화자 말투(사투리 등, 클론만). */
  speechStyle?: SpeechStyle | null;
  claimToken?: string;
  /**
   * **목소리 교체 회차인가.** true 면 같은 (voice·category·language·variant) preset 이
   * 이미 있을 때 no-op 로 물러나지 않고 그 행의 오디오·문구를 **덮어쓴다**.
   *
   * ⚠ 이게 없으면 교체가 성립하지 않는다. 기본 경로는 조건부 INSERT 라 기존 preset 이
   * 있으면 아무것도 안 하고 방금 합성한 R2 오브젝트까지 지운다 — cron 이 겹쳐 돌 때
   * 중복 행을 막으려고 그렇게 만든 것이고, 교체에는 정반대로 작용한다.
   *
   * ⚠ **message_id 는 바꾸지 않는다.** 알람이 그 값을 가리키고 있어서다 — 그대로 둬야
   * 알람이 아무것도 눈치채지 못하고 소리만 새 목소리가 된다.
   */
  refreshExisting?: boolean;
}

/** 사전렌더 대상 보이스(시스템 or 유료 클론). ownerUserId·categories 로 소유자/버킷을 구분. */
export interface PrerenderVoice {
  id: string;
  name: string;
  elevenlabsVoiceId: string;
  ownerUserId: string;
  /** 이 보이스에 렌더할 카테고리 집합. 시스템=전체, 클론=CLONE_PRERENDER_CATEGORIES. */
  categories: readonly string[];
  /**
   * 지정 시 이 보이스의 모든 카테고리를 이 언어 1개로만 렌더(클론=확정 시점 앱 언어).
   * 미지정 시 각 preset 의 languages 를 그대로 쓴다(시스템=ko/en/ja).
   */
  languageOverride?: string;
  /** true 면 CLONE_CLIP_SEEDS(톤 적응)로, 아니면 STOCK_CLIP_PRESETS(리터럴)로 대상 계산. */
  isClone?: boolean;
  /** 클론 톤 적응 생성용 관계/호칭. */
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  /** 등록 미리듣기에서 확정된 preview_text(클론만) — 톤/어투 스타일 레퍼런스. */
  styleReference?: string | null;
  /** 등록 녹음 전사에서 분석한 화자 말투(사투리 등, 클론만). */
  speechStyle?: SpeechStyle | null;
  claimToken?: string;
}

export interface GeneratedStockClip {
  message_id: string;
  voice_profile_id: string;
  voice_name: string;
  category: string;
  language: string;
  variant: number;
  text: string;
}

/** 합성 준비된(ready) 시스템 보이스 목록. */
export async function listSystemVoices(db: Client): Promise<SystemVoiceRow[]> {
  const res = await db.execute({
    sql: `SELECT id, name, elevenlabs_voice_id
          FROM voice_profiles
          WHERE COALESCE(is_system, 0) = 1
            AND deleted_at IS NULL
            AND status = 'ready'
            AND elevenlabs_voice_id IS NOT NULL
          ORDER BY id ASC`,
    args: [],
  });
  return res.rows
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      elevenlabsVoiceId: String(row.elevenlabs_voice_id ?? ''),
    }))
    .filter((row) => row.elevenlabsVoiceId.length > 0);
}

/** 시스템 보이스를 사전렌더 대상(전 카테고리·preset 언어 그대로)으로 변환. */
export function systemPrerenderVoices(voices: SystemVoiceRow[]): PrerenderVoice[] {
  const allCategories = STOCK_CLIP_PRESETS.map((preset) => preset.category);
  return voices.map((voice) => ({
    id: voice.id,
    name: voice.name,
    elevenlabsVoiceId: voice.elevenlabsVoiceId,
    ownerUserId: SYSTEM_VOICE_LIBRARY_USER_ID,
    categories: allCategories,
  }));
}

/**
 * 큐가 지목한 id 들 중 사전렌더 준비된(ready) 유료 클론 목소리 목록. 실소유자(user_id)를
 * ownerUserId 로 싣고 CLONE_PRERENDER_CATEGORIES(+앱 언어 1개)로 스코프한다. voiceIds 가
 * 비면 빈 배열(전유저 스캔 방지).
 */
export async function listReadyCloneVoices(
  db: Client,
  requests: readonly {
    voiceProfileId: string;
    ownerUserId: string;
    language: string;
    claimToken: string;
  }[],
): Promise<PrerenderVoice[]> {
  if (requests.length === 0) return [];
  const byId = new Map(requests.map((r) => [r.voiceProfileId, r]));
  const ids = [...byId.keys()];
  const ph = ids.map(() => '?').join(',');
  const res = await db.execute({
    sql: `SELECT id, name, elevenlabs_voice_id, relationship_label, listener_title, preview_text, speech_style
          FROM voice_profiles
          WHERE COALESCE(is_system, 0) = 0
            AND deleted_at IS NULL
            AND COALESCE(is_draft, 0) = 0
            AND status = 'ready'
            AND elevenlabs_voice_id IS NOT NULL
            AND id IN (${ph})`,
    args: ids,
  });
  const out: PrerenderVoice[] = [];
  for (const row of res.rows) {
    const id = String(row.id);
    const req = byId.get(id);
    const elevenlabsVoiceId = String(row.elevenlabs_voice_id ?? '');
    if (!req || elevenlabsVoiceId.length === 0) continue;
    const relationshipLabel = ((row.relationship_label as string | null) ?? '').trim() || null;
    const listenerTitle = ((row.listener_title as string | null) ?? '').trim() || null;
    const styleReference = ((row.preview_text as string | null) ?? '').trim() || null;
    const speechStyle = parseSpeechStyle(row.speech_style);
    out.push({
      id,
      name: String(row.name),
      elevenlabsVoiceId,
      ownerUserId: req.ownerUserId,
      categories: CLONE_PRERENDER_CATEGORIES,
      languageOverride: normalizeSynthesisLanguage(req.language),
      isClone: true,
      relationshipLabel,
      listenerTitle,
      styleReference,
      speechStyle,
      claimToken: req.claimToken,
    });
  }
  return out;
}

/**
 * 아직 생성되지 않은 (보이스 × 카테고리 × 언어) 조합. voices 를 주면 그 목록으로,
 * 안 주면 시스템 보이스 전체로 계산한다. 대상 보이스 id 로 기존 클립 조회를 스코프해
 * 전유저 is_preset 스캔(CPU/메모리 폭증)을 피한다.
 */
export async function findMissingStockTargets(
  db: Client,
  voices?: PrerenderVoice[],
  /**
   * **목소리 교체 회차**. true 면 "이미 있는 것" 을 건너뛰지 않고 **전부** 대상으로 삼고,
   * 각 target 에 `refreshExisting` 을 실어 보낸다.
   *
   * ⚠ 이게 없으면 교체가 조용히 아무 일도 안 한다 — 교체 대상은 클립이 이미 다 있어서
   * '빠진 것' 이 0이고, cron 이 곧바로 `markPrerenderDone` 으로 끝내 버린다.
   */
  refreshExisting = false,
): Promise<StockClipTarget[]> {
  const prerenderVoices = voices ?? systemPrerenderVoices(await listSystemVoices(db));
  if (prerenderVoices.length === 0) return [];

  const voiceIds = prerenderVoices.map((voice) => voice.id);
  const ph = voiceIds.map(() => '?').join(',');
  const existing = await db.execute({
    sql: `SELECT m.voice_profile_id, m.category, m.language, m.variant,
                 ga.provider_voice_id AS published_provider_voice_id
          FROM messages m
          LEFT JOIN generated_audio_assets ga
            ON ga.message_id = m.id AND ga.audio_url = m.audio_url
          WHERE COALESCE(m.is_preset, 0) = 1 AND m.audio_url IS NOT NULL
            -- 은퇴한 행은 '있다' 로 세지 않는다 → 새 대사가 **새 id 로** 다시 구워진다.
            AND m.retired_at IS NULL
            AND m.voice_profile_id IN (${ph})`,
    args: voiceIds,
  });
  const voiceById = new Map(prerenderVoices.map((voice) => [voice.id, voice]));
  const seen = new Set(
    existing.rows
      .filter((row) => {
        if (!refreshExisting) return true;
        const voice = voiceById.get(String(row.voice_profile_id));
        // 교체 배치는 여러 cron/advance 호출에 걸친다. 지금 프로필의 새 provider 로 이미
        // 게시된 행만 완료로 세야 앞쪽 클립을 매번 다시 만드는 무한 루프가 생기지 않는다.
        return voice?.elevenlabsVoiceId === String(row.published_provider_voice_id ?? '');
      })
      .map(
      (row) =>
        `${row.voice_profile_id}|${row.category}|${row.language}|${Number(row.variant ?? 0)}`,
      ),
  );

  const targets: StockClipTarget[] = [];
  for (const voice of prerenderVoices) {
    // 클론=CLONE_CLIP_SEEDS(의미 seed → 관계/호칭 톤 적응 생성, 언어는 확정 시점 앱 언어 1개),
    // 시스템=STOCK_CLIP_PRESETS(언어별 확정 리터럴 — 번역/태깅 없이 그대로 합성).
    const sources = voice.isClone
      ? CLONE_CLIP_SEEDS.map((s) => ({
          category: s.category,
          defaultTag: s.defaultTag as string | undefined,
          perLanguage: [{ language: voice.languageOverride ?? 'ko', entries: s.seeds }],
        }))
      : STOCK_CLIP_PRESETS.map((p) => {
          const texts = p.texts as Record<string, readonly string[]>;
          const languages = voice.languageOverride ? [voice.languageOverride] : Object.keys(texts);
          return {
            category: p.category,
            defaultTag: undefined as string | undefined,
            // languageOverride 언어의 리터럴이 없으면 빈 배열 → 해당 조합은 생성하지 않는다.
            perLanguage: languages.map((language) => ({
              language,
              entries: texts[language] ?? [],
            })),
          };
        });
    for (const source of sources) {
      if (!voice.categories.includes(source.category)) continue;
      for (const { language, entries } of source.perLanguage) {
        const lang = normalizeSynthesisLanguage(language);
        entries.forEach((entry, variantIndex) => {
          if (seen.has(`${voice.id}|${source.category}|${lang}|${variantIndex}`)) return;
          targets.push({
            voiceProfileId: voice.id,
            voiceName: voice.name,
            elevenlabsVoiceId: voice.elevenlabsVoiceId,
            ownerUserId: voice.ownerUserId,
            category: source.category,
            baseText: entry,
            language: lang,
            variantIndex,
            toneAdapt: Boolean(voice.isClone),
            relationshipLabel: voice.relationshipLabel ?? null,
            listenerTitle: voice.listenerTitle ?? null,
            defaultTag: source.defaultTag,
            styleReference: voice.styleReference ?? null,
            speechStyle: voice.speechStyle ?? null,
            refreshExisting,
            claimToken: voice.claimToken,
          });
        });
      }
    }
  }
  return sortTargetsByFirstUse(targets);
}

/**
 * **먼저 쓸 것부터 만든다** — 21개가 다 있어야 알람을 만들 수 있는 게 아니다.
 *
 * 사전렌더는 5분 주기 cron 배치라 풀셋이 채워지기까지 십수 분이 걸린다. 그동안 사용자가
 * 실제로 부딪히는 것은 **처음 고르는 문구 하나**뿐인데, 예전에는 시드 선언 순서(날씨 9개
 * 먼저)로 만들어서 인사말 하나 들으려고 날씨 아홉 개를 기다렸다.
 *
 * 순서 근거:
 *  - `greeting` — 목소리 미리듣기이자 '기본 인사말' 알람이다. 1개뿐이고 제일 먼저 눌린다.
 *  - `medication` — 무료/기본 경로의 첫 버킷(`FreeBucketOrder` 첫 값 '약')과 같은 순서.
 *  - `weather` — 그다음으로 많이 쓰는 생성형 문구.
 *  - `love`/`fortune` — 나머지는 조용히 채운다.
 *
 * 같은 카테고리 안에서는 선언 순서(variant)를 지킨다 — 날씨 variant 는 조건 인덱스라
 * 순서가 계약이고, 정렬은 **안정 정렬**이어야 그 계약이 유지된다.
 */
const FIRST_USE_CATEGORY_ORDER: readonly string[] = [
  STOCK_GREETING_CATEGORY,
  'medication',
  'weather',
  'cheer',
  'fortune',
];

function sortTargetsByFirstUse(targets: StockClipTarget[]): StockClipTarget[] {
  const rank = (category: string): number => {
    const index = FIRST_USE_CATEGORY_ORDER.indexOf(category);
    // 목록에 없는 카테고리(나중에 추가된 것)는 맨 뒤로 — 순서를 모르면 미루는 쪽이 안전하다.
    return index < 0 ? FIRST_USE_CATEGORY_ORDER.length : index;
  };
  // Array.prototype.sort 는 안정 정렬이 보장된다(ES2019+). 같은 카테고리의 variant 순서가
  // 그대로 남아야 날씨 조건 인덱스 계약이 깨지지 않는다.
  return [...targets].sort((a, b) => rank(a.category) - rank(b.category));
}

/**
 * 사전렌더 큐에 유료 클론 목소리를 적재. voice_profile_id PK 라 이미 있으면 무시(멱등) —
 * 재확정/훅 중복 트리거가 있어도 큐가 1행으로 유지되고, 이미 done 인 목소리를 다시 pending
 * 으로 되돌려 재합성 낭비를 만들지 않는다(문구변경 재렌더는 follow-up).
 */
export async function enqueuePrerender(
  db: DbExecutor,
  voiceProfileId: string,
  ownerUserId: string,
  language: string,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language)
          VALUES (?, ?, ?)
          ON CONFLICT(voice_profile_id) DO NOTHING`,
    args: [voiceProfileId, ownerUserId, normalizeSynthesisLanguage(language)],
  });
}

/** cron 이 드레인할 pending 큐 항목을 15분 임대로 원자적 claim. limit 은 1..50 로 클램프. */
export async function claimPendingPrerenderVoices(
  db: Client,
  limit: number,
): Promise<PrerenderClaim[]> {
  const claimToken = crypto.randomUUID();
  const res = await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET claimed_at = datetime('now'), claim_token = ?, updated_at = datetime('now')
          WHERE voice_profile_id IN (
            SELECT voice_profile_id
            FROM voice_prerender_queue
            WHERE status = 'pending'
              AND (claimed_at IS NULL OR claimed_at <= datetime('now', '-15 minutes'))
            ORDER BY requested_at ASC
            LIMIT ?
          )
            AND status = 'pending'
            AND (claimed_at IS NULL OR claimed_at <= datetime('now', '-15 minutes'))
          RETURNING voice_profile_id, owner_user_id, language, claim_token, refresh_existing`,
    args: [claimToken, Math.max(1, Math.min(Math.trunc(limit), 50))],
  });
  return res.rows.map((row) => ({
    voiceProfileId: String(row.voice_profile_id),
    ownerUserId: String(row.owner_user_id),
    language: String(row.language),
    claimToken: String(row.claim_token),
    refreshExisting: Number(row.refresh_existing ?? 0) === 1,
  }));
}

export type PrerenderClaim = {
  readonly voiceProfileId: string;
  readonly ownerUserId: string;
  readonly language: string;
  readonly claimToken: string;
  /** 목소리 교체 회차 — 기존 preset 을 건너뛰지 않고 덮어쓴다. */
  readonly refreshExisting: boolean;
};

export async function releasePrerenderClaim(
  db: Client,
  voiceProfileId: string,
  claimToken: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET claimed_at = NULL, claim_token = NULL, updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'pending' AND claim_token = ?`,
    args: [voiceProfileId, claimToken],
  });
}

/** 해당 목소리의 사전렌더 완료 표시(missing 이 0이 됐을 때). */
export async function markPrerenderDone(
  db: Client,
  voiceProfileId: string,
  claimToken: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET status = 'done', claimed_at = NULL, claim_token = NULL, updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'pending' AND claim_token = ?`,
    args: [voiceProfileId, claimToken],
  });
}

/** 제자리 교체 완료 뒤 소유자 기기와 공유 사용자들의 매니페스트 재조회를 깨운다. */
export async function notifySharedVoicePrerenderComplete(
  db: Client,
  env: Env,
  voiceProfileId: string,
  ownerUserId: string,
): Promise<void> {
  const recipientUserIds = new Set([ownerUserId]);
  const shared = await db.execute({
    sql: `SELECT 1 FROM voice_profiles
          WHERE id = ? AND deleted_at IS NULL AND COALESCE(is_shared, 0) = 1
          LIMIT 1`,
    args: [voiceProfileId],
  });
  if (shared.rows.length > 0) {
    const members = await db.execute({
      sql: `SELECT DISTINCT m2.user_id
            FROM plan_group_members m1
            JOIN plan_group_members m2 ON m2.plan_group_id = m1.plan_group_id
            WHERE m1.user_id = ? AND m2.user_id != ?`,
      args: [ownerUserId, ownerUserId],
    });
    for (const row of members.rows) recipientUserIds.add(String(row.user_id));
  }
  await sendVoiceShareChangedPush(db, env, Array.from(recipientUserIds));
}

/** 사전렌더 실패 1회 기록. attempts 상한(5) 초과 시 failed 로 내려 무한 재시도를 막는다. */
export async function markPrerenderFailed(
  db: Client,
  voiceProfileId: string,
  claimToken: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
              claimed_at = NULL,
              claim_token = NULL,
              updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'pending' AND claim_token = ?`,
    args: [voiceProfileId, claimToken],
  });
}

/**
 * 사전렌더 큐를 한 번 드레인한다 — **cron 틱과 등록 직후가 같은 코드를 쓴다.**
 *
 * 예전에는 이 루프가 `index.ts` 의 cron 안에만 있었고, 등록은 큐에 넣고 **다음 틱(최대
 * 5분)을 그냥 기다렸다.** 21개를 틱당 6개씩 채우니 사용자는 십수 분을 기다렸는데, 그중
 * 첫 5분은 아무것도 하지 않는 순수 대기였다. 이제 등록 응답이 `waitUntil` 로 첫 배치를
 * 바로 돌린다(`runPrerenderBatch(..., { voiceProfileId })`).
 *
 * 한 클립이 실패해도 그 목소리의 나머지를 버리지 않는다. 진전이 있으면 pending 을 유지해
 * 다음 틱이 이어받고, **진전 0 + 에러**일 때만 attempts 를 올린다(영구 실패 클립의 무한
 * 재시도 방지). 서브리퀘스트 예산이 소진되면 즉시 멈춘다 — 남은 시도는 전부 같은 오류다.
 */
export async function runPrerenderBatch(
  db: Client,
  env: Env,
  options: {
    /** 이번 배치에서 만들 클립 수 상한. */
    maxClips: number;
    /** 동시에 손댈 목소리 수 상한. */
    maxVoices?: number;
    /** 클립 1개 실패를 관측자에게 알린다(cron 은 Sentry 로 보낸다). */
    onClipError?: (error: unknown) => void;
  },
): Promise<{ claimed: number; rendered: number }> {
  const maxClips = Math.max(1, Math.trunc(options.maxClips));
  const claimed = await claimPendingPrerenderVoices(db, Math.max(1, Math.trunc(options.maxVoices ?? 5)));
  if (claimed.length === 0) return { claimed: 0, rendered: 0 };

  const cloneVoices = await listReadyCloneVoices(db, claimed);
  const claimByVoiceId = new Map(claimed.map((request) => [request.voiceProfileId, request]));
  // 큐엔 있으나 ready 클론이 아닌 항목(삭제/실패/draft 등)은 실패 처리해 무한 pending 을 막는다.
  const readyIds = new Set(cloneVoices.map((v) => v.id));
  for (const req of claimed) {
    if (!readyIds.has(req.voiceProfileId)) {
      await markPrerenderFailed(db, req.voiceProfileId, req.claimToken);
    }
  }

  let rendered = 0;
  let subrequestExhausted = false;
  for (const voice of cloneVoices) {
    if (subrequestExhausted) break;
    const claim = claimByVoiceId.get(voice.id);
    if (!claim) continue;
    if (await missingConsentType(db, claim.ownerUserId, SENSITIVE_REQUIRED_CONSENTS)) {
      await markPrerenderFailed(db, voice.id, claim.claimToken);
      continue;
    }
    if (rendered >= maxClips) {
      await releasePrerenderClaim(db, voice.id, claim.claimToken);
      continue;
    }
    // ⚠ 교체 회차면 **전부** 다시 렌더한다. 그냥 두면 '빠진 것' 이 0이라
    // 곧바로 done 으로 끝나고 목소리가 바뀌지 않는다.
    const targets = await findMissingStockTargets(db, [voice], claim.refreshExisting);
    if (targets.length === 0) {
      await markPrerenderDone(db, voice.id, claim.claimToken);
      if (claim.refreshExisting) {
        await notifySharedVoicePrerenderComplete(db, env, voice.id, claim.ownerUserId);
      }
      continue;
    }
    let voiceRendered = 0;
    let voiceError = false;
    let superseded = false;
    for (const target of targets) {
      if (rendered >= maxClips) break;
      rendered += 1;
      try {
        await generateStockClip(db, env, target);
        voiceRendered += 1;
      } catch (genErr) {
        if (genErr instanceof PrerenderSupersededError) {
          // 더 새 교체가 이미 이겼다 — 이 목소리의 남은 대상도 전부 옛 목소리로 만들 것이라
          // 통째로 버린다. **실패가 아니므로** attempts 를 올리지 않고 관측자에게도 안 보낸다.
          superseded = true;
          break;
        }
        options.onClipError?.(genErr);
        voiceError = true;
        // 이 틱의 서브리퀘스트 한도가 소진되면 남은 시도는 전부 같은 오류다 — 즉시 중단해
        // 오류 반복을 줄인다. 뒤따르는 상태 갱신(DB 호출)도 실패할 수 있지만, 그 경우
        // 15분 임대 만료가 회수해 다음 틱에 재시도된다.
        if (String(genErr).includes('Too many subrequests')) {
          subrequestExhausted = true;
          break;
        }
      }
    }
    if (superseded) {
      // 내 토큰이면 임대만 반납하고, 이미 남의 것이면 no-op 다(둘 다 claim_token 가드).
      // **done 으로 끝내지 않는다** — 새 주인의 회차가 아직 남아 있다.
      await releasePrerenderClaim(db, voice.id, claim.claimToken);
      continue;
    }
    // 재조회 없이 판정: 이번 배치에 이 보이스의 남은 대상을 전부(에러 없이) 만들었으면 완료.
    if (voiceRendered === targets.length && !voiceError) {
      await markPrerenderDone(db, voice.id, claim.claimToken);
      if (claim.refreshExisting) {
        await notifySharedVoicePrerenderComplete(db, env, voice.id, claim.ownerUserId);
      }
    } else if (voiceError && voiceRendered === 0) {
      await markPrerenderFailed(db, voice.id, claim.claimToken);
    } else {
      await releasePrerenderClaim(db, voice.id, claim.claimToken);
    }
  }
  return { claimed: claimed.length, rendered };
}

/** 스톡 클립 삭제 필터. 비우면 전체(reset), 채우면 특정 보이스(+카테고리)만. */
export interface DeleteStockClipsFilter {
  /** elevenlabs_voice_id 로 특정 시스템 보이스만 한정. */
  elevenlabsVoiceId?: string;
  /** category 로 한정 (예: 'greeting'). elevenlabsVoiceId 와 함께 쓰면 보이스의 해당 클립만. */
  category?: string;
}

/**
 * 스톡 클립 삭제 (문구를 바꿔 재생성할 때 사용). 필터가 없으면 전체(reset),
 * 있으면 특정 보이스(+카테고리)만 지운다. messages·generated_audio_assets·
 * message_library 행과 R2 오브젝트를 정리하고, 혹시 이 클립을 참조하던 알람은
 * sound-only 로 떼어낸다. dev 반복용.
 */
export async function deleteStockClips(
  db: Client,
  env: Env,
  filter: DeleteStockClipsFilter = {},
): Promise<number> {
  const conditions = [
    'COALESCE(m.is_preset, 0) = 1',
    // 은퇴 행은 **일부러 남겨 둔 것**이다(옛 알람의 인가·오디오). 재시드 도구가 지우면
    // 그 알람들이 재설치 때 소리를 잃는다.
    'm.retired_at IS NULL',
    `m.voice_profile_id IN (
       SELECT id FROM voice_profiles
       WHERE COALESCE(is_system, 0) = 1
       ${filter.elevenlabsVoiceId ? 'AND elevenlabs_voice_id = ?' : ''}
     )`,
  ];
  const selectArgs: string[] = [];
  if (filter.elevenlabsVoiceId) selectArgs.push(filter.elevenlabsVoiceId);
  if (filter.category) {
    conditions.push('m.category = ?');
    selectArgs.push(filter.category);
  }

  const rows = await db.execute({
    sql: `SELECT m.id AS message_id, ga.audio_object_key AS audio_object_key
          FROM messages m
          LEFT JOIN generated_audio_assets ga ON ga.message_id = m.id
          WHERE ${conditions.join(' AND ')}`,
    args: selectArgs,
  });
  const ids = Array.from(new Set(rows.rows.map((r) => String(r.message_id))));
  if (ids.length === 0) return 0;

  if (env.VOICE_BUCKET) {
    const storage = new R2VoiceStorage(env.VOICE_BUCKET);
    for (const r of rows.rows) {
      const key = r.audio_object_key;
      if (typeof key === 'string' && key) {
        try {
          await storage.delete(key);
        } catch {
          // R2 삭제 실패해도 DB 정리는 계속
        }
      }
    }
  }

  const ph = ids.map(() => '?').join(',');
  // 이 클립을 쓰던 알람은 음성 떼고 sound-only 로 (FK·런타임 안전).
  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only', wake_mode = 'sound_then_voice',
              message_id = NULL, voice_profile_id = NULL
          WHERE message_id IN (${ph})`,
    args: ids,
  });
  await db.execute({ sql: `DELETE FROM message_library WHERE message_id IN (${ph})`, args: ids });
  await db.execute({
    sql: `DELETE FROM generated_audio_assets WHERE message_id IN (${ph})`,
    args: ids,
  });
  await db.execute({ sql: `DELETE FROM messages WHERE id IN (${ph})`, args: ids });
  return ids.length;
}

/** 전체 스톡 클립 삭제 (reset). deleteStockClips 의 무필터 호출. */
export async function deleteAllStockClips(db: Client, env: Env): Promise<number> {
  return deleteStockClips(db, env);
}

/** 표시용 텍스트에서 [tag] 마커 제거 (앱에는 태그 없이 보여준다). */
function stripDeliveryTags(text: string): string {
  return text
    // ⚠ 문자셋을 여기 다시 쓰지 말 것 — `TAG_BODY_PATTERN`(vertex-translate)에서 파생한다.
    // 넷이 따로 놀던 시절에는 하나만 넓히면 "태그로 인식은 되는데 안 벗겨지는" 상태가 됐다.
    .replace(new RegExp(`\\[${TAG_BODY_PATTERN}\\]`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * **내 렌더는 낡았다 — 게시하지 않고 버렸다.**
 *
 * 실패(`markPrerenderFailed`)와 **구분한다**. 실패는 attempts 를 올려 5회에서 `failed` 로
 * 내려앉지만, 이건 "그 사이 더 새 교체가 큐를 가져갔다" 는 뜻이라 이 회차만 버리면 된다.
 * 큐는 새 주인의 것이므로 done/failed 로 끝내지 말고 **아무것도 하지 않고 물러난다.**
 */
export class PrerenderSupersededError extends Error {
  constructor(message = 'Voice prerender render was superseded by a newer replacement.') {
    super(message);
    this.name = 'PrerenderSupersededError';
  }
}

/**
 * 스톡 클립 1개 생성: Vertex 로 문구/번역/태그 → ElevenLabs 합성 → R2 저장 →
 * messages(is_preset=1) + generated_audio_assets insert. 멱등 보장은 호출자
 * (findMissingStockTargets) 가 담당한다.
 */
/**
 * 합성 요청에만 붙이는 **여운 꼬리**.
 *
 * ⚠ ElevenLabs v3 는 마지막 음소 직후 **그냥 멈춘다.** 실측(2026-09-02, 미나 목소리 20개):
 * API 원본의 끝 무음이 **0.020초**였고, 소리가 멈추는 순간의 세기가 파일 평균의 최대
 * **1.22배** — 한창 말하는 크기에서 뚝 끊긴다. 특히 한국어 **상승조 의문문**("…해 볼까요?")
 * 이 심하다. 끝을 올리다 정점에서 멈추기 때문이다.
 *
 * `appendMp3TrailingSilence` 로는 못 고친다. 그건 `높은 에너지 → 0` 이라는 **계단을 그대로
 * 두고** 뒤에 조용함을 더할 뿐이라, 오히려 계단이 도드라진다.
 *
 * 문장 끝에 말줄임을 붙이면 모델이 **여운 자체를 생성한다** — 같은 문장으로 실측했을 때
 * 끝 무음이 0.020초 → **1.289초**로, 문장을 끝맺고 놓는 소리가 실제로 나온다.
 *
 * ⚠ **요청에만 붙이고 저장하지 않는다.** `synthesisText` 는 `messages.synthesis_text` 로
 * 저장되고 캐시 키·마이그레이션의 문구 대조에 쓰인다 — 꼬리를 섞으면 그 대조가 어긋나
 * 재시드가 옛 문구를 지우지 못한다.
 *
 * ⚠ 이미 말줄임으로 끝나면 덧붙이지 않는다(모델이 길게 늘어뜨린다).
 */
function withClosingBreath(text: string): string {
  const base = text.trimEnd();
  if (!base || /(\.\.\.|…)$/.test(base)) return base;
  return `${base} ...`;
}

export async function generateStockClip(
  db: Client,
  env: Env,
  target: StockClipTarget,
): Promise<GeneratedStockClip> {
  if (!env.VOICE_BUCKET) {
    throw new Error('VOICE_BUCKET (R2) is not configured.');
  }
  const assertCloneAuthorization = async () => {
    if (!target.toneAdapt) return;
    if (!target.claimToken) throw new Error('Voice prerender claim token is missing.');
    const authorized = await db.execute({
      sql: `SELECT vp.id FROM voice_profiles vp
            JOIN voice_prerender_queue q ON q.voice_profile_id = vp.id
            WHERE vp.id = ? AND vp.deleted_at IS NULL AND vp.status = 'ready'
              AND COALESCE(vp.is_draft, 0) = 0 AND q.owner_user_id = ?
              AND q.status = 'pending' AND q.claim_token = ?`,
      args: [target.voiceProfileId, target.ownerUserId, target.claimToken],
    });
    if (authorized.rows.length === 0) throw new Error('Voice prerender authorization expired.');
    if (await missingConsentType(db, target.ownerUserId, SENSITIVE_REQUIRED_CONSENTS)) {
      throw new Error('Voice prerender consent was withdrawn.');
    }
  };
  await assertCloneAuthorization();
  const language = normalizeSynthesisLanguage(target.language);

  let synthesisText: string;
  let displayText: string;
  let deliveryTagsJson: string;
  if (target.toneAdapt) {
    // 유료 클론: baseText 를 '의미 seed' 로 보고 그 목소리의 관계/호칭/말투에 맞춰 문구 생성.
    // 실패 시 throw → 호출자(cron)가 재시도(나쁜 폴백 문구를 저장하지 않는다).
    const generated = await generatePrerenderClipText(env, {
      seed: target.baseText,
      relationshipLabel: target.relationshipLabel,
      listenerTitle: target.listenerTitle,
      targetLanguage: language,
      defaultTag: target.defaultTag,
      styleReference: target.styleReference,
      speechStyle: target.speechStyle ?? null,
    });
    // ⚠ **여기서 태그를 다시 붙이지 말 것**(2026-08-20). `generatePrerenderClipText` 가
    // 이미 배치를 확정해서 돌려준다 — 모델이 문장 안에 여러 개를 넣었으면 그대로, 없거나
    // 선두 하나뿐이면 문장마다 다시 앞세운 형태다. 여기서 한 번 더 `applyDeliveryTagPerSentence`
    // 를 태우면 `[warmly] [warmly] …` 로 겹친다.
    synthesisText = generated.text;
    // 표시 문구(잠금화면·요약)는 **태그를 벗긴 것**이다. 예전에는 모델이 태그를 안 냈기에
    // 그냥 써도 티가 안 났지만, 인라인 태그가 들어오면 대괄호가 그대로 화면에 새어 나간다.
    displayText = stripDeliveryTags(generated.text) || generated.text;
    deliveryTagsJson = JSON.stringify(extractDeliveryTags(generated.text));
  } else {
    // 시스템 스톡: baseText 가 이미 확정된 언어별 리터럴(딜리버리 태그 포함)이다.
    // translate/autoTag 를 끄면 Vertex 호출 없이 로컬 패스스루로 태그만 추출된다
    // → 재시드해도 항상 STOCK_CLIP_PRESETS 문구 그대로 합성된다.
    const prepared = await prepareAlarmTextWithVertex(env, target.baseText, {
      targetLanguage: language,
      sourceLanguage: language,
      translate: false,
      autoTag: false,
    });
    synthesisText = prepared.text;
    displayText = stripDeliveryTags(synthesisText) || stripDeliveryTags(target.baseText);
    deliveryTagsJson = JSON.stringify(prepared.tags);
  }

  // ⚠ **제공자에게 보내는 바로 그 글자로 캐시 키를 만든다**(2026-09-03 리뷰).
  //   합성은 여운 꼬리를 붙여 하는데 키를 원본으로 계산하면, **같은 키에 다른 오디오**가
  //   매달린다 — 일반 TTS 경로(`tts.ts`)는 꼬리 없이 같은 문장을 합성하므로 둘이 같은
  //   `request_hash`·R2 오브젝트를 놓고 다툰다. 먼저 쓴 쪽이 이기고, 나중 쪽은 자기가
  //   요청한 것과 다른 소리를 서빙받는다(꼬리가 사라지거나, 반대로 남의 클립을 덮어쓴다).
  //   저장되는 `synthesis_text`·표시 문구는 **꼬리 없는 원본** 그대로다 — 잠금화면 문구와
  //   문구 대조가 그 값을 쓴다.
  const providerText = withClosingBreath(synthesisText);
  const attempts = createSynthesisAttempts({
    env,
    profile: { elevenlabs_voice_id: target.elevenlabsVoiceId },
    text: providerText,
    language,
  });
  if (attempts.length === 0) {
    throw new Error('No synthesis provider available (ELEVENLABS_API_KEY missing?)');
  }
  const attempt = attempts[0]!;

  const cacheKey = await computeTtsCacheKey({
    provider: attempt.provider,
    providerVoiceId: attempt.providerVoiceId,
    voiceProfileId: target.voiceProfileId,
    modelId: attempt.modelId,
    language,
    languageCode: language,
    text: providerText,
    outputFormat: attempt.outputFormat,
  });

  const generated = await attempt.synthesize();
  // v3 급마감(마지막 음절 직후 뚝 끊김) 보완 — 끝에 0.366초 무음을 붙인다(시딩본과 동일).
  // 형식이 mp3_44100_128(mono)이 아니면 안전하게 원본 그대로 저장된다.
  const bytes = appendMp3TrailingSilence(generated.bytes);
  await assertCloneAuthorization();

  const storage = new R2VoiceStorage(env.VOICE_BUCKET);
  const audioObjectKey = generatedTtsObjectKey(
    target.ownerUserId,
    cacheKey,
    generated.outputFormat,
  );
  await storage.storeAtKey(audioObjectKey, {
    bytes,
    userId: target.ownerUserId,
    mimeType: generated.mimeType,
    originalName: `stock_${cacheKey}.${generated.outputFormat}`,
  });
  const audioUrl = `r2://${audioObjectKey}`;
  const discardStagedAudio = async () => {
    try {
      await storage.delete(audioObjectKey);
    } catch {
      await enqueueExternalDeletion(db, 'r2_object', audioObjectKey);
    }
  };

  const messageId = crypto.randomUUID();
  // 조건부 INSERT: 같은 (voice·category·language·variant) preset 이 이미 있으면 no-op. cron 이 겹쳐
  // 두 호출이 같은 target 을 동시에 렌더해도(findMissingStockTargets 는 순차 멱등만 보장) 중복 행이
  // 생기지 않는다. SQLite 단일 writer 라 INSERT…SELECT WHERE NOT EXISTS 가 원자적으로 직렬화된다.
  const publish = () =>
    withWriteTransaction(db, async (tx) => {
      if (
        target.toneAdapt &&
        (await missingConsentType(tx, target.ownerUserId, SENSITIVE_REQUIRED_CONSENTS))
      ) {
        throw new Error('Voice prerender consent was withdrawn.');
      }
    const insertedMessage = await tx.execute({
      sql: `INSERT INTO messages
          (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
           category, language, variant, is_preset, audio_url)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM messages
            WHERE voice_profile_id = ? AND category = ? AND language = ? AND variant = ?
              AND COALESCE(is_preset, 0) = 1
              -- 은퇴 행은 '이미 있다' 로 세지 않는다. 빠뜨리면 교체가 **조용히 아무 일도
              -- 안 한다** — INSERT 가 0행이 되고 아래 갈래가 옛 행을 게시본으로 돌려준다.
              AND retired_at IS NULL
          )
            AND (? = 0 OR EXISTS (
              SELECT 1 FROM voice_profiles vp
              JOIN voice_prerender_queue q ON q.voice_profile_id = vp.id
              WHERE vp.id = ? AND vp.deleted_at IS NULL AND vp.status = 'ready'
                AND COALESCE(vp.is_draft, 0) = 0
                AND vp.elevenlabs_voice_id = ?
                AND q.owner_user_id = ?
                AND q.status = 'pending' AND q.claim_token = ?
            ))`,
      args: [
        messageId,
        target.ownerUserId,
        target.voiceProfileId,
        displayText,
        synthesisText,
        deliveryTagsJson,
        target.category,
        language,
        target.variantIndex,
        audioUrl,
        target.voiceProfileId,
        target.category,
        language,
        target.variantIndex,
        target.toneAdapt ? 1 : 0,
        target.voiceProfileId,
        // 클레임 토큰만으로는 부족하다 — LRU 회수 뒤 복구(`voice-recover.ts`)는 큐를
        // 건드리지 않고 provider 보이스만 갈아 끼우므로, 유효한 토큰과 바뀐 세대가 공존한다.
        target.elevenlabsVoiceId,
        target.ownerUserId,
        target.claimToken ?? '',
      ],
    });

    if ((insertedMessage.rowsAffected ?? 0) === 0) {
      const existing = await tx.execute({
        sql: `SELECT id, text, audio_url FROM messages
              WHERE voice_profile_id = ? AND category = ? AND language = ? AND variant = ?
                AND COALESCE(is_preset, 0) = 1
                AND retired_at IS NULL
              LIMIT 1`,
        args: [target.voiceProfileId, target.category, language, target.variantIndex],
      });
      const row = existing.rows[0];
      // 게시할 preset 행도 없는데 INSERT 가 0행이면 조건은 하나뿐이다: 위 인가 EXISTS 가
      // 막았다(=클레임이 남의 것이거나 provider 보이스가 갈렸다). 교체 회차와 **같은 사건**
      // 이므로 같은 결말로 다룬다 — 실패로 세어 attempts 를 태우면, LRU 회수 뒤 복구처럼
      // 정상적인 세대 교체가 다섯 번 겹치는 것만으로 큐가 `failed` 로 주저앉는다.
      if (!row) return { superseded: true as const, publishedAudioUrl: '' };

      // ── 목소리 교체: 기존 preset 을 **덮어쓴다** ────────────────────────────
      // ⚠ **`message_id` 는 그대로 둔다.** 알람이 그 값을 가리키고 있어서, 새 행을
      // 만들면 알람이 옛 행에 남아 교체가 반영되지 않는다. id 를 유지한 채
      // `audio_url` 만 갈아끼우면 알람은 아무것도 눈치채지 못하고 소리만 바뀐다.
      //
      // ⚠ 기기 캐시는 키(`stock_<messageId>`)에 버전이 없어 message_id 만으로는 낡음을
      // 알 수 없다. 그래서 **새 R2 키**에 올리는 게 중요하다 — 앱이 `audio_url` 이
      // 달라진 것을 보고 다시 받는다(iOS `AudioCacheStore.isStale`).
      if (target.refreshExisting) {
        const existingMessageId = String(row.id);
        // ⚠ **게시 직전에 다시 확인한다.** 마지막 인가 검사(`assertCloneAuthorization`,
        // 합성 직후)와 이 커밋 사이에는 R2 업로드가 통째로 들어간다. 그 창에서 교체가 한 번
        // 더 일어나면(큐 리셋 → 새 claim → 새 provider voice) 이 렌더는 **옛 목소리**다.
        //
        // 위의 조건부 INSERT 에 붙은 claim 가드는 교체 회차에서 **작동하지 않는다** —
        // 같은 preset 이 이미 있어 `WHERE NOT EXISTS` 가 항상 거짓이라 0행이고, 그래서
        // 이 UPDATE 가 유일한 문지기다. 놓치면 옛 목소리가 새 목소리를 덮고, 아래
        // `replacedAudioUrl` 정리가 **방금 게시된 새 음원**을 R2 에서 지운다.
        const replaced = await tx.execute({
          sql: `UPDATE messages
                SET text = ?, synthesis_text = ?, delivery_tags_json = ?, audio_url = ?
                WHERE id = ?
                  AND EXISTS (
                    SELECT 1 FROM voice_profiles vp
                    JOIN voice_prerender_queue q ON q.voice_profile_id = vp.id
                    WHERE vp.id = ? AND vp.deleted_at IS NULL AND vp.status = 'ready'
                      AND COALESCE(vp.is_draft, 0) = 0
                      AND vp.elevenlabs_voice_id = ?
                      AND q.owner_user_id = ?
                      AND q.status = 'pending' AND q.claim_token = ?
                  )`,
          args: [
            displayText,
            synthesisText,
            deliveryTagsJson,
            audioUrl,
            existingMessageId,
            target.voiceProfileId,
            // 이 렌더를 만든 provider 보이스. 프로필이 그 사이 다른 보이스로 갈렸으면
            // (교체 또는 LRU 복구) 내 산출물은 낡은 것이다.
            target.elevenlabsVoiceId,
            target.ownerUserId,
            target.claimToken ?? '',
          ],
        });
        // `WHERE id = ?` 는 방금 같은 트랜잭션에서 SELECT 한 행이라 언제나 맞는다 —
        // 0행은 오직 위 EXISTS 가 막았다는 뜻이다.
        //
        // ⚠ **이긴 렌더가 게시한 주소를 함께 들고 나간다.** 캐시 키는 (provider·보이스·문구·
        // 형식) 해시라, 같은 보이스로 같은 문구를 만든 두 회차는 **같은 오브젝트 키**가 된다
        // (클레임만 바뀐 경우 — advance 가 cron 클레임을 인수하는 경로가 실제로 그렇다).
        // 그때 내 것이라고 지우면 방금 게시된 음원을 지운다. 아래 형제 가드
        // (`publication.audioUrl !== audioUrl`)가 막는 것과 같은 우연이다.
        if ((replaced.rowsAffected ?? 0) === 0) {
          return { superseded: true as const, publishedAudioUrl: String(row.audio_url ?? '') };
        }
        // 오디오 대장에도 새 렌더를 남긴다. `request_hash` 가 UNIQUE 라 같은 해시가 이미
        // 있으면(같은 목소리·같은 문구) 무시된다 — 교체는 provider voice id 가 달라
        // 해시가 반드시 갈라지므로 정상적으로 새 행이 생긴다.
        await tx.execute({
          sql: `INSERT OR IGNORE INTO generated_audio_assets
                (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                 model_id, language, request_hash, text,
                 audio_url, audio_object_key, audio_format)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            crypto.randomUUID(),
            target.ownerUserId,
            target.voiceProfileId,
            existingMessageId,
            generated.provider,
            generated.providerVoiceId,
            generated.modelId,
            language,
            cacheKey,
            synthesisText,
            audioUrl,
            audioObjectKey,
            generated.outputFormat,
          ],
        });
        return {
          inserted: false as const,
          messageId: existingMessageId,
          text: displayText,
          audioUrl,
          // 덮어쓰기 전 값 — 커밋 뒤 이 오브젝트를 지운다(아래 참조).
          replacedAudioUrl: String(row.audio_url ?? ''),
        };
      }

      return {
        inserted: false as const,
        messageId: String(row.id),
        text: String(row.text ?? displayText),
        audioUrl: String(row.audio_url ?? ''),
      };
    }

    await tx.execute({
      sql: `INSERT OR IGNORE INTO generated_audio_assets
            (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
             model_id, language, request_hash, text,
             audio_url, audio_object_key, audio_format)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        target.ownerUserId,
        target.voiceProfileId,
        messageId,
        generated.provider,
        generated.providerVoiceId,
        generated.modelId,
        language,
        cacheKey,
        synthesisText,
        audioUrl,
        audioObjectKey,
        generated.outputFormat,
      ],
    });
    return { inserted: true as const, messageId, text: displayText, audioUrl };
    });
  let publication: Awaited<ReturnType<typeof publish>>;
  try {
    publication = await publish();
  } catch (error) {
    await discardStagedAudio();
    throw error;
  }

  if ('superseded' in publication) {
    // 내가 만든 오브젝트만 치운다 — 새 렌더가 이미 앉혀 둔 음원은 **절대 건드리지 않는다.**
    // 두 회차의 키가 우연히 같으면(같은 보이스·같은 문구) 그 오브젝트는 이제 **이긴 쪽의
    // 것**이라 지우면 안 된다.
    if (publication.publishedAudioUrl !== audioUrl) await discardStagedAudio();
    throw new PrerenderSupersededError();
  }
  // ⚠ **교체 회차에서는 여기 걸리면 안 된다.** 이 가드는 "이미 다른 렌더가 이겼으니 내가
  // 만든 오브젝트는 쓰레기다" 를 뜻한다. 교체는 방금 만든 audioUrl 을 그대로 게시하므로
  // 두 값이 같아 통과한다 — `publication.audioUrl` 을 옛 값으로 돌려주도록 바꾸면
  // **방금 심은 음원을 지워** 알람이 빈 URL 을 물게 되니 주의.
  if (!publication.inserted && publication.audioUrl !== audioUrl) {
    await discardStagedAudio();
  }

  // 교체로 밀려난 옛 오브젝트를 정리한다. 커밋이 끝난 뒤에 한다 — R2 삭제는 트랜잭션이
  // 아니라, 롤백되는 트랜잭션 안에서 지우면 되살릴 수 없는 것을 먼저 잃는다.
  const replacedAudioUrl = (publication as { replacedAudioUrl?: string }).replacedAudioUrl;
  if (replacedAudioUrl && replacedAudioUrl !== audioUrl && replacedAudioUrl.startsWith('r2://')) {
    const staleKey = replacedAudioUrl.slice('r2://'.length);
    try {
      await new R2VoiceStorage(env.VOICE_BUCKET).delete(staleKey);
    } catch {
      // 지우지 못해도 교체 자체는 성공이다 — 큐에 넘겨 나중에 치운다.
      await enqueueExternalDeletion(db, 'r2_object', staleKey);
    }
  }

  return {
    message_id: publication.messageId,
    voice_profile_id: target.voiceProfileId,
    voice_name: target.voiceName,
    category: target.category,
    language,
    variant: target.variantIndex,
    text: publication.text,
  };
}
