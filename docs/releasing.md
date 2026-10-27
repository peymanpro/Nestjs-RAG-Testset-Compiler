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

The first push to `main` initializes a temporary `v0.0.0` baseline and deliberately skips publishing. This prevents the release infrastructure from attempting to publish before npm Trusted Publishing has been configured.

After completing the npm setup below:

1. Open **Actions → Release → Run workflow** on the `main` branch.
2. Enable the `initial_release` input and run the workflow once.
3. The workflow publishes the current `0.1.0` package, creates the `v0.1.0` GitHub Release from `CHANGELOG.md`, and removes the temporary `v0.0.0` baseline tag.
4. Verify the package and provenance on npm. Subsequent qualifying pushes to `main` are automatic.

The initial-release option is for first publication only. Do not select it after `v0.1.0` has been published.

## npm Trusted Publishing (OIDC)

Before the first release, create the npm package for the name `nestjs-rag-testset-compiler` and add a Trusted Publisher with these exact values:

- **Provider:** GitHub Actions
- **Organization or user:** `peymanpro`
- **Repository:** `Nestjs-RAG-Testset-Compiler`
- **Workflow filename:** `release.yml`
- **Environment:** leave empty unless the same environment is also configured in GitHub and intentionally required

Allow direct `npm publish` for this publisher. The workflow grants `id-token: write` and uses a GitHub-hosted runner with a current npm CLI; OIDC is used instead of a long-lived `NPM_TOKEN` secret. npm automatically generates provenance for public packages published through Trusted Publishing.

The repository metadata in `package.json` must continue to match the canonical GitHub repository URL. Do not configure the old `publish.yml` workflow as the Trusted Publisher; it is replaced by `release.yml` to avoid publishing the same version twice.

## Troubleshooting

- **No release was created:** the commits since the last version tag may contain only non-releasing types such as `docs:` or `ci:`. This is expected.
- **npm rejects OIDC:** verify that the package's Trusted Publisher matches the user, repository, and workflow filename exactly, that direct publishing is allowed, and that the action uses a GitHub-hosted runner.
- **A release fails before publishing:** review the **Release** workflow logs and fix the failing quality gate before retrying.
- **The package is already published:** do not try to reuse a version. Fix the release state and publish a new semantic version.
