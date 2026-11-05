import profilePage from "../../profile.html?raw";

function textContent(element) {
  if (!element) return "";
  const copy = element.cloneNode(true);
  copy.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith(" "));
  return copy.textContent.replace(/\s+/g, " ").trim();
}

function textBlocks(element) {
  return Array.from(element.children, (child) => {
    const text = textContent(child);
    if (!text) return "";
    if (child.matches("h1, h2, h3, h4")) return `## ${text}`;
    if (child.matches("ul, ol")) {
      return Array.from(child.children, (item) => `• ${textContent(item)}`).join("\n");
    }
    if (child.matches("dl")) {
      return Array.from(child.querySelectorAll("dt, dd"), textContent).join("\n");
    }
    return text;
  }).filter(Boolean).join("\n\n");
}

function profileSection(section, id, title) {
  const summary = section.querySelector(".profile-section-content > p");
  const details = section.querySelector(".profile-details-content");
  if (!summary || !details) {
    throw new Error(`The profile section "${title}" could not be loaded.`);
  }

  return {
    id: `profile-${id}`,
    kind: "profile",
    sourcePath: "profile.html",
    isExisting: true,
    title,
    summary: textContent(summary),
    content: textBlocks(details),
    updatedAt: null
  };
}

export function getProfileSeeds() {
  const document = new DOMParser().parseFromString(profilePage, "text/html");
  const header = document.querySelector(".profile-heading");
  const heading = header?.querySelector("h1");
  const deck = header?.querySelector(".article-deck");
  if (!heading || !deck) {
    throw new Error("The academic profile introduction could not be loaded.");
  }

  const sections = [
    ["biography-title", "Biography"],
    ["education-title", "Education"],
    ["interests-title", "Research interests"],
    ["experience-title", "Research experience"],
    ["skills-title", "Methods, software & skills"],
    ["cv-title", "Academic CV"],
    ["contact-title", "Professional contact"]
  ].map(([id, title]) => {
    const section = document.querySelector(`[aria-labelledby="${id}"]`);
    if (!section) throw new Error(`The profile section "${title}" could not be loaded.`);
    return profileSection(section, id, title);
  });

  return [
    {
      id: "profile-introduction",
      kind: "profile-introduction",
      sourcePath: "profile.html",
      isExisting: true,
      title: "Profile introduction",
      summary: textContent(heading).replace(/\s+/g, " "),
      content: textContent(deck),
      updatedAt: null
    },
    ...sections
  ];
}
