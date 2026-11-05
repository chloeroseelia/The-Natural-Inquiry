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

The static build is written to `admin/dist/`. It is not connected to AWS
Amplify or deployed by this project yet. Local publishing currently works only
through the Vite development server.

## Creating a local draft

Choose **New entry**, select a content category, then choose to write in the
editor or upload a PDF. Select one or more disciplines from the public Index
and optionally choose specific subjects. These choices come from
`natural-inquiry-index-data.js`; they are not a second hand-maintained tag list.

Titles, descriptions, Index selections, writing, and PDFs can be saved as
drafts in this browser using IndexedDB. Drafts are available only in the same
browser profile on this device; clearing browser data can remove them. There is
no account, encryption, or cloud backup, so do not store sensitive or embargoed
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

The Overview and Publications library now use the two existing public essays:
**The Choice to Sail Away** and **Seaweed Made Simple: Quick, Affordable Meals
for Busy Students**. The first is loaded from its existing article page; the
second is represented by its existing article page and supplied PDF. The sample
**Birds as Neighbors** page is intentionally excluded because that page is
explicitly marked as illustrative placeholder content. Other sample dashboard
projects and activity have been removed.

## Publications library

The **Publications** sidebar opens a separate editorial library. Create a
publication to use the document-style editor, formatting tools, Index subject
tags, references, publication date, and an article preview. The library can
search and filter browser-saved publications, and supports editing, duplicating,
archiving/restoring, and confirmed deletion.

Publication records are stored in the same local IndexedDB database as entry
drafts, in a separate store. On first setup, the two existing essays are added
to an empty publication library without changing their public pages or PDFs.
They remain in this browser profile after reload;
clearing browser data removes them. Autosave runs as you edit, and **Save draft**
also saves immediately. The editor preview follows the public writing pages'
article layout, but publication status is only a local workspace label. This
feature does not alter public HTML, publish to the website, or deploy to AWS.
No additional packages are required.

## Research workspace

The **Research projects** section is seeded from the four existing pages in
`research/`. It supports searching, previewing, and saving edited copies of
those entries, as well as creating new research project drafts. Drafts are
stored in this browser's IndexedDB and persist across reloads.

Research edits are not yet synced to AWS or written to the public HTML pages.
The initial project page data is read from the existing HTML; edits in the
workspace remain local until an authenticated cloud and publishing workflow is
implemented. No public-site files are modified by this workspace, and it adds
no dependencies.

## Profile workspace

The **Profile** tab is separate from **Research projects**. It includes the
profile introduction, biography, education, research interests, research
experience, methods and skills, Academic CV information, and professional
contact section. Existing profile research-section drafts are migrated into
this workspace when it first opens.

Profile edits and previews are saved in a separate IndexedDB store in this
browser. They do not update `profile.html`, upload media, or publish changes.
The research-project pages remain in the Research projects workspace.

## Subject Index workspace

The **Subject index** tab edits the directory taxonomy used by the public
Natural Inquiry Index and the Publications editor. Rename disciplines or
topics, add new ones, and remove entries. **Save Index** writes the taxonomy to
`natural-inquiry-index-data.js` in this local project; the Vite-only local API
does not push changes to GitHub or deploy to AWS.

Removing a discipline or topic unfiles its Index relationships from saved
publication metadata. It does not delete the writing or other publication
content. Changes are written atomically to the local project files.
