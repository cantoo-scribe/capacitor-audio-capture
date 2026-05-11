# Publishing to npm

Maintainer release checklist for `@cantoo/capacitor-audio-capture`.

## One-time setup
- npm account with access to `@cantoo` (`npm whoami`, `npm org ls cantoo`).
- 2FA enabled.
- `pnpm` installed (pinned via `packageManager` in `package.json`).

## Release

```bash
# 1. Clean working tree on main, in sync with origin
pnpm install --frozen-lockfile
pnpm run lint
pnpm run build
pnpm pack --dry-run        # audit tarball contents

# 2. Update CHANGELOG.md: move [Unreleased] → [x.y.z] — YYYY-MM-DD

# 3. Bump version (creates commit + tag)
pnpm version <patch|minor|major>

# 4. Publish (prompts for OTP)
npm publish

# 5. Push
git push origin main --follow-tags
```

Cut a GitHub release matching the tag and pasting the CHANGELOG entry.

## Pre-release

```bash
pnpm version prerelease --preid=beta
pnpm run build
npm publish --tag beta
```

Install with `pnpm add @cantoo/capacitor-audio-capture@beta`. `latest` is untouched.

## Deprecate (instead of unpublish)

```bash
npm deprecate @cantoo/capacitor-audio-capture@x.y.z "Reason."
```

Then publish a patch fix.

## Troubleshooting

- `E403` on publish — `publishConfig.access: public` missing (already set).
- `OTP required` — provide your 2FA code.
- `prepublishOnly` failed — run `pnpm run build` and `pnpm run lint` separately.
- Bundle missing inlined worker — re-run `pnpm run build` and check `dist/`.
