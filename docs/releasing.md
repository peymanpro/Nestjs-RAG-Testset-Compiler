# Release Process

## Automated release workflow

The repository publishes the package when a GitHub Release is published. Before creating the first release, confirm that all CI jobs pass on `main` and review the packed file list with `npm pack --dry-run`.

## npm trusted publishing

Configure npm trusted publishing for this package before using the workflow:

1. Create the package on npm under the intended maintainer account or organization.
2. In npm package settings, add a GitHub Actions trusted publisher for `peymanpro/Nestjs-RAG-Testset-Compiler` and the `.github/workflows/publish.yml` workflow.
3. Ensure the package name and repository metadata match exactly.
4. Verify the trusted-publisher environment requirements in npm's current documentation. Do not add a long-lived npm access token to GitHub secrets for this workflow.
5. Publish a GitHub Release only after the code, changelog, package files, and CI results have been reviewed.

The workflow uses OIDC (`id-token: write`) and `npm publish --provenance`. It runs the quality gates and build before publishing. The repository does not claim a package has been published until a successful npm release can be verified.

## Versioning

Use semantic versioning. Until `1.0.0`, minor and patch releases may still include API refinements; document user-visible changes in `CHANGELOG.md`. Do not create release tags manually when the release workflow is configured to publish from GitHub Releases.
