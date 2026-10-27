# Release Process

## Automatic releases

The `Release` workflow in `.github/workflows/release.yml` is the single entry point for release automation. It runs the type checker, unit tests, build, package-content verification, and CLI smoke tests before releasing.

After the initial release, every push to `main` is evaluated by semantic-release:

- `feat:` creates a minor release.
- `fix:` and `perf:` create a patch release.
- A breaking change (for example, `feat!:` or a `BREAKING CHANGE:` footer) creates a major release.
- Documentation, tests, CI configuration, chores, and refactors do not create releases by themselves.

The workflow updates `package.json` and `CHANGELOG.md`, creates the `vX.Y.Z` Git tag and GitHub Release, and publishes the same version to npm. Use Conventional Commit messages in commits or pull-request titles so release intent is explicit.

## One-time initial npm release

npm currently requires a package to exist before a Trusted Publisher can be configured. This repository has not yet been published, so the first push to `main` initializes a temporary `v0.0.0` baseline and deliberately skips releasing.

### 1. Bootstrap the npm package name

On your own machine, authenticate with the intended npm account and run the public [`setup-npm-trusted-publish` tool](https://github.com/azu/setup-npm-trusted-publish):

```bash
npx setup-npm-trusted-publish nestjs-rag-testset-compiler
```

The tool publishes a clearly marked placeholder at version `0.0.0` by default. It is only a bootstrap package so npm exposes the package settings; it is not this library's implementation. Review the tool's source before running it. The actual library release will be published as `0.1.0`, which supersedes the placeholder version.

### 2. Configure npm Trusted Publishing

Open the new package's **Settings → Trusted publishing** page and add a publisher with these exact values:

- **Provider:** GitHub Actions
- **Organization or user:** `peymanpro`
- **Repository:** `Nestjs-RAG-Testset-Compiler`
- **Workflow filename:** `release.yml`
- **Environment:** leave empty unless the same environment is also configured in GitHub and intentionally required
- **Allowed action:** direct `npm publish`

Do not configure the old `publish.yml` workflow; it has been removed to avoid duplicate publish attempts.

### 3. Publish the actual library once

After saving the Trusted Publisher:

1. Open GitHub **Actions → Release → Run workflow** on the `main` branch.
2. Enable the `initial_release` input and run it once.
3. The workflow runs all quality gates, publishes the real `0.1.0` package through OIDC, creates tag `v0.1.0` and a GitHub Release using `CHANGELOG.md`, then removes the temporary `v0.0.0` baseline tag.
4. Confirm that the npm package shows the real library files and provenance. Subsequent qualifying pushes to `main` are automatic.

The initial-release option is for first publication only. Do not select it after `0.1.0` has been published.

## Security and provenance

Trusted Publishing replaces long-lived npm write tokens with short-lived OIDC credentials. The release job grants `id-token: write`, uses a GitHub-hosted runner and a current npm CLI, and does not require an `NPM_TOKEN` secret in GitHub. npm automatically generates provenance for public packages published through Trusted Publishing.

After the first successful OIDC publish, consider npm's **Publishing access → Require two-factor authentication and disallow tokens** setting for additional protection. A newly created Trusted Publisher must complete its first successful publish within two days; configure it immediately before the initial workflow run.

The `repository.url` in `package.json` must continue to match the canonical GitHub repository URL.

## Troubleshooting

- **No release was created:** commits since the last version tag may contain only non-releasing types such as `docs:` or `ci:`. This is expected.
- **npm rejects OIDC:** verify that the package's Trusted Publisher matches the user, repository, and workflow filename exactly, that direct publishing is allowed, and that the run uses a GitHub-hosted runner.
- **A release fails before publishing:** review the **Release** workflow logs and fix the failing quality gate before retrying.
- **The package version already exists:** never overwrite a released version. Recover the release state or issue a new semantic version.
