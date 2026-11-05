import chinookSalmonPage from "../../research/chinook-salmon.html?raw";
import garibaldiPage from "../../research/garibaldi.html?raw";
import migratoryBirdsPage from "../../research/migratory-birds.html?raw";
import pacificTradeWindsPage from "../../research/pacific-trade-winds.html?raw";
import profilePage from "../../profile.html?raw";

const existingProjects = [
  ["chinook-salmon", "research/chinook-salmon.html", chinookSalmonPage],
  ["garibaldi", "research/garibaldi.html", garibaldiPage],
  ["migratory-birds", "research/migratory-birds.html", migratoryBirdsPage],
  ["pacific-trade-winds", "research/pacific-trade-winds.html", pacificTradeWindsPage]
];

function textContent(element) {
  if (!element) return "";
  const copy = element.cloneNode(true);
  copy.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith(" "));
  return copy.textContent.replace(/\s+/g, " ").trim();
}

function projectFromPage([id, path, source]) {
  const document = new DOMParser().parseFromString(source, "text/html");
  const header = document.querySelector(".research-project-header");
  const overview = document.querySelector(".research-project-panel");
  const heading = header?.querySelector("h1");

  if (!header || !overview || !heading) {
    throw new Error(`The existing research page at ${path} does not match the expected project structure.`);
  }

  return {
    id: `existing-${id}`,
    kind: "project",
    sourcePath: path,
    isExisting: true,
    status: textContent(header.querySelector(".eyebrow")).split("·")[0].trim(),
    title: textContent(heading),
    subtitle: textContent(header.querySelector(".article-deck")),
    overviewTitle: textContent(overview.querySelector("h2")),
    overview: Array.from(overview.querySelectorAll("p:not(.eyebrow)"), textContent).join("\n\n"),
    note: textContent(document.querySelector(".research-project-note")),
    updatedAt: null
  };
}

export function getResearchSeeds() {
  return existingProjects.map(projectFromPage);
}
