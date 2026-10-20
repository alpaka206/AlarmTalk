#!/usr/bin/env python3
"""코드를 쳐서 유료 기능을 여는 길(선물·프로모·쿠폰·초대 코드)이 **화면 문구·코드·스토어 문구로 돌아오지 않게** 막는다.

## 왜 있는가

App Store 가 심사 지침 3.1.1("인앱 결제가 아닌 수단으로 기능을 열면 안 된다")로 두 번 반려했다. iOS 1.2.11 은 프로모
코드, 1.2.12 는 선물 코드였다(둘 다 2026-10-12). 첫 번째 때 **사례**(프로모 코드)만 지우고 같은 **종류**(선물 — 산
사람은 스토어로 냈어도 받는 사람은 코드를 쳐서 연다)를 남긴 것이 두 번째 반려의 원인이다. 스토어 설명과 심사 노트도
그 기능을 직접 내보였다. 지침 3.1.1 은 라이선스 키·QR 코드도 같은 것으로 든다.

규칙의 유일 출처는 `docs/spec/plan-gates.md` 「선물 코드 — 폐지」·「커플·가족 이용권 — 폐지」 다. 코드로 유료 기능을
얻는 길은 **없다** — 마지막으로 남았던 초대 코드(INV-, 커플·가족 그룹 합류)도 2026-10-20 에 커플·가족 이용권과 함께
없앴다. 할인·무료 이용은 스토어 오퍼 코드로 준다. 규칙을 문서에만 두면 다음 사람이 '쿠폰'·'체험 코드' 같은 새 이름으로
같은 것을 다시 만든다 — 그래서 낱말과 형식을 CI 에서 막는다. 서버가 받지 않는 것이 실질 차단이고(옛 앱이 남는다 —
옛 앱의 코드 등록은 서버가 언제나 `CODE_NOT_FOUND` 로 답한다), 이 검사는 그 차단이 다시 풀리는 변경을 머지 전에 잡는
그물이다.

## 무엇을 보는가

(a) **두 앱의 화면 문구** — 아래 「어휘」 를 찾는다.
    - iOS: `apps/ios-native/` 아래 모든 `*.xcstrings` 의 키와, 모든 언어의 값(`variations`·`substitutions` 안까지).
      키는 한국어 원문이라 그대로 화면에 나온다. 다만 점으로 이은 식별자 키(`code.redeem.submit` 꼴)는 화면에 나오지
      않으므로 그 키는 건너뛰고 값만 본다. `comment` 는 번역자용이라 보지 않는다.
    - Android: `app/src/<테스트가 아닌 소스 세트>/res/values*/*.xml` 의 `<string>`·`<plurals>/<item>`·
      `<string-array>/<item>` 의 글. `name` 속성(`code_redeem_placeholder` 같은 키)과 XML 주석은 화면에 나오지
      않으므로 보지 않는다.
(b) **앱·서버 코드** — 은퇴한 선물 상품 id(`personal_gift`·`personalGift`), 선물 코드 형식(`GIFT-…` 와 `(INV|GIFT)`·
    `'GIFT'` 같은 접두), 선물 종류 문자열(`'gift'`), 선물 에러 코드(`GIFT_PERSONAL_ONLY`·`INVALID_GIFT_PLAN`),
    **이름 속의 gift**(「선물 식별자」 — `giftCode`·`sendGift`·`gift_code`·`IS_GIFT`), 그리고 은퇴한 커플·가족 상품 id
    (「그룹 상품 id」 — `couple_monthly`·`family_monthly`·`coupleMonthly`·`FAMILY_MONTHLY`, 연간 id 도)와 초대 코드를
    만들던 경로(「초대 코드 발급 경로」 — `family-share`). 스토어에 그 상품이 다시 붙으면 3.1.1 과 별개로, 정원·합류를
    다룰 코드가 이제 없어 결제만 받고 아무것도 열지 못한다.
    - 대상: iOS `AlarmTalk`·`AlarmTalkWidget`·`Shared` 의 `*.swift` 와 `apps/ios-native/**/*.storekit`, Android
      `app/src/<테스트가 아닌 소스 세트>/**/*.kt`, `packages/backend/src`·`packages/backend/scripts`·`packages/shared/src`
      의 `*.ts`.
    - **주석은 지우고 본다.** 지운 자리마다 '되살리지 말 것' 경고 주석이 은퇴한 이름을 대기 때문이다. 문자열 안의
      `//`·`/*` 는 주석이 아니다(문자열은 그대로 본다 — 상품 id 는 문자열로 돌아온다).
    - 「선물 식별자」 는 **대소문자를 가린다** — 이름을 짓는 방식(camelCase·PascalCase·snake_case·SCREAMING_CASE)마다
      gift 가 한 낱말로 설 때만 걸린다. 소문자 `gift` 는 앞이 소문자가 아닐 때(`giftCode`·`apple_gift_…`·`body.gift`),
      `Gift` 는 어디서든(낙타 등 — `sendGift`·`'Gift checkout'`), `GIFT` 는 앞뒤가 대문자가 아닐 때(`GIFT_CODE`·
      `IS_GIFT`). 대소문자를 무시하면 `stopRingingIfThisAlarm` 의 'gIfT' 가 걸린다(2026-10-14 맞춰 보다가 실제로 걸렸다).
      낱말 뒤는 보지 않는다 — gift 로 시작하는 낱말(gifts·gifted·gifting·giftcard)은 모두 선물이다. 앞이 소문자인
      `regift` 꼴은 놓친다(아래 라우트 경로 검사는 서버 경로에서 그것도 잡는다).
    - **서버 라우트 경로**(「선물 라우트 경로」): `packages/backend/src` 의 따옴표 문자열 가운데 경로 조각에 gift 가 든
      것(`'/billing/gift'`·`` `/apple/${id}/gifts` ``·`'/regift'`). 예전에 `/gift` 라우트가 있었다(마이그레이션 주석).
    - 뺀 것: `packages/backend/src/lib/migrations.ts`(지난 마이그레이션의 SQL 은 고칠 수 없는 이력이다)와 테스트 소스
      (`src/test`·`src/androidTest`·`AlarmTalkTests`·`AlarmTalkUITests`·`packages/*/test` — 회귀 테스트가 `GIFT-` 를 넣어
      거절을 확인한다). 테스트는 처음부터 대상 경로에 없다.
    - 남겨 둔 것은 「선물 식별자」 에 **걸리고**, 허용 목록에 줄마다 이유와 함께 있다: dev 스텁 `POST /billing/checkout`
      이 옛 요청의 `gift: true` 를 읽어서 거절하는 자리(`body.gift` 와 그 거절 문구). 이력 표 `apple_gift_deliveries` 는
      마이그레이션 #131 이 지웠다.
(c) **스토어 문구 원본** — 「어휘」 를 찾는다. `docs/product/app-store-listing.md`·`play-store-listing.md` 는 올리는 값을
    펜스 블록(```text·```diff)과, 이름·제목·부제·짧은 설명 절의 표에 둔다. 그 둘만 본다 — 같은 파일의 「지금 상태」
    같은 설명문은 지운 문장을 인용하는 이력이라 보지 않는다. 새 칸을 설명문에 적으면 이 검사가 못 본다 — 올리는 값은
    펜스 블록에 둔다.
(d) **초대 코드 형식이 남아 있지 않다** — 서버가 받는 코드 형식은 더 없다(2026-10-20 까지는 INV- 4-4-4 하나를 고정해
    두던 검사였다). `packages/backend/src`·`packages/backend/scripts`·`packages/shared/src` 의 `*.ts`(주석은 지우고,
    `migrations.ts` 는 이력이라 빼고)에 형식 상수 `VOUCHER_CODE_RE`, 형식 검사 `isValidVoucherCodeFormat`, 그리고 `INV-`
    접두(정규식·`LIKE 'INV-%'`·`startsWith('INV-')` 어느 모양이든)가 나오면 실패한다. 파일을 가리지 않으므로 옮기거나 새로
    만들어도 걸린다. 옛 앱 호환 응답(`POST /code/register` → 언제나 404 `CODE_NOT_FOUND`)은 본문을 읽지 않으므로 형식이
    필요 없다. 새 접두(`TRY-`·`VIP-`)는 낱말로 미리 알 수 없다 — 그런 형식을 받는 라우트는 리뷰가 본다(`AGENTS.md`).
(e) **유료 게이트의 모양** — 게이트에 코드 입력이 돌아오지 않게, 아래 자리에 `TextField`·`IosAlertField`·
    `CodeRegisterRow`·`CodeRedeemField`·`registerCode`·`redeem`(대소문자 무시)이 없어야 한다. 주석은 지우고 보고,
    문자열은 그대로 본다(`"code.redeem.submit"` 도 걸린다).
    - iOS `VoicePlanGateAlert.swift`(편집기 게이트) 전체와, `VoiceProfileManagementPanel.swift` 의 `planGateOpen`
      알럿(목소리 탭 게이트 — `.alert(…, isPresented: $planGateOpen)` 과 뒤따르는 `{ … } message: { … }`). 같은 파일의
      다른 알럿(이름 바꾸기 등)은 게이트가 아니라 보지 않는다.
    - Android `PlanGateDialog.kt` 전체. 두 호출 자리(편집기·목소리 탭)는 제목·본문·확인 문구만 넘기므로, 액션을 더하려면
      이 파일을 고쳐야 한다. 호출 자리 옆에 따로 창을 띄우는 우회는 이 검사가 못 본다 — 리뷰가 본다(`AGENTS.md`).
    - 파일은 **이름으로** 찾는다(`GATE_SOURCES` — `apps/ios-native/AlarmTalk/**`·`apps/android-native/**`). 옮겨도
      따라가고, 없거나 `planGateOpen` 알럿이 없으면 실패한다 — 이름을 바꾸거나 없앴으면 `GATE_SOURCES` 도 고친다.
    - 괄호 짝은 문자열을 건너뛰며 센다. 문자열 보간 안에 또 따옴표가 있는 Swift 문자열(`"\\(a ? "x" : "y")"`)은
      경계를 잘못 읽을 수 있다 — 지금 그 블록에는 없다.

## 일부러 보지 않는 것

- 출시 노트(`docs/product/release-notes.md`): 지난 회차의 이력이고, 1.2.13 판은 선물을 **없앴다**고 말한다. App Store
  '이 버전의 새로운 기능' 은 제출 전에 사람이 읽는다(`docs/qa/dev-test-handoff.md` 체크리스트).
- 심사 노트: 저장소 밖(App Store Connect)에서 쓴다. 제출 전에 사람이 읽는다(같은 체크리스트).
- 서버 응답의 `error` 메시지: 앱은 `error_code` 로 문구를 고른다(`docs/spec/error-codes.md`). 코드 이름은 (b) 가 본다.
- 법무 문서(`docs/legal`, 두 앱에 실린다): 개정 이력이 지난 프로모 코드·쿠폰과 없앤 기능을 이력으로 적는다(코드로
  무엇을 연다는 말이 아니다). 문구를 바꾸려면 문서 버전과 앱 릴리스를 함께 맞춰야 하므로(`CLAUDE.md` 「법무 문서 버전」) 이
  검사로 묶지 않는다.
- 웹 랜딩(`apps/landing`): 앱 화면도 스토어 문구도 아니다(2026-10-14 에 선물·쿠폰 낱말이, 2026-10-20 에 초대 코드·
  커플·가족 이용권 낱말이 없음을 확인했다).

## 어휘 — 2026-10-14·10-20 의 화면 문구에 맞춰 골랐다

- 한국어: `선물`(선물 코드·선물하기·이용권 선물·'선물·초대 코드' 를 모두 덮는다 — 띄어 쓴 구절만 막으면 지운 문구
  '선물·초대 코드가 있어요' 가 빠져나간다), `기프트`, `쿠폰`, `바우처`, `프로모(션) 코드`, `체험 코드`·`라이선스 코드/키`,
  `이용권 코드`, `초대 코드`, `커플·가족 이용권`(커플/가족 + 이용권·플랜·요금제, 그리고 `커플·가족`·`커플/가족`·
  `가족·커플` 처럼 둘을 묶은 말).
- 영어: `gift…`(gifted·gifting 포함), `promo code`·`promotional code`, `coupon`, `voucher`, `redeem…`·`redemption`,
  `trial code`·`activation code`·`license code/key`, `plan code`, `invite code`·`invitation code`, `Couple plan`·
  `Family plan`.
- 일본어: `ギフト`, `贈`(贈る — 선물하다. 지운 선물 공유 문구 'プランを贈りました' 는 ギフト 없이 이 글자만 썼다),
  `プレゼント(コード)`, `プロモーションコード`, `クーポン`, `バウチャー`, `体験コード`·`ライセンスコード/キー`·
  `アクティベーションコード`, `利用券コード`, `招待コード`, `カップルプラン`·`ファミリープラン`·`家族プラン`.
- 체험·라이선스 쪽은 지운 문구가 아니라 규칙(「선물 코드 — 폐지」 의 '체험·라이선스 코드를 새로 만들지 말 것')을 따라
  미리 막는 것이다. '오픈소스 라이선스'·'라이선스 전문' 처럼 코드·키가 붙지 않은 말은 걸리지 않는다.
- `이용권 코드`·`plan code`·`利用券コード` 는 2026-10-14 2차에 막았다. 커플·가족 카드의 '이용권 코드 공유' 가 초대 코드를
  가리켰지만, 이용권을 여는 코드(라이선스 키)로 읽혀 '초대 코드 공유' 로 바꿨다(용어집 `docs/spec/localization.md`).
- `초대 코드`·`invite code`·`招待コード` 와 커플·가족 이용권 낱말은 2026-10-20 에 막았다. 초대 코드는 커플·가족 그룹에
  합류하는 마지막 코드 입력이었고, 이용권이 사라지면서 둘 다 화면에 남을 이유가 없다.
- 대소문자는 가리지 않는다. 막지 **않는** 것: '프로모션'·'promotional' 혼자(마케팅 동의의 "Promotional messages"
  처럼 코드가 아닌 뜻이다), 코드 없이 쓴 `이용권`·`plan`·`초대`, 그리고 맨 `가족`·`family`·`家族`·`커플`(목소리
  관계 라벨·"가족 목소리로 깨워요" 같은 소개 문구다).

## 예외(허용 목록)

`ALLOWLIST` 에 한 줄씩 **이유와 함께** 둔다. 들어맞는 것이 없어진 항목은 실패한다 — 고친 뒤에는 그 줄도 지우라는
뜻이고, 허용 목록이 소리 없이 쌓이지 않게 하려는 것이다.

    python3 scripts/check-paid-unlock-codes.py --self-test   # 검사기 자체만(unittest)
    python3 scripts/check-paid-unlock-codes.py               # 저장소 검사
    python3 scripts/check-paid-unlock-codes.py --root <dir>  # 다른 체크아웃(예: git archive 로 푼 develop)

이 맥의 시스템 python3(3.9)로 돈다 — 표준 라이브러리만 쓴다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[1]

# ── 어휘 (a)·(c) ─────────────────────────────────────────────────────────────────────────────
TEXT_TERMS: Tuple[Tuple[str, "re.Pattern[str]"], ...] = (
    ("선물", re.compile(r"선물")),
    ("기프트", re.compile(r"기프트")),
    ("쿠폰", re.compile(r"쿠폰")),
    ("바우처", re.compile(r"바우처")),
    ("프로모 코드", re.compile(r"프로모(?:션)?\s*코드")),
    ("체험·라이선스 코드", re.compile(r"체험\s*코드|라이선스\s*(?:코드|키)")),
    ("이용권 코드", re.compile(r"이용권\s*코드")),
    ("초대 코드", re.compile(r"초대\s*코드")),
    # 맨 '가족'·'커플' 은 막지 않는다 — 이용권·플랜·요금제가 붙거나 둘을 묶어 부를 때만 상품 이름이다.
    ("커플·가족 이용권", re.compile(r"(?:커플|가족)\s*(?:이용권|플랜|요금제)|커플\s*[·・/]\s*가족|가족\s*[·・/]\s*커플")),
    ("gift", re.compile(r"\bgift", re.IGNORECASE)),
    ("promo code", re.compile(r"\bpromo(?:tional)?[\s-]*codes?\b", re.IGNORECASE)),
    ("coupon", re.compile(r"\bcoupons?\b", re.IGNORECASE)),
    ("voucher", re.compile(r"\bvouchers?\b", re.IGNORECASE)),
    ("redeem", re.compile(r"\bredeem|\bredemption", re.IGNORECASE)),
    ("trial·license code", re.compile(r"\b(?:trial|activation)\s+codes?\b|\blicen[cs]e\s+(?:codes?|keys?)\b", re.IGNORECASE)),
    ("plan code", re.compile(r"\bplan\s+codes?\b", re.IGNORECASE)),
    ("invite code", re.compile(r"\binvit(?:e|ation)\s+codes?\b", re.IGNORECASE)),
    ("Couple·Family plan", re.compile(r"\b(?:couple|family)\s+plans?\b", re.IGNORECASE)),
    ("ギフト", re.compile(r"ギフト")),
    ("贈", re.compile(r"贈")),
    ("プレゼント", re.compile(r"プレゼント")),
    ("プロモーションコード", re.compile(r"プロモーション\s*コード")),
    ("クーポン", re.compile(r"クーポン")),
    ("バウチャー", re.compile(r"バウチャー")),
    ("体験・ライセンスコード", re.compile(r"体験\s*コード|ライセンス\s*(?:コード|キー)|アクティベーション\s*コード")),
    ("利用券コード", re.compile(r"利用券\s*コード")),
    ("招待コード", re.compile(r"招待\s*コード")),
    ("カップル・ファミリープラン", re.compile(r"(?:カップル|ファミリー|家族)\s*プラン")),
)

# ── 형식 (b) — 주석을 지운 코드에서 찾는다 ────────────────────────────────────────────────────
CODE_TERMS: Tuple[Tuple[str, "re.Pattern[str]"], ...] = (
    # 은퇴한 상품 id `personal_gift_1m`·`com.alarmtalk.app.personal_gift_1m` 과 그 상수(`PERSONAL_GIFT_1M`·`personalGift`).
    ("선물 상품 id", re.compile(r"personal_?gift", re.IGNORECASE)),
    # `GIFT-XXXX-…` 형식과 접두(`(INV|GIFT)-`, `'GIFT'`, 열거값 `GIFT`). `INVALID_GIFT_PLAN` 처럼 밑줄로 붙은 것은 아래 줄이 본다.
    ("GIFT 형식", re.compile(r"\bGIFT\b")),
    # 바우처 종류 문자열 — 예전 `kind: 'gift'`·`'invite' | 'gift'`.
    ("'gift' 종류", re.compile(r"""(['"`])gift\1""")),
    ("선물 에러 코드", re.compile(r"\b(?:GIFT_PERSONAL_ONLY|INVALID_GIFT_PLAN)\b")),
    # 이름을 짓는 방식마다 한 낱말로 선 gift — 대소문자를 가린다(맨 위 (b)). 위 줄들과 같은 줄에 겹쳐 걸릴 수 있다.
    ("선물 식별자", re.compile(r"(?<![a-z])gift|Gift|(?<![A-Z])GIFT(?![A-Z])")),
    # 은퇴한 커플·가족 상품 id(`couple_monthly`·`com.alarmtalk.app.family_monthly`)와 그 상수(`COUPLE_MONTHLY`·`familyMonthly`).
    ("그룹 상품 id", re.compile(r"(?:couple|family)_?(?:monthly|yearly)", re.IGNORECASE)),
    # 주인이 초대 코드를 받아 가던 경로(`POST /billing/vouchers/family-share`). 앱의 API 경로 문자열도 같이 본다.
    ("초대 코드 발급 경로", re.compile(r"family-share")),
)

# 서버 라우트 경로 — 따옴표 문자열 안의 경로 조각에 gift 가 든 것. `ROUTE_ROOT` 아래 파일에만 쓴다.
ROUTE_ROOT = "packages/backend/src"
ROUTE_TERMS: Tuple[Tuple[str, "re.Pattern[str]"], ...] = (
    (
        "선물 라우트 경로",
        re.compile(
            r"""'[^'\n]*/[^/'\s]*(?:gift|Gift|GIFT)[^'\n]*'"""
            r'''|"[^"\n]*/[^/"\s]*(?:gift|Gift|GIFT)[^"\n]*"'''
            r"""|`[^`\n]*/[^/`\s]*(?:gift|Gift|GIFT)[^`\n]*`"""
        ),
    ),
)

STORE_LISTINGS = ("docs/product/app-store-listing.md", "docs/product/play-store-listing.md")
# 표의 칸도 올리는 값인 절(이름·부제·제목·짧은 설명).
STORE_TABLE_SECTION = re.compile(r"이름|부제|제목|짧은 설명")
FENCE = re.compile(r"(?ms)^```(text|diff)[ \t]*\n(.*?)^```")

IOS_SWIFT_ROOTS = ("apps/ios-native/AlarmTalk", "apps/ios-native/AlarmTalkWidget", "apps/ios-native/Shared")
TS_ROOTS = ("packages/backend/src", "packages/backend/scripts", "packages/shared/src")
CODE_EXCLUDED = {"packages/backend/src/lib/migrations.ts"}
SKIP_DIRS = {"build", "DerivedData", "node_modules", ".git", ".gradle", "Pods"}
TEST_SOURCE_SETS = ("test", "androidTest")
# 점으로 이은 식별자 키 — 화면에 나오는 것은 그 값뿐이다.
IDENTIFIER_KEY = re.compile(r"^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$")

# ── 초대 코드 형식 (d) ───────────────────────────────────────────────────────────────────────
# 서버가 받는 코드 형식은 없다(2026-10-20). 되살리려면 먼저 `docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」 를 볼 것.
INVITE_FORMAT = re.compile(r"\bVOUCHER_CODE_RE\b|\bisValidVoucherCodeFormat\b|(?<![A-Za-z0-9_])INV-")

# ── 유료 게이트의 모양 (e) ───────────────────────────────────────────────────────────────────
GATE_FORBIDDEN = re.compile(r"TextField|IosAlertField|CodeRegisterRow|CodeRedeemField|registerCode|redeem", re.IGNORECASE)


@dataclass(frozen=True)
class GateSource:
    base: str  # 이 아래에서 이름으로 찾는다
    name: str  # 파일 이름
    language: str  # swift · kotlin
    alert_flag: str  # 비었으면 파일 전체, 있으면 `.alert(…, isPresented: $<flag>)` 블록만 본다
    what: str  # 보고용 이름


GATE_SOURCES: Tuple[GateSource, ...] = (
    GateSource("apps/ios-native/AlarmTalk", "VoicePlanGateAlert.swift", "swift", "", "iOS 편집기 유료 게이트"),
    GateSource("apps/ios-native/AlarmTalk", "VoiceProfileManagementPanel.swift", "swift", "planGateOpen", "iOS 목소리 탭 유료 게이트"),
    GateSource("apps/android-native", "PlanGateDialog.kt", "kotlin", "", "Android 유료 게이트(편집기·목소리 탭 공용)"),
)


@dataclass(frozen=True)
class Hit:
    path: str  # 루트 기준 상대 경로
    where: str  # 파일 안의 자리 — 키·리소스 이름·줄
    term: str  # 걸린 어휘·형식의 이름
    excerpt: str  # 걸린 글(앞뒤를 조금 붙여 자른다)

    def render(self) -> str:
        return f"{self.path} — {self.where}: [{self.term}] {self.excerpt}"


@dataclass(frozen=True)
class Allow:
    path: str
    where: str  # Hit.where 에 들어 있어야 하는 글(코드는 줄 내용의 일부)
    term: str
    reason: str

    def covers(self, hit: Hit) -> bool:
        return hit.path == self.path and hit.term == self.term and self.where in hit.where


_CHECKOUT_GIFT_REJECTION = (
    "dev 스텁 `POST /billing/checkout` 이 옛 요청의 `gift: true` 를 **읽어서 거절하는** 자리다(400 `INVALID_REQUEST` — "
    "선물 결제는 2026-10-14 에 없앴다). 필드를 읽지 않으면 옛 앱의 선물 요청이 일반 결제로 흘러간다. 이 거절을 없애면 "
    "이 줄들도 지운다."
)

ALLOWLIST: Tuple[Allow, ...] = tuple(
    Allow(path="packages/backend/src/routes/billing-mutation.ts", where=fragment, term="선물 식별자", reason=_CHECKOUT_GIFT_REJECTION)
    for fragment in (
        "gift?: unknown }>()",
        "gift?: unknown } => ({",
        "gift: undefined,",
        "if (body.gift === true) {",
        "'Gift checkout is no longer available'",
    )
)


def excerpt(text: str, start: int, end: int, width: int = 40) -> str:
    left = max(0, start - width)
    right = min(len(text), end + width)
    snippet = text[left:right].replace("\n", "⏎")
    return ("…" if left else "") + snippet + ("…" if right < len(text) else "")


def find_terms(text: str, terms: Sequence[Tuple[str, "re.Pattern[str]"]]) -> Iterator[Tuple[str, str]]:
    for name, pattern in terms:
        match = pattern.search(text)
        if match:
            yield name, excerpt(text, match.start(), match.end())


def relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def walk(root: Path, base: str, suffix: str) -> Iterator[Path]:
    directory = root / base
    if not directory.is_dir():
        return
    for path in sorted(directory.rglob(f"*{suffix}")):
        if path.is_file() and not (set(path.relative_to(directory).parts) & SKIP_DIRS):
            yield path


def find_by_name(root: Path, base: str, name: str) -> List[Path]:
    directory = root / base
    if not directory.is_dir():
        return []
    return [
        path for path in sorted(directory.rglob(name))
        if path.is_file() and not (set(path.relative_to(directory).parts) & SKIP_DIRS)
    ]


# ── (a) 화면 문구 ───────────────────────────────────────────────────────────────────────────
def catalog_values(node: object, language: str) -> Iterator[Tuple[str, str]]:
    """xcstrings 항목 안의 `stringUnit.value` 를 (언어, 값) 으로 모두 꺼낸다(variations·substitutions 안까지)."""
    if isinstance(node, dict):
        unit = node.get("stringUnit")
        if isinstance(unit, dict) and isinstance(unit.get("value"), str):
            yield language, unit["value"]
        for key, child in node.items():
            if key in ("stringUnit", "comment"):
                continue
            yield from catalog_values(child, language)
    elif isinstance(node, list):
        for child in node:
            yield from catalog_values(child, language)


def scan_catalog(root: Path, path: Path) -> Iterator[Hit]:
    rel = relative(root, path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        yield Hit(rel, "파일", "읽기 실패", str(error))
        return
    for key, entry in sorted((data.get("strings") or {}).items()):
        if not IDENTIFIER_KEY.match(key):
            for term, snippet in find_terms(key, TEXT_TERMS):
                yield Hit(rel, f"키 {key!r}", term, snippet)
        localizations = entry.get("localizations") if isinstance(entry, dict) else None
        for language, unit in sorted((localizations or {}).items()):
            seen = set()
            for _, value in catalog_values(unit, language):
                for term, snippet in find_terms(value, TEXT_TERMS):
                    if (term, snippet) not in seen:
                        seen.add((term, snippet))
                        yield Hit(rel, f"키 {key!r} · {language}", term, snippet)


def android_texts(element: ET.Element) -> Iterator[Tuple[str, str]]:
    for child in element:
        name = child.get("name", "?")
        if child.tag == "string":
            yield name, "".join(child.itertext())
        elif child.tag in ("plurals", "string-array"):
            for index, item in enumerate(child.findall("item")):
                label = item.get("quantity") or str(index)
                yield f"{name}[{label}]", "".join(item.itertext())


def scan_android_resources(root: Path, path: Path) -> Iterator[Hit]:
    rel = relative(root, path)
    try:
        resources = ET.parse(str(path)).getroot()  # ElementTree 는 XML 주석을 버린다 — 주석은 보지 않는다.
    except (OSError, ET.ParseError) as error:
        yield Hit(rel, "파일", "읽기 실패", str(error))
        return
    for name, text in android_texts(resources):
        for term, snippet in find_terms(text, TEXT_TERMS):
            yield Hit(rel, f"{name} ({path.parent.name})", term, snippet)


def android_source_sets(root: Path) -> List[Path]:
    src = root / "apps/android-native/app/src"
    if not src.is_dir():
        return []
    return [child for child in sorted(src.iterdir()) if child.is_dir() and child.name not in TEST_SOURCE_SETS]


def app_string_files(root: Path) -> Iterator[Tuple[str, Path]]:
    for path in walk(root, "apps/ios-native", ".xcstrings"):
        if not (set(path.relative_to(root / "apps/ios-native").parts) & {"AlarmTalkTests", "AlarmTalkUITests"}):
            yield "catalog", path
    for source_set in android_source_sets(root):
        res = source_set / "res"
        if res.is_dir():
            for values in sorted(res.glob("values*")):
                for path in sorted(values.glob("*.xml")):
                    yield "android", path


# ── (b) 코드 ───────────────────────────────────────────────────────────────────────────────
def string_end(text: str, i: int) -> int:
    """`text[i]` 에서 시작한 문자열 리터럴이 끝난 다음 위치. 세 겹 따옴표(여러 줄 문자열)도 다룬다."""
    n = len(text)
    if text.startswith('"""', i):
        end = text.find('"""', i + 3)
        return n if end == -1 else end + 3
    quote = text[i]
    j = i + 1
    while j < n:
        if text[j] == "\\":
            j += 2
            continue
        if text[j] == quote:
            return j + 1
        if text[j] == "\n" and quote != "`":
            return j  # 닫히지 않은 한 줄 문자열 — 줄 끝에서 멈춘다
        j += 1
    return n


REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%<>~^")


def regex_end(text: str, i: int) -> int:
    """TS 정규식 리터럴 `/…/` 이 끝난 다음 위치(문자 클래스 안의 `/` 는 끝이 아니다)."""
    n = len(text)
    j = i + 1
    in_class = False
    while j < n:
        ch = text[j]
        if ch == "\\":
            j += 2
            continue
        if ch == "\n":
            return j
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            return j + 1
        j += 1
    return n


def blank_comments(text: str, nested: bool, regex_literals: bool) -> str:
    """주석을 공백으로 지운다(줄바꿈·길이는 그대로 — 줄 번호가 맞는다). 문자열·정규식 안의 `//`·`/*` 는 주석이 아니다."""
    out = list(text)
    n = len(text)

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    def previous_significant(i: int) -> str:
        k = i - 1
        while k >= 0 and text[k] in " \t\r\n":
            k -= 1
        return text[k] if k >= 0 else ""

    i = 0
    while i < n:
        if text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end == -1 else end
            blank(i, end)
            i = end
        elif text.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth > 0:
                if nested and text.startswith("/*", j):
                    depth += 1
                    j += 2
                elif text.startswith("*/", j):
                    depth -= 1
                    j += 2
                else:
                    j += 1
            blank(i, j)
            i = j
        elif text[i] in "\"'`":
            i = string_end(text, i)
        elif regex_literals and text[i] == "/" and (previous_significant(i) in REGEX_PRECEDERS or previous_significant(i) == ""):
            i = regex_end(text, i)
        else:
            i += 1
    return "".join(out)


def strip_comments(text: str, language: str) -> str:
    if language == "json":
        return text
    return blank_comments(text, nested=language in ("swift", "kotlin"), regex_literals=language == "ts")


def code_files(root: Path) -> Iterator[Tuple[Path, str]]:
    for base in IOS_SWIFT_ROOTS:
        for path in walk(root, base, ".swift"):
            yield path, "swift"
    for path in walk(root, "apps/ios-native", ".storekit"):
        yield path, "json"
    for source_set in android_source_sets(root):
        for path in sorted(source_set.rglob("*.kt")):
            if path.is_file() and not (set(path.relative_to(source_set).parts) & SKIP_DIRS):
                yield path, "kotlin"
    for base in TS_ROOTS:
        for path in walk(root, base, ".ts"):
            if relative(root, path) not in CODE_EXCLUDED:
                yield path, "ts"


def scan_code(root: Path, path: Path, language: str) -> Iterator[Hit]:
    rel = relative(root, path)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        yield Hit(rel, "파일", "읽기 실패", str(error))
        return
    terms = CODE_TERMS + (ROUTE_TERMS if rel.startswith(ROUTE_ROOT + "/") else ())
    for number, line in enumerate(strip_comments(text, language).splitlines(), 1):
        for term, pattern in terms:
            match = pattern.search(line)
            if match:
                yield Hit(rel, f"{number}행 `{line.strip()[:120]}`", term, excerpt(line, match.start(), match.end()))


# ── (c) 스토어 문구 원본 ─────────────────────────────────────────────────────────────────────
def scan_store_listing(root: Path, rel: str) -> Iterator[Hit]:
    path = root / rel
    if not path.is_file():
        yield Hit(rel, "파일", "읽기 실패", "없다 — 옮겼으면 이 검사의 STORE_LISTINGS 도 옮길 것")
        return
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    blocks: List[Tuple[int, int]] = []
    for match in FENCE.finditer(text):
        blocks.append((match.start(), match.end()))
        heading = last_heading(text, match.start())
        line = text.count("\n", 0, match.start()) + 1
        for term, snippet in find_terms(match.group(2), TEXT_TERMS):
            yield Hit(rel, f"{line}행 「{heading}」 ```{match.group(1)} 블록", term, snippet)
    offset = 0
    heading = ""
    for number, raw in enumerate(text.split("\n"), 1):
        start = offset
        offset += len(raw) + 1
        if raw.startswith("## "):
            heading = raw[3:].strip()
            continue
        if any(a <= start < b for a, b in blocks):
            continue
        if raw.startswith("|") and STORE_TABLE_SECTION.search(heading):
            for term, snippet in find_terms(raw, TEXT_TERMS):
                yield Hit(rel, f"{number}행 「{heading}」 표", term, snippet)


def last_heading(text: str, position: int) -> str:
    headings = [m.group(1).strip() for m in re.finditer(r"(?m)^#{2,3} (.+)$", text[:position])]
    return headings[-1] if headings else ""


# ── 괄호 짝 (e) ─────────────────────────────────────────────────────────────────────────────
def balanced_end(code: str, start: int, opening: str, closing: str, language: str) -> int:
    """`code[start] == opening` 의 짝이 되는 `closing` 다음 위치. 문자열 안의 괄호는 세지 않는다(주석은 이미 지웠다)."""
    quotes = '"' if language == "swift" else "\"'`"  # Swift 는 큰따옴표만 문자열이다(`'` 는 쓰지 않고 `` ` `` 는 이름이다)
    depth, j, n = 0, start, len(code)
    while j < n:
        ch = code[j]
        if ch in quotes:
            j = string_end(code, j)
            continue
        if ch == opening:
            depth += 1
        elif ch == closing:
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return n


def line_number(code: str, position: int) -> int:
    return code.count("\n", 0, position) + 1


# ── (d) 초대 코드 형식 ───────────────────────────────────────────────────────────────────────
def check_invite_format(root: Path) -> Iterator[Hit]:
    """서버·공유 코드(주석 제외)에 초대 코드 형식(`VOUCHER_CODE_RE`·`isValidVoucherCodeFormat`·`INV-`)이 없는지."""
    for base in TS_ROOTS:
        for path in walk(root, base, ".ts"):
            rel = relative(root, path)
            if rel in CODE_EXCLUDED:
                continue
            try:
                code = strip_comments(path.read_text(encoding="utf-8"), "ts")
            except (OSError, UnicodeDecodeError) as error:
                yield Hit(rel, "파일", "읽기 실패", str(error))
                continue
            for number, line in enumerate(code.splitlines(), 1):
                match = INVITE_FORMAT.search(line)
                if match:
                    yield Hit(rel, f"{number}행 `{line.strip()[:120]}`", "초대 코드 형식",
                              excerpt(line, match.start(), match.end()))


# ── (e) 유료 게이트의 모양 ───────────────────────────────────────────────────────────────────
ALERT_CALL = re.compile(r"\.alert\s*\(")
LABELED_CLOSURE = re.compile(r"[A-Za-z_]\w*\s*:\s*\{")


def alert_blocks(code: str, flag: str) -> List[Tuple[int, int]]:
    """`.alert(…, isPresented: $<flag>)` 와 뒤따르는 클로저들(`{ … } message: { … }`)의 (시작, 끝) 위치."""
    blocks: List[Tuple[int, int]] = []
    presented = re.compile(r"\$" + re.escape(flag) + r"\b")
    for match in ALERT_CALL.finditer(code):
        arguments_end = balanced_end(code, match.end() - 1, "(", ")", "swift")
        if not presented.search(code[match.end():arguments_end]):
            continue
        end = arguments_end
        while True:
            j = end
            while j < len(code) and code[j] in " \t\r\n":
                j += 1
            label = LABELED_CLOSURE.match(code, j)
            if label:
                j = label.end() - 1
            if j < len(code) and code[j] == "{":
                end = balanced_end(code, j, "{", "}", "swift")
                continue
            break
        blocks.append((match.start(), end))
    return blocks


def check_gate_sources(root: Path) -> Iterator[Hit]:
    """유료 게이트 자리에 코드 입력(입력 칸·코드 등록 행·등록 함수)이 없는지. 파일이 없으면 그것도 실패다."""
    for gate in GATE_SOURCES:
        paths = find_by_name(root, gate.base, gate.name)
        if not paths:
            yield Hit(f"{gate.base}/**/{gate.name}", gate.what, "게이트 구조",
                      "파일이 없다 — 옮겼으면 이름이 같아야 하고, 이름을 바꾸거나 없앴으면 이 검사의 GATE_SOURCES 도 고칠 것")
            continue
        found_block = False
        for path in paths:
            rel = relative(root, path)
            try:
                code = strip_comments(path.read_text(encoding="utf-8"), gate.language)
            except (OSError, UnicodeDecodeError) as error:
                yield Hit(rel, "파일", "읽기 실패", str(error))
                continue
            spans = alert_blocks(code, gate.alert_flag) if gate.alert_flag else [(0, len(code))]
            found_block = found_block or bool(spans)
            for start, end in spans:
                first = line_number(code, start)
                for offset, line in enumerate(code[start:end].split("\n")):
                    for match in GATE_FORBIDDEN.finditer(line):
                        yield Hit(rel, f"{gate.what} · {first + offset}행 `{line.strip()[:120]}`", "게이트 코드 입력",
                                  excerpt(line, match.start(), match.end()))
        if gate.alert_flag and not found_block:
            yield Hit(relative(root, paths[0]), gate.what, "게이트 구조",
                      f"`.alert(…, isPresented: ${gate.alert_flag})` 를 찾지 못했다 — 이름을 바꿨으면 GATE_SOURCES 도 고칠 것")


# ── 모아서 판정 ────────────────────────────────────────────────────────────────────────────
def audit(root: Path) -> List[Hit]:
    hits: List[Hit] = []
    for kind, path in app_string_files(root):
        hits.extend(scan_catalog(root, path) if kind == "catalog" else scan_android_resources(root, path))
    for path, language in code_files(root):
        hits.extend(scan_code(root, path, language))
    for rel in STORE_LISTINGS:
        hits.extend(scan_store_listing(root, rel))
    hits.extend(check_invite_format(root))
    hits.extend(check_gate_sources(root))
    return hits


def judge(hits: Sequence[Hit], allowlist: Sequence[Allow]) -> Tuple[List[Hit], List[Allow]]:
    """허용 목록으로 걸러 남은 위반과, 아무것에도 들어맞지 않은(낡은) 허용 항목을 돌려준다."""
    used = set()
    remaining: List[Hit] = []
    for hit in hits:
        covering = [index for index, allow in enumerate(allowlist) if allow.covers(hit)]
        if covering:
            used.update(covering)
        else:
            remaining.append(hit)
    stale = [allow for index, allow in enumerate(allowlist) if index not in used]
    return remaining, stale


def main() -> int:
    parser = argparse.ArgumentParser(description="코드로 유료 기능을 여는 문구·형식이 돌아왔는지 본다.")
    parser.add_argument("--root", type=Path, default=ROOT, help="검사할 체크아웃(기본: 이 저장소)")
    parser.add_argument("--self-test", action="store_true", help="검사기 자체만 시험한다(unittest)")
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(SelfTests)
        return 0 if unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful() else 1

    root = args.root.resolve()
    remaining, stale = judge(audit(root), ALLOWLIST)
    if remaining or stale:
        if remaining:
            print("코드로 유료 기능을 여는 문구·형식이 있다(App Store 지침 3.1.1 — 1.2.11·1.2.12 반려):\n", file=sys.stderr)
            for hit in remaining:
                print(f"  - {hit.render()}", file=sys.stderr)
        if stale:
            print("\n들어맞는 것이 없어진 허용 항목(고쳤으면 ALLOWLIST 에서 지운다):", file=sys.stderr)
            for allow in stale:
                print(f"  - {allow.path} — {allow.where} [{allow.term}]", file=sys.stderr)
        print(
            "\n코드로 유료 기능을 얻는 길은 없다 — 초대 코드(INV-)도 2026-10-20 에 커플·가족 이용권과 함께 없앴다. 선물·\n"
            "프로모·쿠폰·초대 코드, 코드를 발급하는 상품, 커플·가족 이용권을 되살리지 말고, 할인·무료 이용은 스토어 오퍼\n"
            "코드로 준다. 유료 게이트에도 화면 어디에도 코드 입력을 두지 않는다.\n"
            "규칙: docs/spec/plan-gates.md 「선물 코드 — 폐지」·「커플·가족 이용권 — 폐지」. 정당한 예외면 이 스크립트의\n"
            "ALLOWLIST 에 이유와 함께 둔다.",
            file=sys.stderr,
        )
        return 1
    print(f"코드로 유료 기능을 여는 문구·형식이 없다(허용 {len(ALLOWLIST)}건).")
    return 0


# ── 자체 시험 ──────────────────────────────────────────────────────────────────────────────
def _catalog(strings: dict) -> str:
    return json.dumps({"sourceLanguage": "ko", "strings": strings, "version": "1.0"}, ensure_ascii=False)


def _unit(value: str) -> dict:
    return {"stringUnit": {"state": "translated", "value": value}}


CLEAN_LISTING = """# 문구

## 지금 상태

- 게재본에 "개인 1개월 이용권을 선물 코드로 보낼 수도 있어요" 가 남아 있다 — 이력 설명이다(보지 않는다).
- 게재본에 "커플·가족 이용권은 초대 코드로 함께 써요" 가 남아 있다 — 이것도 이력 설명이다.

## 이름 · 부제

| ko | `알람톡: 목소리 알람 시계` | 가족 목소리로 깨우는 모닝콜 |

## 설명

```text
• 엄마·아빠 목소리로 아침을 깨워요. 우리 가족 목소리면 더 좋아요.
```

```diff
-• 날씨 줄
+• 운세 줄
```
"""

CODE_STUB_PATH = "packages/backend/src/routes/code.ts"
CLEAN_CODE_STUB = (
    "// 옛 앱 호환 — 초대 코드(INV-)는 지웠다. 주석의 const VOUCHER_CODE_RE = /^INV-/; 와 isValidVoucherCodeFormat 은\n"
    "// 세지 않는다. 그룹 상품 couple_monthly·family_monthly 와 /vouchers/family-share 경로도 주석이다.\n"
    "codeRoutes.post('/register', (c) => jsonError(c, 404, 'CODE_NOT_FOUND', 'Code not found'));\n"
)

IOS_EDITOR_GATE_PATH = "apps/ios-native/AlarmTalk/Views/Editor/VoicePlanGateAlert.swift"
CLEAN_IOS_EDITOR_GATE = (
    "/// ⚠ 코드 입력(`RedeemCodeSheet`·`TextField`)을 되살리지 말 것 — 주석은 보지 않는다\n"
    "struct VoicePlanGateAlert: ViewModifier {\n"
    "    func body(content view: Content) -> some View {\n"
    "        view.alert(\"\", isPresented: .constant(true)) {\n"
    "            Button(\"닫기\", role: .cancel) {}\n"
    "            Button(PaidGateCopy.viewPlans) {}\n"
    "                .keyboardShortcut(.defaultAction)\n"
    "        }\n"
    "    }\n"
    "}\n"
)

IOS_VOICES_PANEL_PATH = "apps/ios-native/AlarmTalk/Views/Voices/VoiceProfileManagementPanel.swift"
CLEAN_IOS_VOICES_PANEL = (
    "struct VoiceProfileManagementPanel: View {\n"
    "    var body: some View {\n"
    "        content\n"
    "        // 이름 바꾸기 알럿은 게이트가 아니다 — 입력 칸이 있어도 된다\n"
    "        .alert(\"이름 바꾸기\", isPresented: $renameOpen) {\n"
    "            TextField(\"이름\", text: $name)\n"
    "            Button(\"저장\") {}\n"
    "        }\n"
    "        // ⚠ 코드 갈래(`RedeemCodeSheet`)를 되살리지 말 것\n"
    "        .alert(String(localized: \"'\\(name)' 목소리 만들기는 유료 기능이에요\"), isPresented: $planGateOpen) {\n"
    "            Button(String(localized: \"닫기\"), role: .cancel) {}\n"
    "            Button(PaidGateCopy.viewPlans) { onRequestBilling?() }\n"
    "                // 이 줄이 강조를 만든다\n"
    "                .keyboardShortcut(.defaultAction)\n"
    "        } message: {\n"
    "            Text(PaidGateCopy.message)\n"
    "        }\n"
    "        .sheet(item: $codeTarget) { _ in CodeRegisterRow() }\n"
    "    }\n"
    "}\n"
)

ANDROID_GATE_PATH = "apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/PlanGateDialog.kt"
CLEAN_ANDROID_GATE = (
    "/** ⚠ 코드 입력(`IosAlertField`·`CodeRedeemField`)을 되살리지 말 것 */\n"
    "@Composable\n"
    "internal fun PlanGateDialog(message: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {\n"
    "    IosAlertDialog(\n"
    "        message = message,\n"
    "        onDismiss = onDismiss,\n"
    "        actions = listOf(\n"
    "            IosAlertAction(label = stringResource(R.string.r3dlg_modal_dialog_close), onClick = onDismiss),\n"
    "            IosAlertAction(label = stringResource(R.string.r3dlg_plan_gate_confirm), emphasized = true, onClick = onConfirm),\n"
    "        ),\n"
    "    )\n"
    "}\n"
)


class SelfTests(unittest.TestCase):
    def fixture(self, files: dict) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        base = {
            "apps/ios-native/AlarmTalk/Localizable.xcstrings": _catalog({
                "개인 이용권": {"localizations": {"en": _unit("Personal plan"), "ja": _unit("パーソナルプラン")}},
                "code.redeem.submit": {"localizations": {"ko": _unit("등록"), "en": _unit("Register")}},
                "가족 목소리": {"comment": "gift·초대 코드라는 낱말은 번역자 메모라 보지 않는다",
                           "localizations": {"en": _unit("Family voice"), "ja": _unit("家族の声")}},
            }),
            "apps/android-native/app/src/main/res/values/strings.xml": (
                '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                "    <!-- 선물·초대 코드 문구를 되살리지 말 것(주석은 보지 않는다) -->\n"
                '    <string name="code_redeem_placeholder">개인 이용권</string>\n'
                '    <string name="billing_gift_history_label">이용권</string>\n'
                "</resources>\n"
            ),
            "apps/android-native/app/src/main/res/values-en/strings.xml": (
                '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <string name="marketing">Promotional messages are only sent between 8am and 9pm.</string>\n'
                "</resources>\n"
            ),
            "apps/ios-native/AlarmTalk/Billing.swift": (
                "// ⚠ 선물 상품 com.alarmtalk.app.personal_gift_1m 과 GIFT- 코드를 되살리지 말 것\n"
                "/* 바깥 /* 안쪽 GIFT- */ 아직 주석 personal_gift */\n"
                'let url = "https://alarm-talk.com/a//b" // GIFT- 는 주석이다\n'
                "enum SubscriptionProduct: String { case personalMonthly = \"com.alarmtalk.app.personal_monthly\" }\n"
            ),
            "apps/android-native/app/src/main/java/A.kt": (
                "/** 옛 `INVALID_GIFT_PLAN`·`GIFT_PERSONAL_ONLY` 갈래와 `COUPLE_MONTHLY` 상수는 지웠다 */\n"
                'val ok = productId == "personal_monthly"\n'
                "fun stopRingingIfThisAlarm(alarmId: String) {} // 대소문자를 무시하면 'gIfT' 가 걸린다\n"
            ),
            "packages/backend/src/routes/billing-mutation.ts": (
                "billingMutation.post('/checkout', handler); // '/gift' 라우트는 지웠다\n"
                "const re = /^[a-z]{4}$/; // (INV|GIFT)- 는 옛 형식\n"
                "const quoteInRegex = /'/g; const after = 'x'; // GIFT 는 주석\n"
            ),
            "packages/backend/src/routes/billing-query.ts": "billingQuery.get('/vouchers', (c) => c.json({ vouchers: [] }));\n",
            "packages/backend/src/lib/migrations.ts": (
                "const old = \"INSERT INTO voucher_codes VALUES ('GIFT-AAAA-BBBB-CCCC', 'gift')\";\n"
                "const older = \"INSERT INTO voucher_codes VALUES ('INV-AAAA-BBBB-CCCC', 'invite')\";\n"
                "const plans = \"INSERT INTO plans (key) VALUES ('couple_monthly')\";\n"
            ),
            "apps/android-native/app/src/test/java/GiftTest.kt": 'val code = "GIFT-AAAA-BBBB-CCCC"\n',
            "packages/backend/test/code.test.ts": "await post('/code/register', { code: 'INV-AAAA-BBBB-CCCC' });\n",
            "docs/product/app-store-listing.md": CLEAN_LISTING,
            "docs/product/play-store-listing.md": CLEAN_LISTING,
            CODE_STUB_PATH: CLEAN_CODE_STUB,
            IOS_EDITOR_GATE_PATH: CLEAN_IOS_EDITOR_GATE,
            IOS_VOICES_PANEL_PATH: CLEAN_IOS_VOICES_PANEL,
            ANDROID_GATE_PATH: CLEAN_ANDROID_GATE,
        }
        base.update(files)
        for rel, content in base.items():
            if content is None:
                continue
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        return root

    def terms(self, root: Path) -> List[Tuple[str, str]]:
        return [(hit.path, hit.term) for hit in audit(root)]

    def test_clean_tree_passes(self) -> None:
        self.assertEqual(audit(self.fixture({})), [])

    def test_catalog_keys_and_values_in_every_language(self) -> None:
        root = self.fixture({"apps/ios-native/AlarmTalk/Localizable.xcstrings": _catalog({
            "선물·초대 코드가 있어요": {"localizations": {"en": _unit("I have a code")}},
            "등록": {"localizations": {"en": _unit("Redeem")}},
            "plan.title": {"localizations": {"ja": {"variations": {"plural": {"other": _unit("パーソナルプランを贈りました")}}}}},
            "알람톡 이용권": {"localizations": {"en": _unit("Use a coupon")}},
            "이용권 코드 공유": {"localizations": {"en": _unit("Share plan code"), "ja": _unit("利用券コードを共有")}},
        })})
        hits = audit(root)
        wheres = {(hit.where, hit.term) for hit in hits}
        self.assertIn(("키 '선물·초대 코드가 있어요'", "선물"), wheres)
        self.assertIn(("키 '등록' · en", "redeem"), wheres)
        self.assertIn(("키 'plan.title' · ja", "贈"), wheres)
        self.assertIn(("키 '알람톡 이용권' · en", "coupon"), wheres)
        self.assertIn(("키 '이용권 코드 공유'", "이용권 코드"), wheres)
        self.assertIn(("키 '이용권 코드 공유' · en", "plan code"), wheres)
        self.assertIn(("키 '이용권 코드 공유' · ja", "利用券コード"), wheres)

    def test_invite_and_group_plan_copy_in_both_apps(self) -> None:
        root = self.fixture({
            "apps/ios-native/AlarmTalk/Localizable.xcstrings": _catalog({
                "초대 코드 등록": {"localizations": {"en": _unit("Register invite code"), "ja": _unit("招待コード登録")}},
                "가족·커플 이용권을 구독하면 여기에서 함께 쓰는 사람을 관리할 수 있어요.": {"localizations": {
                    "en": _unit("Subscribe to a Family or Couple plan to manage members here."),
                    "ja": _unit("ファミリー・カップルプランを購読すると、ここでメンバーを管理できます。"),
                }},
            }),
            "apps/android-native/app/src/main/res/values/strings.xml": (
                '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <string name="msg_voice_share_couple_family_required">음성 공유는 커플/가족 이용권에서 사용할 수 있어요</string>\n'
                '    <string name="relationship_family">가족</string>\n'
                "</resources>\n"
            ),
        })
        found = {(hit.where, hit.term) for hit in audit(root)}
        self.assertEqual(found, {
            ("키 '초대 코드 등록'", "초대 코드"),
            ("키 '초대 코드 등록' · en", "invite code"),
            ("키 '초대 코드 등록' · ja", "招待コード"),
            ("키 '가족·커플 이용권을 구독하면 여기에서 함께 쓰는 사람을 관리할 수 있어요.'", "커플·가족 이용권"),
            ("키 '가족·커플 이용권을 구독하면 여기에서 함께 쓰는 사람을 관리할 수 있어요.' · en", "Couple·Family plan"),
            ("키 '가족·커플 이용권을 구독하면 여기에서 함께 쓰는 사람을 관리할 수 있어요.' · ja", "カップル・ファミリープラン"),
            ("msg_voice_share_couple_family_required (values)", "커플·가족 이용권"),
        })

    def test_identifier_keys_and_comments_are_not_user_facing(self) -> None:
        root = self.fixture({"apps/ios-native/AlarmTalk/Localizable.xcstrings": _catalog({
            "code.redeem.submit": {"comment": "gift", "localizations": {"en": _unit("Register")}},
        })})
        self.assertEqual(audit(root), [])

    def test_android_values_but_not_names_or_comments(self) -> None:
        root = self.fixture({"apps/android-native/app/src/main/res/values-ja/strings.xml": (
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            '    <string name="billing_gift_personal_action">ギフト</string>\n'
            '    <plurals name="n"><item quantity="other">%d枚のクーポン</item></plurals>\n'
            '    <string-array name="a"><item>Invite or gift code</item></string-array>\n'
            "</resources>\n"
        )})
        found = {(hit.where, hit.term) for hit in audit(root)}
        self.assertEqual(found, {
            ("billing_gift_personal_action (values-ja)", "ギフト"),
            ("n[other] (values-ja)", "クーポン"),
            ("a[0] (values-ja)", "gift"),
        })

    def test_vocabulary_calibration(self) -> None:
        def hit(text: str) -> List[str]:
            return [term for term, _ in find_terms(text, TEXT_TERMS)]
        self.assertEqual(hit("Promotional messages are only sent between 8am and 9pm"), [])
        self.assertEqual(hit("이용권 보기 · 지금 이용권을 쓰는 중이에요 · Your Personal plan is active · 利用券を使用中"), [])
        # 맨 가족·커플·초대(관계 라벨·소개 문구)는 막지 않는다.
        self.assertEqual(hit("가족 · 우리 가족 목소리 · 커플 · 친구를 초대해요 · Family · family voice · 家族の声 · 招待"), [])
        self.assertEqual(hit("가족이 이용권을 함께 쓰던 때 · family planning"), [])
        self.assertEqual(hit("초대 코드 등록"), ["초대 코드"])
        self.assertEqual(hit("Enter an invitation code"), ["invite code"])
        self.assertEqual(hit("招待コードを入力"), ["招待コード"])
        self.assertEqual(hit("커플·가족 이용권 초대 코드를 등록할 수 있어요."), ["초대 코드", "커플·가족 이용권"])
        self.assertEqual(hit("상대 알람은 커플/가족 이용권에서 사용할 수 있어요"), ["커플·가족 이용권"])
        self.assertEqual(hit("가족·커플"), ["커플·가족 이용권"])
        self.assertEqual(hit("가족 플랜 · 커플 요금제"), ["커플·가족 이용권"])
        self.assertEqual(hit("Available on the Couple or Family plan"), ["Couple·Family plan"])
        self.assertEqual(hit("Sharing is available on the Family and Couple plans."), ["Couple·Family plan"])
        self.assertEqual(hit("カップル・ファミリープランでご利用いただけます"), ["カップル・ファミリープラン"])
        self.assertEqual(hit("家族プラン"), ["カップル・ファミリープラン"])
        self.assertEqual(hit("초대·선물 코드"), ["선물"])
        self.assertEqual(hit("개인 이용권 선물하기"), ["선물"])
        self.assertEqual(hit("프로모션 코드"), ["프로모 코드"])
        self.assertEqual(hit("Enter a promo-code"), ["promo code"])
        self.assertEqual(hit("Gifted plan codes"), ["gift", "plan code"])
        self.assertEqual(hit("공유할 이용권 코드가 없어요."), ["이용권 코드"])
        self.assertEqual(hit("共有できる利用券コードがありません。"), ["利用券コード"])
        self.assertEqual(hit("Redeem"), ["redeem"])
        self.assertEqual(hit("プロモーションコード"), ["プロモーションコード"])
        self.assertEqual(hit("오픈소스 라이선스 · 라이선스 전문 · Open source licenses · full license text"), [])
        self.assertEqual(hit("체험 코드를 입력하세요"), ["체험·라이선스 코드"])
        self.assertEqual(hit("Enter your license key"), ["trial·license code"])
        self.assertEqual(hit("ライセンスコード"), ["体験・ライセンスコード"])

    def test_code_finds_retired_ids_formats_kinds_and_codes_outside_comments(self) -> None:
        root = self.fixture({
            "apps/ios-native/AlarmTalk/Gift.swift": 'case personalGift = "com.alarmtalk.app.personal_gift_1m"\n',
            "apps/android-native/app/src/main/java/B.kt": 'if (code.startsWith("GIFT-")) RedeemCodeKind.GIFT\n',
            "packages/backend/src/lib/vouchers.ts": (
                "export type OldKind = 'invite' | 'gift';\n"
                "const RE = /^(INV|GIFT)-[A-Z0-9]{4}$/;\n"
            ),
            "packages/shared/src/schemas/error-codes.ts": "export const ERROR_CODES = ['INVALID_GIFT_PLAN'] as const;\n",
            "apps/ios-native/AlarmTalk/Configuration/StoreKitConfiguration.storekit": '{"products":[{"productID":"com.alarmtalk.app.personal_gift_1m"}]}',
            "packages/backend/scripts/issue-dev-code.ts": "await issueVoucherCode(db, { kind: 'gift' });\n",
        })
        found = set(self.terms(root))
        self.assertIn(("apps/ios-native/AlarmTalk/Gift.swift", "선물 상품 id"), found)
        self.assertIn(("apps/android-native/app/src/main/java/B.kt", "GIFT 형식"), found)
        self.assertIn(("packages/backend/src/lib/vouchers.ts", "'gift' 종류"), found)
        self.assertIn(("packages/backend/src/lib/vouchers.ts", "GIFT 형식"), found)
        self.assertIn(("packages/shared/src/schemas/error-codes.ts", "선물 에러 코드"), found)
        self.assertIn(("apps/ios-native/AlarmTalk/Configuration/StoreKitConfiguration.storekit", "선물 상품 id"), found)
        self.assertIn(("packages/backend/scripts/issue-dev-code.ts", "'gift' 종류"), found)

    def test_group_products_and_invite_issue_paths_in_code(self) -> None:
        root = self.fixture({
            "apps/android-native/app/src/main/java/P.kt": (
                'const val COUPLE_MONTHLY = "couple_monthly"\n'
                "@POST(\"billing/vouchers/family-share\")\n"
            ),
            "apps/ios-native/AlarmTalk/Q.swift": 'case familyMonthly = "com.alarmtalk.app.family_monthly"\n',
            "apps/ios-native/AlarmTalk/Configuration/StoreKitConfiguration.storekit": (
                '{"products":[{"productID":"com.alarmtalk.app.personal_monthly"},'
                '{"productID":"com.alarmtalk.app.couple_monthly"}]}'
            ),
            "packages/backend/src/lib/play-subscriptions.ts": "const products = { personal_monthly: 'personal', family_yearly: 'family' };\n",
            "packages/backend/src/routes/billing-mutation.ts": "billing.post('/vouchers/family-share/regenerate', handler);\n",
        })
        found = sorted((hit.path, hit.where.split("행")[0], hit.term) for hit in audit(root)
                       if hit.term in ("그룹 상품 id", "초대 코드 발급 경로"))
        self.assertEqual(found, [
            ("apps/android-native/app/src/main/java/P.kt", "1", "그룹 상품 id"),
            ("apps/android-native/app/src/main/java/P.kt", "2", "초대 코드 발급 경로"),
            ("apps/ios-native/AlarmTalk/Configuration/StoreKitConfiguration.storekit", "1", "그룹 상품 id"),
            ("apps/ios-native/AlarmTalk/Q.swift", "1", "그룹 상품 id"),
            ("packages/backend/src/lib/play-subscriptions.ts", "1", "그룹 상품 id"),
            ("packages/backend/src/routes/billing-mutation.ts", "1", "초대 코드 발급 경로"),
        ])
        # 개인 상품과 남는 호환 응답 경로(`GET /billing/vouchers`·`POST /code/register`)는 걸리지 않는다(기본 판).
        self.assertEqual(audit(self.fixture({})), [])

    def test_gift_identifiers_by_naming_style(self) -> None:
        identifier = dict(CODE_TERMS)["선물 식별자"]
        for line in ("val giftCode = x", "fun sendGift()", "struct PersonalGiftRow", "let isGifted = true",
                     "GIFT_CODE_RE", "IS_GIFT = true", "R.string.billing_gift_personal_action", "apple_gift_deliveries",
                     "body.gift", "giftcards", "'Gift checkout is no longer available'", "'/gift'"):
            self.assertTrue(identifier.search(line), line)
        for line in ("stopRingingIfThisAlarm(alarmId)", "logIfThat()", "image.gif", "shift", "GIFTS", "regift"):
            self.assertIsNone(identifier.search(line), line)

    def test_gift_identifiers_in_code_but_not_comments(self) -> None:
        root = self.fixture({
            "apps/android-native/app/src/main/java/C.kt": (
                "// giftCode 는 주석이라 보지 않는다\n"
                "val giftCode = \"\"\n"
                "fun stopRingingIfThisAlarm() {}\n"
            ),
            "apps/ios-native/AlarmTalk/D.swift": "/* sendGift */ let canSend = true\nfunc sendGift() {}\n",
            "packages/shared/src/schemas/e.ts": "export const IS_GIFT = true; // IS_GIFT\n",
        })
        found = sorted((hit.path, hit.where.split("행")[0]) for hit in audit(root) if hit.term == "선물 식별자")
        self.assertEqual(found, [
            ("apps/android-native/app/src/main/java/C.kt", "2"),
            ("apps/ios-native/AlarmTalk/D.swift", "2"),
            ("packages/shared/src/schemas/e.ts", "1"),
        ])

    def test_backend_route_paths_with_gift(self) -> None:
        root = self.fixture({
            "packages/backend/src/routes/x.ts": (
                "app.post('/billing/regift', handler);\n"
                "// app.post('/gift', handler) 는 주석\n"
                "const url = `/apple/${id}/gifts`;\n"
                'const path = "/billing/checkout";\n'
            ),
            # 라우트 경로 검사는 서버에서만 — 앱의 같은 문자열은 「선물 식별자」 만 본다(`regift` 는 앞이 소문자라 못 잡는다).
            "apps/android-native/app/src/main/java/E.kt": 'val path = "/billing/regift"\n',
        })
        routes = sorted((hit.path, hit.where.split("행")[0]) for hit in audit(root) if hit.term == "선물 라우트 경로")
        self.assertEqual(routes, [("packages/backend/src/routes/x.ts", "1"), ("packages/backend/src/routes/x.ts", "3")])
        self.assertNotIn("apps/android-native/app/src/main/java/E.kt", {hit.path for hit in audit(root)})

    def test_kept_gift_references_are_caught_and_need_the_allowlist(self) -> None:
        root = self.fixture({
            "packages/backend/src/routes/billing-mutation.ts": (
                "const body = await c.req.json<{ plan_key?: unknown; gift?: unknown }>();\n"
                "if (body.gift === true) {\n  return refuse();\n}\n"
            ),
        })
        hits = audit(root)
        self.assertEqual(sorted((hit.path, hit.where.split("행")[0], hit.term) for hit in hits), [
            ("packages/backend/src/routes/billing-mutation.ts", "1", "선물 식별자"),
            ("packages/backend/src/routes/billing-mutation.ts", "2", "선물 식별자"),
        ])
        allow = [
            Allow("packages/backend/src/routes/billing-mutation.ts", "gift?: unknown }>()", "선물 식별자", "시험"),
            Allow("packages/backend/src/routes/billing-mutation.ts", "if (body.gift === true) {", "선물 식별자", "시험"),
        ]
        self.assertEqual(judge(hits, allow), ([], []))

    def test_real_allowlist_entries_are_caught_by_their_own_term(self) -> None:
        # 허용 항목마다 그 글을 코드로 써 보면 그 항목의 어휘에 실제로 걸려야 한다 — 걸리지 않는 항목은 아무것도 막지 않는다.
        files: dict = {}
        for allow in ALLOWLIST:
            self.assertTrue(allow.reason.strip(), allow)
            files[allow.path] = files.get(allow.path, "") + allow.where + "\n"
        remaining, stale = judge(audit(self.fixture(files)), ALLOWLIST)
        self.assertEqual((remaining, stale), ([], []))

    def test_strings_hide_no_code_and_comments_hide_no_strings(self) -> None:
        root = self.fixture({"apps/ios-native/AlarmTalk/Url.swift": 'let s = "https://x//y/GIFT-AAAA" /* GIFT- */\n'})
        hits = [hit for hit in audit(root) if hit.path.endswith("Url.swift") and hit.term == "GIFT 형식"]
        self.assertEqual(len(hits), 1)
        self.assertIn("1행", hits[0].where)

    def test_store_listing_blocks_and_tables_but_not_prose(self) -> None:
        listing = CLEAN_LISTING.replace(
            "• 엄마·아빠", "• 개인 1개월 이용권을 선물 코드로 보낼 수도 있어요.\n• 엄마·아빠"
        ).replace("| 가족 목소리로 깨우는 모닝콜 |", "| Gift a plan |").replace("+• 운세 줄", "+• クーポン 줄")
        root = self.fixture({"docs/product/play-store-listing.md": listing})
        found = sorted((hit.term, hit.where.split("」")[0]) for hit in audit(root))
        self.assertEqual(
            [(term, where.split("「")[1]) for term, where in found],
            [("gift", "이름 · 부제"), ("クーポン", "설명"), ("선물", "설명")],
        )

    def test_store_listing_catches_invite_and_group_plan_copy(self) -> None:
        listing = CLEAN_LISTING.replace("| 가족 목소리로 깨우는 모닝콜 |", "| 초대 코드로 모이는 가족 모닝콜 |").replace(
            "+• 운세 줄", "+• 커플은 2명, 가족은 최대 5명이 커플·가족 이용권으로 모여요")
        root = self.fixture({"docs/product/app-store-listing.md": listing})
        found = sorted((hit.term, hit.where.split("「")[1].split("」")[0]) for hit in audit(root))
        self.assertEqual(found, [("초대 코드", "이름 · 부제"), ("커플·가족 이용권", "설명")])

    def test_invite_code_format_is_gone_from_server_code(self) -> None:
        def format_hits(files: dict) -> List[Tuple[str, str]]:
            return sorted((hit.path, hit.where.split("행")[0]) for hit in audit(self.fixture(files))
                          if hit.term == "초대 코드 형식")
        # 깨끗한 판: 호환 응답 스텁의 주석, migrations.ts 의 옛 INSERT, 테스트의 INV- 는 세지 않는다.
        self.assertEqual(format_hits({}), [])
        revived = {
            "packages/backend/src/lib/codes/format.ts": (
                "const VOUCHER_CODE_RE = /^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;\n"
                "export function isValidVoucherCodeFormat(raw: string): boolean {\n"
                "  return VOUCHER_CODE_RE.test(raw);\n"
                "}\n"
            ),
            "packages/backend/src/routes/billing-query.ts": "const sql = `SELECT code FROM voucher_codes WHERE code LIKE 'INV-%'`;\n",
            "packages/backend/scripts/issue-dev-code.ts": "const code = `INV-${block()}-${block()}-${block()}`;\n",
            "packages/shared/src/schemas/code.ts": "export const isInvite = (c: string) => c.startsWith('INV-');\n",
        }
        self.assertEqual(format_hits(revived), [
            ("packages/backend/scripts/issue-dev-code.ts", "1"),
            ("packages/backend/src/lib/codes/format.ts", "1"),
            ("packages/backend/src/lib/codes/format.ts", "2"),
            ("packages/backend/src/lib/codes/format.ts", "3"),
            ("packages/backend/src/routes/billing-query.ts", "1"),
            ("packages/shared/src/schemas/code.ts", "1"),
        ])
        # 형식은 서버·공유 코드에서만 본다 — 앱의 코드 입력은 화면 문구(a)·게이트(e) 검사가 맡는다.
        self.assertEqual(format_hits({"apps/android-native/app/src/main/java/F.kt": 'val ok = code.startsWith("INV-")\n'}), [])
        # 'INVALID' 같은 낱말 속의 INV 는 접두가 아니다.
        self.assertEqual(format_hits({"packages/backend/src/lib/x.ts": "const code = 'INVALID-REQUEST';\n"}), [])

    def test_gate_sources_have_no_code_entry(self) -> None:
        def gate_hits(files: dict) -> List[Tuple[str, str]]:
            return [(hit.path, hit.term) for hit in audit(self.fixture(files)) if hit.term.startswith("게이트")]
        # 깨끗한 판: 주석의 RedeemCodeSheet·TextField 와, 게이트가 아닌 이름 바꾸기 알럿·뒤따르는 시트의 입력은 보지 않는다.
        self.assertEqual(gate_hits({}), [])
        in_block = CLEAN_IOS_VOICES_PANEL.replace(
            "            Button(PaidGateCopy.viewPlans) { onRequestBilling?() }\n",
            "            TextField(String(localized: \"초대 코드\"), text: $code)\n"
            "            Button(PaidGateCopy.viewPlans) { onRequestBilling?() }\n")
        self.assertEqual(gate_hits({IOS_VOICES_PANEL_PATH: in_block}), [(IOS_VOICES_PANEL_PATH, "게이트 코드 입력")])
        in_message = CLEAN_IOS_VOICES_PANEL.replace("Text(PaidGateCopy.message)", "Text(PaidGateCopy.message); CodeRegisterRow()")
        self.assertEqual(gate_hits({IOS_VOICES_PANEL_PATH: in_message}), [(IOS_VOICES_PANEL_PATH, "게이트 코드 입력")])
        editor = CLEAN_IOS_EDITOR_GATE.replace(
            "            Button(\"닫기\", role: .cancel) {}\n",
            "            Button(\"닫기\", role: .cancel) {}\n            Button(String(localized: \"code.redeem.submit\")) {}\n")
        self.assertEqual(gate_hits({IOS_EDITOR_GATE_PATH: editor}), [(IOS_EDITOR_GATE_PATH, "게이트 코드 입력")])
        android = CLEAN_ANDROID_GATE.replace("    IosAlertDialog(\n", "    IosAlertDialog(\n        content = { IosAlertField(code, onRegisterCode) },\n")
        self.assertEqual(gate_hits({ANDROID_GATE_PATH: android}), [(ANDROID_GATE_PATH, "게이트 코드 입력")] * 2)

    def test_gate_sources_are_found_by_name_and_missing_ones_fail(self) -> None:
        def gate_terms(files: dict) -> List[str]:
            return [hit.term for hit in audit(self.fixture(files)) if hit.term.startswith("게이트")]
        moved = "apps/android-native/app/src/main/java/com/alarmtalk/app/ui/gates/PlanGateDialog.kt"
        self.assertEqual(gate_terms({ANDROID_GATE_PATH: None, moved: CLEAN_ANDROID_GATE}), [])
        self.assertEqual(gate_terms({ANDROID_GATE_PATH: None}), ["게이트 구조"])
        self.assertEqual(gate_terms({IOS_EDITOR_GATE_PATH: None}), ["게이트 구조"])
        renamed = CLEAN_IOS_VOICES_PANEL.replace("$planGateOpen", "$paywallOpen")
        self.assertEqual(gate_terms({IOS_VOICES_PANEL_PATH: renamed}), ["게이트 구조"])

    def test_allowlist_covers_and_stale_entries_fail(self) -> None:
        root = self.fixture({"apps/ios-native/AlarmTalk/Localizable.xcstrings": _catalog({
            "등록": {"localizations": {"en": _unit("Redeem")}},
        })})
        allow = Allow("apps/ios-native/AlarmTalk/Localizable.xcstrings", "키 '등록' · en", "redeem", "시험")
        remaining, stale = judge(audit(root), [allow])
        self.assertEqual((remaining, stale), ([], []))
        remaining, stale = judge(audit(self.fixture({})), [allow])
        self.assertEqual((remaining, stale), ([], [allow]))

    def test_excluded_paths(self) -> None:
        root = self.fixture({})
        paths = {hit.path for hit in audit(root)}
        self.assertNotIn("packages/backend/src/lib/migrations.ts", paths)
        self.assertNotIn("apps/android-native/app/src/test/java/GiftTest.kt", paths)
        self.assertNotIn("packages/backend/test/code.test.ts", paths)

    def test_missing_listing_fails(self) -> None:
        root = self.fixture({"docs/product/app-store-listing.md": None})
        self.assertTrue(any(hit.term == "읽기 실패" for hit in audit(root)))


if __name__ == "__main__":
    raise SystemExit(main())
