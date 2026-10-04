# English-first production update — 2026-10-04

The English-first release is deployed at [Creator Platform](https://myaistock.top/creator-platform/). The container is healthy, and post-update public HTTP verification passed. The interface defaults to English and offers a persisted English/简体中文 switch; interface language remains independent of the writing profile's content language.

This updates the existing single-user workspace. It preserves its data, credentials, authenticated entry point, and the other applications on the server. The [initial deployment record](./SERVER-DEPLOYMENT-20261003.md) remains historical evidence for the first rollout.

## Release identity

All timestamps below are UTC.

| Item | Actual value |
| --- | --- |
| Release | `20261004T120525Z` |
| Deployed source commit | `50c3aec520f577d27a0e84210c0a1b451086ca44` |
| Image | `creator-platform:20261004T120525Z` |
| Image ID | `sha256:fdbce045e9f9f6bd775ae2dce7e87acbec72ca6d3519dd59bb0f31ad578b6b06` |
| Archive SHA-256 | `8bd635d264fb7deaa9b5d76c170084dae5324f77cb9990b451e35b5a33d11b95` |
| Archive size / sealed files | `674936` bytes / `90` files |
| Manifest SHA-256 | `54dfb77f1bc39995f152d65afb798254a45bc469c7b85961fc9fe4913019cd26` |
| Pinned Node base | `node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c` |
| Release directory | `/opt/creator-platform/releases/20261004T120525Z` |
| Build verified | `2026-10-04T12:14:32Z` |
| Cutover completed | `2026-10-04T12:14:57Z` |
| Public verification | `2026-10-04T12:15:23.748581Z` |

Packaging required a clean repository and verified every tracked source file against its committed blob. The archive contains committed source plus the reviewed `dist/server` and `client/dist` outputs; private data, environment files, credential files, and high-confidence secret patterns were rejected. The frontend uses the `/creator-platform/` base. This record and subsequent README links are documentation-only follow-ups; the deployed application remains tied to the source commit above.

## Validation and results

Local validation passed **139/139 tests** and the full production build, including TypeScript checking and server compilation. Isolated browser checks covered all seven pages in English at desktop and 390 × 844 mobile dimensions, persistent English/Chinese selection, unsaved-draft preservation during language changes, generation, review, and distribution-stage navigation. Real application screenshots accompany both READMEs. See [English-first validation](./LOCALIZATION-VALIDATION.md).

The remote build receipt was `BUILD_VERIFIED`. Its smoke test used isolated tmpfs data, without mounting production data, and checked proxy/Origin protection, static subpath assets, the 102-target catalog, and protected image upload/read behavior. The creator-only cutover receipt was `DEPLOYED`, with a healthy container and preserved authentication, vault, and all five unrelated running containers.

Post-update public verification used GET requests only and passed:

- Anonymous page, health, bootstrap, and uploads requests returned `401`; cross-site Origin returned `403`.
- Authenticated page, health, bootstrap, and deep links returned `200`; unknown API routes returned `404`.
- The HTML and both referenced assets, `index-ByhdaEn9.js` and `index-CpwMzuJG.css`, matched the sealed manifest hashes.
- The bootstrap returned remote mode and 102 adaptation targets. Before/after record counts and IDs were unchanged; the production workspace had zero contents, profiles, connections, or jobs.
- The existing site root and QuantEvo health returned `200`.

Production contained no media to sample. Actual image upload/read was tested only in the isolated smoke environment; this update did not add production test content. Production HTTP checks do not constitute production browser UI validation. No social-platform publishing task was submitted, and live AI credentials or third-party account permissions were not tested. The 102 targets describe adaptation coverage, not 102 authorized automatic publishing integrations.

## Preservation and guarded cutover

The first build invocation stopped at its initial baseline guard before any deployment mutation: QuantEvo had independently changed image/start state since the earlier snapshot. A read-only refresh confirmed that only QuantEvo changed; creator, authentication, vault-key hashes, and the other four services matched. Build/release receipts were absent. The corrected baseline was reviewed and scripts regenerated; the guard was not bypassed.

The successful update retained the existing proxy token, Nginx/BasicAuth configuration, and persistent `/opt/creator-platform/data` directory. Only the `creator-platform` Compose service was switched. Its port remains bound to host loopback; its container uses a read-only root filesystem and the existing data lock.

Before cutover, the script required a quiescent queue and saved a consistent SQLite snapshot, the vault key, and the previous deployment environment/Compose configuration under the new release's `backup/` directory. The old creator service stopped normally before the new one started. Health, image, port, mount, queue lock, authentication files, vault key, record IDs/counts, and unrelated-service fingerprints were checked. This release introduced no database schema migration.

## Rollback and evidence

The previous recovery target remains release `20261003T083742Z`, image `creator-platform:20261003T083742Z`, image ID `sha256:516c48e38cbaed0c6461a3f317c6ccdc4e7da923ea4bcd371de2feb24891f4af`. Reviewed recovery restores that application symlink, Compose configuration, and image while retaining the current user database, vault, and uploads. It never restores the audit snapshot over user data. Explicit rollback checks the active release and requires a quiescent queue. **Rollback was not executed.**

The release's local evidence directory contains `plan.json`, `SHA256.json`, the archive, readable script sources, the corrected baseline, saved invocation results, `cp-120525-build-v2-output.txt`, `cp-120525-update-v2-output.txt`, and `after-public.json`. Server `build.json`, `release.json`, and any `rollback.json` are durable operation receipts. Unknown command outcomes require polling the original invocation and reading its receipt before another operation is considered. These private operational artifacts are not included in the repository; this record contains no access credentials.
