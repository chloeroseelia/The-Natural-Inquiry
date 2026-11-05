import choiceToSailAwayPage from "../../writing/the-choice-to-sail-away.html?raw";
import seaweedMadeSimplePage from "../../writing/seaweed-made-simple.html?raw";

const existingWriting = [
  {
    id: "existing-publication-the-choice-to-sail-away",
    html: choiceToSailAwayPage,
    categoryId: "marine-aquatic",
    subject: "Oceanography",
    sourcePage: "writing/the-choice-to-sail-away.html",
    sourceDocumentName: "The choice to sail away.pdf"
  },
  {
    id: "existing-publication-seaweed-made-simple",
    html: seaweedMadeSimplePage,
    categoryId: "botany",
    subject: "Plant Diversity",
    sourcePage: "writing/seaweed-made-simple.html",
    sourceDocumentName: "Seaweed Made Simple_ Quick, Affordable Meals for Busy Students (5).pdf"
  }
];

export function getExistingPublications() {
  const parser = new DOMParser();
  return existingWriting.map((source) => {
    const page = parser.parseFromString(source.html, "text/html");
    const content = page.querySelector(".article-content");
    content?.querySelectorAll(".document-actions, iframe, .document-caption").forEach((element) => element.remove());
    const title = page.querySelector(".article-header h1")?.textContent?.trim() || "";
    const subtitle = page.querySelector(".article-deck")?.textContent?.trim().replace(/\s+/g, " ") || "";

    return {
      id: source.id,
      title,
      subtitle,
      category: "Essay",
      status: "Published",
      archived: false,
      publishedAt: "",
      indexCategories: [{ id: source.categoryId, subjects: [source.subject] }],
      references: [],
      bodyHtml: content?.innerHTML.trim() || "",
      sourcePage: source.sourcePage,
      sourceDocumentName: source.sourceDocumentName,
      createdAt: null,
      updatedAt: null
    };
  });
}
