# English-first release validation

Validated on 2026-10-04. This record covers the English-first interface and bilingual documentation update.

## Product changes

- English is the default interface language. The header offers English and 简体中文, remembers the browser preference, and synchronizes changes across tabs.
- Navigation, the three-stage studio, platform metadata, account configuration, profiles, queue states, settings, validation messages, and accessible labels support both languages.
- Switching the interface language preserves saved content and unsaved form edits. Output language remains controlled by the writing profile; without a profile, generated content follows the source language.
- Platform searches recognize English and Chinese names in either interface language. Compact platform marks keep long English names from overflowing.
- The English README and Chinese README include real screenshots. The detailed operating instructions are available in the English user guide.

## Automated checks

`npm test` passed **139/139 tests**, with no failures, skips, or cancellations. `npm run build` passed TypeScript checking, server compilation, and the Vite production build.

Localization regressions cover default and persisted locale selection, unavailable browser storage, safe interpolation, unknown translation keys, controlled system metadata, preservation of user-authored content and receipts, all 102 platform definitions, bilingual search, and compact platform marks. Content tests cover language inference and explicitly configured output languages.

## Browser checks

Checks used an isolated local data directory, separate from the user's normal workspace and the production database.

- All seven main pages were checked in English at desktop and 390 × 844 mobile dimensions. The mobile pages had no horizontal overflow.
- English and Chinese selection survived a reload. Changing language preserved an unsaved source draft.
- Rules-based generation, individual version review, and the distribution stage were exercised. No publishing task was submitted.
- Both README screenshots were captured from the running application after the layout and translation changes.

These checks do not validate third-party account permissions or live AI credentials. No social-platform posts were made. Local browser checks and production HTTP checks are separate; the deployment record reports the latter when completed.
