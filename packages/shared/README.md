# @alarmtalk/shared

모노레포 공용 타입·zod 스키마 패키지.

- 루트 `package.json` 의 workspaces(`packages/*`) 에 자동 포함된다.
- 백엔드/웹/모바일에서 import 하여 API 계약 타입과 런타임 validator 를 공유한다.

## 구조

```
packages/shared/
├── src/
│   ├── index.ts            barrel export
│   └── schemas/
│       ├── auth.ts         표시 이름·인증 입력 규칙
│       ├── fortune.ts      운세 입력 규칙
│       └── voice.ts        목소리 등록·합성 입력 규칙
├── test/
│   └── schemas.test.ts     zod 스키마 단위 테스트
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 스크립트

```bash
cd packages/shared
npm run typecheck   # tsc --noEmit
npm run test        # vitest
```

## 사용 예

```ts
import { DisplayNameSchema } from "@alarmtalk/shared";

const displayName = DisplayNameSchema.parse(input);
```

백엔드가 런타임 검증에 직접 사용한다. 네이티브 앱은 같은 상한과 정리 규칙을 각 언어의
입력 유틸리티로 미러하며 정적 검사로 대조한다.
