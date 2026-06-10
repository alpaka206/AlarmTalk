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
│       ├── user.ts         UserPlan, UserSchema
│       └── voice.ts        VoiceProfileStatus, VoiceProfileSchema
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
import { UserSchema } from "@alarmtalk/shared";

const user = UserSchema.parse(await fetchMe());
```

> 현재는 스캐폴드만 있다. 실제 import 는 별도 이슈에서 백엔드·웹·모바일로 점진 확장한다.
