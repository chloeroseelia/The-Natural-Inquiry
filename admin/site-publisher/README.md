# GitHub Pages content publisher

The files in this directory are the sanitized manifest contract and static-site generator used
by the publishing Lambda and the public-site workflows. The two workflows in `github/` are
**templates only**: they are intentionally not installed under `.github/workflows` in the
admin-dashboard checkout.

## How a publish reaches the website

1. The dashboard's **Publish** section runs a review (dry run), then a real publish with the
   review's digest.
2. The Lambda writes the sanitized `published/manifest.json` to the public-content bucket
   (served through CloudFront) and dispatches `publish-content.yml` on GitHub.
3. `publish-content.yml` verifies the manifest's SHA-256, generates pages, commits them to `main`
   with `GITHUB_TOKEN`, then calls `deploy-pages.yml` to deploy GitHub Pages.
4. `deploy-pages.yml` stages only allowlisted public files (`*.html`, `*.css`, `*.js`, `*.svg`,
   `*.xml`, `*.pdf`, `*.txt` at the root, plus `images/`, `writing/` and `research/`) and deploys
   them. It also runs on every ordinary push to `main`, so hand edits keep deploying.

A push made with `GITHUB_TOKEN` does not start other workflows, so the publish workflow deploys
the site itself. This is why Pages must use **GitHub Actions** as its source; no GitHub App is
needed.

## Activation checklist

Do these in order. Steps 1–2 keep the site deploying normally before the Pages source changes.

1. Copy `github/deploy-pages.yml` to `.github/workflows/deploy-pages.yml` on the public
   repository's `main` branch and push it.
2. In **Settings → Pages → Build and deployment**, change **Source** to **GitHub Actions**.
   Confirm the deploy workflow ran and the live site still loads.
3. Commit the `admin/site-publisher/` generator files to a commit that is accessible in the
   public repository (it does not need to be on `main`), and set the repository variable
   `PUBLISHER_TOOLS_REF` to that full 40-character commit SHA. A local or unpushed commit is not
   sufficient.
4. Deploy the approved Amplify backend, including the publish function and the public-content
   bucket and CloudFront distribution. No deployment is performed by this project code.
5. Set the repository variable `PUBLIC_CONTENT_DOMAIN` to that CloudFront domain
   (`xxxx.cloudfront.net`).
6. Create a fine-grained GitHub token limited to this repository with **Actions: Read and write**
   (the minimum that permits `workflow_dispatch`). Store it in AWS Systems Manager Parameter Store
   as a `SecureString` named `/natural-inquiry/github-dispatch-token`, in the backend's region.
   Never store it in this repository.
7. Copy `github/publish-content.yml` to `.github/workflows/publish-content.yml` on `main`. Do not
   copy the admin repository's root `amplify.yml`.
8. Confirm branch rules on `main` allow `github-actions[bot]` to push, then publish one test record
   from the dashboard and check the Actions run and the live page.

## Implemented content and limits

- Published, non-archived Publications and ResearchProject records can produce sanitized HTML
  pages and the `natural-inquiry-published-entries.js` index data file. The generator preserves
  handwritten pages and only removes stale generated HTML pages bearing its marker.
- ProfileContent records are allowlisted, validated and included in the sanitized manifest, but
  the static generator does not yet render them into the existing profile page. Profile
  publishing to the website is therefore **not implemented**.
- Images, PDFs, private admin-media objects and media URLs are not published. Media markup is
  removed, and PDF publications are excluded until a separate public-media design is approved.
- The publisher Lambda's AppSync resource authorization is limited to `query` (no mutation or
  subscription access). Amplify Gen 2 exposes this resource authorization at schema scope;
  model-level authorization callbacks use a modifier that does not support resource rules.
  Consequently, the IAM GraphQL query grant is not model-scoped, although the Lambda requests
  only the three required models and explicit public-field selections. Narrower API access would
  require a separate data-access design rather than a model-level rule that this API cannot type.
- The workflow requires a SHA-256 for each dispatch and verifies the downloaded manifest bytes
  before generation. The digest confirms byte equality; it is not proof of who initiated a
  manual workflow dispatch.
- Retrying a real publish with unchanged content dispatches the existing manifest using its
  original SHA-256 without rewriting it. A dispatch response confirms a request, not that
  GitHub Actions or Pages completed successfully.
- Real requests require the digest returned by a dry-run review. The backend recomputes it
  from the sanitized content, exclusions, notes, warnings and current public-manifest bytes;
  a mismatch is refused before writing or dispatch. The digest is not a signature, proof of
  human review, or an authorization credential. Publishing remains Administrator-only.
  The dashboard requires an explicit confirmation checkbox before it sends a real publish.

Run the local synthetic suites from this directory with `npm test`; run the workflow/apply tests
with `node tests/apply-manifest.test.mjs`. These tests do not contact AWS or GitHub.
