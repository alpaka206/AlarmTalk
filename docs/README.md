# Documentation

Project documentation for **AlarmTalk**, an OS-native voice alarm app.

This documentation is intended for contributors and developers reading the source. It is self-contained — no external doc system is required.

## Index

| Folder | Topic |
|---|---|
| [product/](product/README.md) | Product vision, target users, roadmap |
| [spec/](spec/README.md) | Requirements, user stories, use cases, feature spec |
| [design/](design/README.md) | Information architecture, screens, UX, flow & sequence diagrams |
| [tech/](tech/README.md) | System architecture, database schema, API reference |
| [standards/](standards/README.md) | Coding conventions, git workflow, XP rules, invite design |
| [qa/](qa/README.md) | Test plan, cases, scenarios, bug report template, QA report |
| [manual/](manual/README.md) | End-user manual |
| [legal/](legal/README.md) | Privacy policy, terms, consent copy, store disclosure checklist |
| [native-rebuild/](native-rebuild/README.md) | Phase-by-phase Android/iOS native rebuild prompts |

## Conventions

- Each folder has a single `README.md` covering its topic.
- For localized versions, add `README.ko.md`, `README.ja.md`, etc. next to `README.md`.
- Deep links use `#section` anchors within each README.
- The alarm-ring path must never depend on push notifications, server cron, or network fetch at ring time. Any change that contradicts this is rejected at review.
- External AI calls (voice cloning, TTS) only happen on explicit user actions. Automated tests must not trigger them.
