# P3: 배포 설정 정비

## 작업 항목
BACKLOG P3 — 배포 설정 정비

## 변경
- `packages/backend/wrangler.toml` — `[triggers] crons = ["*/5 * * * *"]` 추가

## 무료 티어 제한 정리

### Cloudflare Workers 무료 티어
- 100,000 requests/day
- 10ms CPU time per invocation
- Cron Triggers: 최대 3개 (현재 1개 사용)
- R2: 10GB 스토리지, 1M Class A ops/month, 10M Class B ops/month

### Turso 무료 티어
- 9GB 스토리지
- 25M row reads/month
- 100 databases

### 5분 cron 선택 이유
- 1분 간격은 무료 티어 CPU 부담 (6×24×30 = 4,320 cron 호출/월)
- 5분 간격은 864 cron 호출/월로 안정적
- 알람 정확도: 최대 5분 지연 허용 (푸시 기반이므로 로컬 스케줄링이 주역, 서버 cron은 보조)

## 검증
- Backend typecheck: ✅ 통과
