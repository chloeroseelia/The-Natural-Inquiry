# The Natural Inquiry

A lightweight, static website for publishing academic and scientific writing under the name The Natural Inquiry. It uses plain HTML, CSS, and JavaScript, so it can be hosted on GitHub Pages without a build step.

## Personalize the site

- In `index.html`, update the introduction and About section with your background and interests.
- The homepage banner uses `images/home-banner.jpg`, optimized from the supplied shell fossil image. Replace that file to change the banner artwork.
- In `script.js`, add your writing to the `writings` array. Each entry uses this shape:

  ```js
  {
    title: "Title of the piece",
    type: "Research", // Essay, Research, or Notes
    year: 2026, // Optional when the year is not provided
    description: "A short description of the piece.",
    url: "writing/my-piece.html"
  }
  ```

- Put each piece at its corresponding URL, or link directly to a PDF or another publication.
- Update the page title and description in the `<head>` of `index.html`.

## Create an individual writing page

1. Copy `writing/template.html` to a new file in the `writing` folder, using a short filename such as `field-notes.html`.
2. Replace the bracketed prompts with the title, summary, publication details, article text, and references. Update the page title and description in the `<head>` as well.
3. Add an entry to the `writings` array in `script.js`. Set its `url` to the page path, such as `writing/field-notes.html`.
4. To connect it to the Natural Inquiry Index, add the publication to the relevant category's `relatedWriting` array in `natural-inquiry-index-data.js`. Set the copied page's `data-writing-url` to the same site-relative URL. The page will display a category link above the essay, and the category will list the piece under Related writing.
5. Open `index.html` and the new page in a browser to review them before publishing.

The template is not listed in the archive. Copy and complete it before linking a finished piece.

## Add a writing-page banner image

The banner is optional. In a copied writing page, uncomment the `<figure class="article-hero">` example in `writing/template.html`, put your image in the `images` folder, and update the image path, descriptive alt text, and optional caption or credit. The image appears above the article text. The birds sample uses a local illustrative SVG as an example; replace it with your own image when ready.

The birds essay currently linked in the archive is an explicitly labeled hypothetical sample, not a published work or completed research.

## Academic profile

The homepage links to a dedicated academic profile at `profile.html`. Each profile section keeps a short overview beside its heading and has a native expandable area for additional details. Update its bracketed prompts with information you want to share. No degrees, roles, skills, or contact details have been assumed; the birds essay is identified as a hypothetical sample. Add project links as individual project pages become available. The CV section links to the supplied PDF.

The profile is part of this static site and currently has no CMS or private editing interface. Its content is maintained in `profile.html`; a CMS can be considered separately if you want to edit and publish without changing project files.

The profile portrait is `images/chloe-elia.jpg`, optimized from the supplied photo. Update the image path, alt text, and caption in `profile.html` if you replace it. The Academic CV download links to `Chloe Elia - CV.pdf` in the project root.

## Interactive research interest map

The Research Interests section on the academic profile links to `interests.html`. Visitors can select topics and filter the map by broad area. Edit the topic labels and descriptions in `interests.js`; keep the map's labels consistent with the interest descriptions on the profile. The visual links are conceptual and do not imply formal project relationships.

## The Natural Inquiry Index

The homepage links to a standalone scientific directory at `natural-inquiry-index.html`. Edit categories, subjects, and their `relatedWriting` lists in `natural-inquiry-index-data.js`; the page interface and interactions are in `natural-inquiry-index.js`, with presentation in `styles.css`. Visitors can search subjects, choose a discipline, and select individual subject entries. Category links can open directly to a selected category with a `?category=category-id` query string. The directory currently contains only the subjects provided; add descriptions, references, and project or writing links as those materials become available.

## Preview locally

Open `index.html` in a browser. No dependencies or build tools are needed.

## Publish with GitHub Pages

1. Create a GitHub repository and add these files to its root.
2. Push the files to the repository's default branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, select the default branch and the `/ (root)` folder, then save.

GitHub Pages will publish the site at the URL shown in the Pages settings.
