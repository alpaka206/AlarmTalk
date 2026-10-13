#!/usr/bin/env python3
"""코드를 쳐서 유료 기능을 여는 길(선물·프로모·쿠폰 코드)이 **화면 문구·코드·스토어 문구로 돌아오지 않게** 막는다.

## 왜 있는가

App Store 가 심사 지침 3.1.1("인앱 결제가 아닌 수단으로 기능을 열면 안 된다")로 두 번 반려했다. iOS 1.2.11 은 프로모
코드, 1.2.12 는 선물 코드였다(둘 다 2026-10-12). 첫 번째 때 **사례**(프로모 코드)만 지우고 같은 **종류**(선물 — 산
사람은 스토어로 냈어도 받는 사람은 코드를 쳐서 연다)를 남긴 것이 두 번째 반려의 원인이다. 스토어 설명과 심사 노트도
그 기능을 직접 내보였다. 지침 3.1.1 은 라이선스 키·QR 코드도 같은 것으로 든다.

규칙의 유일 출처는 `docs/spec/plan-gates.md` 「선물 코드 — 폐지」 다. 코드로 유료 기능을 얻는 길은 주인이 이미 결제한
커플·가족 그룹에 합류하는 **초대 코드(INV-) 하나**뿐이고, 할인·무료 이용은 스토어 오퍼 코드로 준다. 규칙을 문서에만
두면 다음 사람이 '쿠폰'·'체험 코드' 같은 새 이름으로 같은 것을 다시 만든다 — 그래서 낱말과 형식을 CI 에서 막는다.
서버가 받지 않는 것이 실질 차단이고(옛 앱이 남는다), 이 검사는 그 차단이 다시 풀리는 변경을 머지 전에 잡는 그물이다.

## 무엇을 보는가

(a) **두 앱의 화면 문구** — 아래 「어휘」 를 찾는다.
    - iOS: `apps/ios-native/` 아래 모든 `*.xcstrings` 의 키와, 모든 언어의 값(`variations`·`substitutions` 안까지).
      키는 한국어 원문이라 그대로 화면에 나온다. 다만 점으로 이은 식별자 키(`code.redeem.submit` 꼴)는 화면에 나오지
      않으므로 그 키는 건너뛰고 값만 본다. `comment` 는 번역자용이라 보지 않는다.
    - Android: `app/src/<테스트가 아닌 소스 세트>/res/values*/*.xml` 의 `<string>`·`<plurals>/<item>`·
      `<string-array>/<item>` 의 글. `name` 속성(`code_redeem_placeholder` 같은 키)과 XML 주석은 화면에 나오지
      않으므로 보지 않는다.
(b) **앱·서버 코드** — 은퇴한 선물 상품 id(`personal_gift`·`personalGift`), 선물 코드 형식(`GIFT-…` 와 `(INV|GIFT)`·
    `'GIFT'` 같은 접두), 선물 종류 문자열(`'gift'`), 선물 에러 코드(`GIFT_PERSONAL_ONLY`·`INVALID_GIFT_PLAN`), 그리고
    **이름 속의 gift**(「선물 식별자」 — `giftCode`·`sendGift`·`gift_code`·`IS_GIFT`).
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
    - 남겨 둔 것은 「선물 식별자」 에 **걸리고**, 허용 목록에 줄마다 이유와 함께 있다: 이력 표 이름
      `apple_gift_deliveries`(탈퇴 정리 SQL)와, dev 스텁 `POST /billing/checkout` 이 옛 요청의 `gift: true` 를 읽어서
      거절하는 자리(`body.gift` 와 그 거절 문구).
(c) **스토어 문구 원본** — 「어휘」 를 찾는다. `docs/product/app-store-listing.md`·`play-store-listing.md` 는 올리는 값을
    펜스 블록(```text·```diff)과, 이름·제목·부제·짧은 설명 절의 표에 둔다. 그 둘만 본다 — 같은 파일의 「지금 상태」
    같은 설명문은 지운 문장을 인용하는 이력이라 보지 않는다. 새 칸을 설명문에 적으면 이 검사가 못 본다 — 올리는 값은
    펜스 블록에 둔다.
(d) **초대 코드 형식** — 낱말로는 새 접두(`TRY-`·`VIP-`)를 미리 알 수 없으니 형식 자체를 고정한다. `packages/backend/src`
    에 `VOUCHER_CODE_RE` 정의가 **하나** 있고 값이 INV- 4-4-4(`EXPECTED_VOUCHER_RE`) 그대로여야 하며, 그것을 쓰는
    `isValidVoucherCodeFormat` 의 본문이 `return VOUCHER_CODE_RE.test(<인자>);` 한 줄이어야 한다(함수 안에서 접두를 하나
    더 받는 우회를 막는다). 정의는 이름으로 찾으므로 파일을 옮겨도 따라간다. 형식을 넓히는 변경은 이름이 무엇이든
    여기서 실패한다 — 넓히지 않는 정리(정규화 등)라면 이 검사를 함께 고친다.
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
- 법무 문서(`docs/legal`, 두 앱에 실린다): 처리방침은 보관하는 기록의 종류로 '이용권 또는 쿠폰 사용 기록' 을 적는다 —
  지난 프로모 코드의 사용 기록이 이력으로 남아 있으니 사실이고, 코드로 무엇을 연다는 말이 아니다. 문구를 바꾸려면 문서
  버전과 앱 릴리스를 함께 맞춰야 하므로(`CLAUDE.md` 「법무 문서 버전」) 이 검사로 묶지 않는다. 다음 문서 버전에서 고친다
  (`docs/qa/dev-test-handoff.md`).
- 웹 랜딩(`apps/landing`): 앱 화면도 스토어 문구도 아니다(2026-10-14 에 선물·쿠폰 낱말이 없음을 확인했다).

## 어휘 — 2026-10-14 의 화면 문구에 맞춰 골랐다

- 한국어: `선물`(선물 코드·선물하기·이용권 선물·'선물·초대 코드' 를 모두 덮는다 — 띄어 쓴 구절만 막으면 지운 문구
  '선물·초대 코드가 있어요' 가 빠져나간다), `기프트`, `쿠폰`, `바우처`, `프로모(션) 코드`, `체험 코드`·`라이선스 코드/키`,
  `이용권 코드`.
- 영어: `gift…`(gifted·gifting 포함), `promo code`·`promotional code`, `coupon`, `voucher`, `redeem…`·`redemption`,
  `trial code`·`activation code`·`license code/key`, `plan code`.
- 일본어: `ギフト`, `贈`(贈る — 선물하다. 지운 선물 공유 문구 'プランを贈りました' 는 ギフト 없이 이 글자만 썼다),
  `プレゼント(コード)`, `プロモーションコード`, `クーポン`, `バウチャー`, `体験コード`·`ライセンスコード/キー`·
  `アクティベーションコード`, `利用券コード`.
- 체험·라이선스 쪽은 지운 문구가 아니라 규칙(「선물 코드 — 폐지」 의 '체험·라이선스 코드를 새로 만들지 말 것')을 따라
  미리 막는 것이다. '오픈소스 라이선스'·'라이선스 전문' 처럼 코드·키가 붙지 않은 말은 걸리지 않는다.
- `이용권 코드`·`plan code`·`利用券コード` 는 2026-10-14 2차에 막았다. 커플·가족 카드의 '이용권 코드 공유' 가 초대 코드를
  가리켰지만, 이용권을 여는 코드(라이선스 키)로 읽혀 '초대 코드 공유' 로 바꿨다(용어집 `docs/spec/localization.md`).
- 대소문자는 가리지 않는다. 막지 **않는** 것: '프로모션'·'promotional' 혼자(마케팅 동의의 "Promotional messages"
  처럼 코드가 아닌 뜻이다), `초대 코드`·`invite code`·`招待コード`, 코드 없이 쓴 `이용권`·`plan`.

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
    ("gift", re.compile(r"\bgift", re.IGNORECASE)),
    ("promo code", re.compile(r"\bpromo(?:tional)?[\s-]*codes?\b", re.IGNORECASE)),
    ("coupon", re.compile(r"\bcoupons?\b", re.IGNORECASE)),
    ("voucher", re.compile(r"\bvouchers?\b", re.IGNORECASE)),
    ("redeem", re.compile(r"\bredeem|\bredemption", re.IGNORECASE)),
    ("trial·license code", re.compile(r"\b(?:trial|activation)\s+codes?\b|\blicen[cs]e\s+(?:codes?|keys?)\b", re.IGNORECASE)),
    ("plan code", re.compile(r"\bplan\s+codes?\b", re.IGNORECASE)),
    ("ギフト", re.compile(r"ギフト")),
    ("贈", re.compile(r"贈")),
    ("プレゼント", re.compile(r"プレゼント")),
    ("プロモーションコード", re.compile(r"プロモーション\s*コード")),
    ("クーポン", re.compile(r"クーポン")),
    ("バウチャー", re.compile(r"バウチャー")),
    ("体験・ライセンスコード", re.compile(r"体験\s*コード|ライセンス\s*(?:コード|キー)|アクティベーション\s*コード")),
    ("利用券コード", re.compile(r"利用券\s*コード")),
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
VOUCHER_FORMAT_ROOT = "packages/backend/src"
# 받는 형식은 초대 코드 하나다. 접두를 더하거나 넓히려면 먼저 `docs/spec/plan-gates.md` 「선물 코드 — 폐지」 를 볼 것.
EXPECTED_VOUCHER_RE = "/^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/"
VOUCHER_RE_DEFINITION = re.compile(r"\b(?:const|let|var)\s+VOUCHER_CODE_RE\b[^=\n]*=\s*")
VOUCHER_FORMAT_FUNCTION = re.compile(r"\bfunction\s+isValidVoucherCodeFormat\s*\(")

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

ALLOWLIST: Tuple[Allow, ...] = (
    Allow(
        path="packages/backend/src/lib/account-deletion.ts",
        where="DELETE FROM apple_gift_deliveries",
        term="선물 식별자",
        reason=(
            "탈퇴 정리(`purgeUserAccount`)가 옛 선물 전달 이력 행을 치우는 SQL 이다. 표는 이력이라 지우지 않았고"
            "(마이그레이션 없음) 그 전에 쓰인 행이 남을 수 있다(`docs/spec/plan-gates.md` 「선물 코드 — 폐지」 의 '이력은 "
            "남긴다'). 표를 없애는 마이그레이션을 하면 이 줄도 지운다."
        ),
    ),
) + tuple(
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


# ── 괄호 짝 (d)·(e) ──────────────────────────────────────────────────────────────────────────
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
def check_voucher_format(root: Path) -> Iterator[Hit]:
    """`VOUCHER_CODE_RE` 가 하나뿐이고 INV- 4-4-4 그대로인지, `isValidVoucherCodeFormat` 가 그것만 보는지."""
    term = "초대 코드 형식"
    definitions: List[Tuple[str, int, str]] = []
    functions: List[Tuple[str, int, str, str]] = []
    for path in walk(root, VOUCHER_FORMAT_ROOT, ".ts"):
        rel = relative(root, path)
        try:
            code = strip_comments(path.read_text(encoding="utf-8"), "ts")
        except (OSError, UnicodeDecodeError) as error:
            yield Hit(rel, "파일", "읽기 실패", str(error))
            continue
        for match in VOUCHER_RE_DEFINITION.finditer(code):
            start = match.end()
            if code.startswith("/", start):
                end = regex_end(code, start)
                while end < len(code) and code[end].isalpha():  # 플래그(`/…/i`)도 값의 일부다
                    end += 1
            else:
                newline = code.find("\n", start)
                end = len(code) if newline == -1 else newline
            definitions.append((rel, line_number(code, match.start()), code[start:end].strip().rstrip(";")))
        for match in VOUCHER_FORMAT_FUNCTION.finditer(code):
            params_end = balanced_end(code, match.end() - 1, "(", ")", "ts")
            parameter = re.match(r"\s*([A-Za-z_$][\w$]*)", code[match.end():params_end])
            brace = code.find("{", params_end)
            if brace == -1:
                continue
            body = code[brace + 1:balanced_end(code, brace, "{", "}", "ts") - 1]
            functions.append((rel, line_number(code, match.start()), parameter.group(1) if parameter else "", body))
    where = f"{VOUCHER_FORMAT_ROOT} 의 `VOUCHER_CODE_RE`"
    if not definitions:
        yield Hit(VOUCHER_FORMAT_ROOT, where, term, "정의를 찾지 못했다 — 옮기거나 이름을 바꿨으면 이 검사(EXPECTED_VOUCHER_RE)도 고칠 것")
    if len(definitions) > 1:
        for rel, number, value in definitions:
            yield Hit(rel, f"{number}행 `VOUCHER_CODE_RE = {value}`", term, f"정의가 {len(definitions)}개다 — 하나만 둔다")
    for rel, number, value in definitions:
        if value != EXPECTED_VOUCHER_RE:
            yield Hit(rel, f"{number}행 `VOUCHER_CODE_RE = {value}`", term, f"INV- 4-4-4 하나여야 한다(`{EXPECTED_VOUCHER_RE}`)")
    if not functions:
        yield Hit(VOUCHER_FORMAT_ROOT, f"{VOUCHER_FORMAT_ROOT} 의 `isValidVoucherCodeFormat`", term,
                  "함수를 찾지 못했다 — 옮기거나 이름을 바꿨으면 이 검사도 고칠 것")
    for rel, number, parameter, body in functions:
        if re.sub(r"\s+", "", body) != f"returnVOUCHER_CODE_RE.test({parameter});":
            yield Hit(rel, f"{number}행 `isValidVoucherCodeFormat`", term,
                      "본문이 `return VOUCHER_CODE_RE.test(…);` 한 줄이 아니다 — 형식을 넓히지 말 것: "
                      + " ".join(body.split())[:120])


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
    hits.extend(check_voucher_format(root))
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
            "\n코드로 유료 기능을 얻는 길은 이미 결제한 커플·가족 그룹에 합류하는 초대 코드(INV-) 하나뿐이다. 선물·프로모·\n"
            "쿠폰 코드와 코드를 발급하는 상품을 되살리지 말고, 할인·무료 이용은 스토어 오퍼 코드로 준다. 유료 게이트에는\n"
            "코드 입력을 두지 않는다 — 초대 코드는 더보기 → 초대 코드 등록에서만 받는다.\n"
            "규칙: docs/spec/plan-gates.md 「선물 코드 — 폐지」. 정당한 예외면 이 스크립트의 ALLOWLIST 에 이유와 함께 둔다.",
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

## 이름 · 부제

| ko | `알람톡: 목소리 알람 시계` | 초대 코드로 모이는 가족 모닝콜 |

## 설명

```text
• 커플은 2명, 가족은 최대 5명이 초대 코드로 모여요.
```

```diff
-• 날씨 줄
+• 운세 줄
```
"""

VOUCHERS_PATH = "packages/backend/src/lib/vouchers.ts"
CLEAN_VOUCHERS = (
    "// 옛 `(INV|GIFT)-` 형식은 지웠다 — 주석의 다른 정의 const VOUCHER_CODE_RE = /^(INV|TRY)-/; 는 세지 않는다\n"
    "export type VoucherKind = 'invite';\n"
    "/** 받는 형식은 초대 코드 하나뿐이다. */\n"
    "const VOUCHER_CODE_RE = /^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;\n"
    "\n"
    "export function isValidVoucherCodeFormat(raw: string): boolean {\n"
    "  return VOUCHER_CODE_RE.test(raw);\n"
    "}\n"
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
                "초대 코드": {"localizations": {"en": _unit("Invite code"), "ja": _unit("招待コード")}},
                "code.redeem.submit": {"localizations": {"ko": _unit("등록"), "en": _unit("Register")}},
                "초대 코드 공유": {"comment": "gift 라는 낱말은 번역자 메모라 보지 않는다",
                               "localizations": {"en": _unit("Share invite code")}},
            }),
            "apps/android-native/app/src/main/res/values/strings.xml": (
                '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                "    <!-- 선물 문구를 되살리지 말 것(주석은 보지 않는다) -->\n"
                '    <string name="code_redeem_placeholder">초대 코드</string>\n'
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
                "/** 옛 `INVALID_GIFT_PLAN`·`GIFT_PERSONAL_ONLY` 갈래는 지웠다 */\n"
                'val ok = code.startsWith("INV-")\n'
                "fun stopRingingIfThisAlarm(alarmId: String) {} // 대소문자를 무시하면 'gIfT' 가 걸린다\n"
            ),
            "packages/backend/src/routes/billing-mutation.ts": (
                "billingMutation.post('/checkout', handler); // '/gift' 라우트는 지웠다\n"
                "const re = /^INV-[A-Z0-9]{4}$/; // (INV|GIFT)- 는 옛 형식\n"
                "const quoteInRegex = /'/g; const after = 'x'; // GIFT 는 주석\n"
            ),
            "packages/backend/src/lib/migrations.ts": "const old = \"INSERT INTO voucher_codes VALUES ('GIFT-AAAA-BBBB-CCCC', 'gift')\";\n",
            "apps/android-native/app/src/test/java/GiftTest.kt": 'val code = "GIFT-AAAA-BBBB-CCCC"\n',
            "docs/product/app-store-listing.md": CLEAN_LISTING,
            "docs/product/play-store-listing.md": CLEAN_LISTING,
            VOUCHERS_PATH: CLEAN_VOUCHERS,
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
        self.assertEqual(hit("초대 코드 공유 · 초대 코드 등록 · Share invite code · Invite code · 招待コードを共有"), [])
        self.assertEqual(hit("이용권 보기 · 지금 이용권을 쓰는 중이에요 · Your Couple plan is active · 利用券を使用中"), [])
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
            "packages/backend/src/lib/vouchers.ts": CLEAN_VOUCHERS + (
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
            "packages/backend/src/routes/billing-mutation.ts": "if (body.gift === true) {\n  return refuse();\n}\n",
            "packages/backend/src/lib/account-deletion.ts": "const sql = `DELETE FROM apple_gift_deliveries WHERE x = ?`;\n",
        })
        hits = audit(root)
        self.assertEqual({(hit.path, hit.term) for hit in hits}, {
            ("packages/backend/src/routes/billing-mutation.ts", "선물 식별자"),
            ("packages/backend/src/lib/account-deletion.ts", "선물 식별자"),
        })
        allow = [
            Allow("packages/backend/src/routes/billing-mutation.ts", "if (body.gift === true) {", "선물 식별자", "시험"),
            Allow("packages/backend/src/lib/account-deletion.ts", "DELETE FROM apple_gift_deliveries", "선물 식별자", "시험"),
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
            "• 커플은 2명", "• 개인 1개월 이용권을 선물 코드로 보낼 수도 있어요.\n• 커플은 2명"
        ).replace("| 초대 코드로 모이는 가족 모닝콜 |", "| Gift a plan |").replace("+• 운세 줄", "+• クーポン 줄")
        root = self.fixture({"docs/product/play-store-listing.md": listing})
        found = sorted((hit.term, hit.where.split("」")[0]) for hit in audit(root))
        self.assertEqual(
            [(term, where.split("「")[1]) for term, where in found],
            [("gift", "이름 · 부제"), ("クーポン", "설명"), ("선물", "설명")],
        )

    def test_voucher_format_is_exactly_inv(self) -> None:
        def voucher_hits(files: dict) -> List[str]:
            return [hit.excerpt for hit in audit(self.fixture(files)) if hit.term == "초대 코드 형식"]
        self.assertEqual(voucher_hits({}), [])
        wider = CLEAN_VOUCHERS.replace("/^INV-[A-Z0-9]{4}-", "/^(INV|TRY)-[A-Z0-9]{4}-")
        self.assertEqual(len(voucher_hits({VOUCHERS_PATH: wider})), 1)
        flagged = CLEAN_VOUCHERS.replace("{4}$/;", "{4}$/i;")
        self.assertEqual(len(voucher_hits({VOUCHERS_PATH: flagged})), 1)
        constructed = CLEAN_VOUCHERS.replace(
            "/^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/", "new RegExp('^(INV|TRY)-[A-Z0-9]{4}$')")
        self.assertEqual(len(voucher_hits({VOUCHERS_PATH: constructed})), 1)
        bypass = CLEAN_VOUCHERS.replace(
            "return VOUCHER_CODE_RE.test(raw);", "return VOUCHER_CODE_RE.test(raw) || raw.startsWith('TRY-');")
        self.assertEqual(len(voucher_hits({VOUCHERS_PATH: bypass})), 1)
        self.assertTrue(voucher_hits({VOUCHERS_PATH: "export const unrelated = 1;\n"}))  # 정의도 함수도 없다
        twice = {"packages/backend/src/lib/other.ts": "const VOUCHER_CODE_RE = /^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;\n"}
        self.assertEqual(len(voucher_hits(twice)), 2)  # 두 정의를 모두 댄다

    def test_voucher_format_follows_a_moved_file(self) -> None:
        root = self.fixture({VOUCHERS_PATH: None, "packages/backend/src/lib/codes/format.ts": CLEAN_VOUCHERS})
        self.assertEqual(audit(root), [])

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

    def test_missing_listing_fails(self) -> None:
        root = self.fixture({"docs/product/app-store-listing.md": None})
        self.assertTrue(any(hit.term == "읽기 실패" for hit in audit(root)))


if __name__ == "__main__":
    raise SystemExit(main())
