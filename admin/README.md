# Editorial workspace preview

This is a standalone React and Vite application for the `/admin/` area. It is
kept separate from the public website's HTML, CSS, JavaScript, and assets.

## Run locally

Use Node.js 18 or newer. From this folder, install the dependencies and start
the Vite development server:

```powershell
npm install
npm run dev
```

Open the `/admin/` route shown by Vite, usually
`http://localhost:5173/admin/`. The public website remains available at `/`.

To check a production build:

```powershell
npm run build
```

The static build is written to `admin/dist/`. It uses the root-level
`amplify_outputs.json` to configure the Amplify client and requires an
authenticated member of the Administrators group. The separate local publishing
workflow works only through the Vite development server.

## Cloud connectivity check

Authenticated Administrators can open `#cloud-check` on the dashboard URL and
select **Run read-only check** to list record IDs and display counts for the
three cloud content models. It does not test write access. Storage diagnostics
and migration tools remain available only in local development.

## Publishing to the website

The **Publish** section has two steps:

1. **Review changes** runs a dry run. It lists the publications and research
   projects that will go public, the pages that will be generated, what changed
   since the last publish, and any records left out. Nothing is published.
2. After ticking the confirmation box, **Publish to website** sends that exact
   review. The backend refuses if any content changed since the review; run the
   review again in that case.

On success the backend stores the cleaned-up content and asks GitHub to run the
`publish-content.yml` workflow, which commits the generated pages to `main` and
deploys GitHub Pages. The site usually updates within 2–5 minutes. A success
message means GitHub accepted the request; the Actions tab shows whether the
build finished.

Only cloud records marked Published are included. PDF uploads, images and the
Profile page are not published yet, and pages written by hand are never
overwritten. Publishing works only after the backend is deployed and the GitHub
workflows are installed; see `admin/site-publisher/README.md`. Until then, the
dashboard reports that the website was not updated.

## Creating a local draft

Choose **New entry**, select a content category, then choose to write in the
editor or upload a PDF. Select one or more disciplines from the public Index
and optionally choose specific subjects. These choices come from
`natural-inquiry-index-data.js`; they are not a second hand-maintained tag list.

Titles, descriptions, Index selections, writing, and PDFs can be saved as
drafts in this browser using IndexedDB. Drafts are available only in the same
browser profile on this device; clearing browser data can remove them. There is
no application-managed encryption or cloud backup for these drafts, so do not store sensitive or embargoed
work here and keep another copy of important files.

### Review and publish locally

Select **Review public changes** to save the draft and preview the planned page,
homepage archive entry, uploaded PDF (if any), and chosen Index discipline and
subject associations. **Publish to local site** applies those files to the
project folder. Published writing appears in the homepage archive; its
disciplines and selected subjects open to that entry in the public Index.

This publish action is served only by the local Vite development server and
writes only inside this project folder. It does not push to GitHub or deploy to
AWS. Review the generated files in VS Code, then use your usual Git and
deployment workflow separately. The production dashboard build does not include
a publishing API.

The Overview combines cloud publications with local browser drafts.

## Publications library

The **Publications** sidebar opens a separate editorial library. Create a
publication to use the document-style editor, formatting tools, Index subject
tags, references, publication date, and an article preview. The library can
search and filter cloud publications, and supports editing, duplicating,
archiving/restoring, and confirmed deletion.

Publication records are read from and saved to Amplify Data. Autosave runs as
you edit, and **Save draft** also saves immediately. Publication status is a
cloud workspace label; changing it does not update the public website.

## Research workspace

The **Research projects** section reads projects from Amplify Data. It supports
searching, previewing, editing, creating, and deleting cloud projects. Changes
do not modify the public HTML pages.

## Profile workspace

The **Profile** tab is separate from **Research projects**. It includes the
profile introduction, biography, education, research interests, research
experience, methods and skills, Academic CV information, and professional
contact section when those records exist in Amplify Data. Profile edits are
saved to the cloud; they do not update `profile.html`, upload media, or publish
changes. The dashboard updates existing profile records rather than creating
new ones.

## Subject Index workspace

The **Subject index** tab edits the directory taxonomy used by the public
Natural Inquiry Index and the Publications editor. Rename disciplines or
topics, add new ones, and remove entries. **Save Index** writes the taxonomy to
`natural-inquiry-index-data.js` in this local project; the Vite-only local API
does not push changes to GitHub or deploy to AWS.

Removing a discipline or topic unfiles its Index relationships from saved
publication metadata. It does not delete the writing or other publication
content. Changes are written atomically to the local project files.
