# Contributing to AlarmTalk

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js 22+
- npm 9+
- Git
- JDK/Android SDK for native Android work

### Setup

```bash
git clone https://github.com/alpaka206/AlarmTalk.git
cd AlarmTalk
npm install
```

### Development

```bash
# Run all type checks
npm run typecheck

# Run all tests
npm test

# Backend (Cloudflare Workers)
cd packages/backend && npm run dev
```

```powershell
# Android dev debug build (Windows, from repo root)
apps\android-native\gradlew.bat -p apps\android-native :app:assembleDevDebug
```

```bash
# Android dev debug build (macOS/Linux, from repo root)
apps/android-native/gradlew -p apps/android-native :app:assembleDevDebug
```

## How to Contribute

### Reporting Bugs

1. Check existing issues first
2. Use the **Bug Report** issue template
3. Include steps to reproduce, expected vs actual behavior

### Suggesting Features

1. Open a Feature Request issue
2. Describe the use case and proposed solution

### Pull Requests

1. Fork the repository
2. Create a feature branch from `develop`: `git checkout -b feat/my-feature develop`
3. Make your changes
4. Ensure tests pass: `npm test`
5. Ensure type checks pass: `npm run typecheck`
6. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
7. Push and open a PR targeting `develop`

### Branch Strategy

- `main` — production-ready code
- `develop` — integration branch for next release
- `feat/*`, `fix/*` — feature/fix branches from develop

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) prefixes, with the message body written in **Korean** (repository convention):

```
feat: 음성 프로필 API 추가
fix: 알람 스케줄링 크래시 수정
docs: dev 테스트 핸드오프 문서 갱신
refactor: 알람 쿼리 헬퍼 분리
```

## Code Standards

- TypeScript strict mode
- No API keys or secrets in client code
- Voice data privacy is paramount — encrypt at rest and in transit
- Mobile-first design
- Korean as default UI language, English supported
- Error handling + loading/empty state UI required

## Security

If you find a security vulnerability, **DO NOT** open a public issue. See [SECURITY.md](../SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
