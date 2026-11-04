const categoryGrid = document.querySelector("#index-category-grid");
const subjectPanel = document.querySelector("#index-subject-panel");
const searchResults = document.querySelector("#index-search-results");
const searchInput = document.querySelector("#index-search");
const searchStatus = document.querySelector("#index-search-status");

const requestedCategoryId = new URLSearchParams(window.location.search).get("category");
let activeCategoryId = naturalInquiryIndexCategories.some((category) => category.id === requestedCategoryId)
  ? requestedCategoryId
  : null;
let activeSubject = null;

function updateCategoryUrl(categoryId) {
  const url = new URL(window.location.href);
  if (categoryId) {
    url.searchParams.set("category", categoryId);
  } else {
    url.searchParams.delete("category");
  }
  window.history.replaceState(null, "", url);
}

function getMatchingEntries(query) {
  const normalizedQuery = query.trim().toLowerCase();
  return naturalInquiryIndexCategories.flatMap((category) => {
    const categoryMatches = category.title.toLowerCase().includes(normalizedQuery);
    return category.subjects
      .filter((subject) => categoryMatches || subject.toLowerCase().includes(normalizedQuery))
      .map((subject) => ({ category, subject }));
  });
}

function renderCategories(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  categoryGrid.replaceChildren();

  const categories = naturalInquiryIndexCategories.filter((category) => {
    if (!normalizedQuery || category.title.toLowerCase().includes(normalizedQuery)) {
      return true;
    }
    return category.subjects.some((subject) => subject.toLowerCase().includes(normalizedQuery));
  });

  for (const category of categories) {
    const button = document.createElement("button");
    button.className = "index-category-card";
    button.type = "button";
    button.dataset.categoryId = category.id;
    button.setAttribute("aria-pressed", String(category.id === activeCategoryId));
    button.setAttribute("aria-controls", "index-subject-panel");

    const title = document.createElement("span");
    title.className = "index-category-title";
    title.textContent = category.title;

    const count = document.createElement("span");
    count.className = "index-category-count";
    count.textContent = `${category.subjects.length} ${category.subjects.length === 1 ? "subject" : "subjects"}`;

    button.append(title, count);
    button.addEventListener("click", () => {
      activeCategoryId = category.id;
      activeSubject = null;
      updateCategoryUrl(category.id);
      render();
      const selectedButton = Array.from(categoryGrid.querySelectorAll(".index-category-card"))
        .find((entry) => entry.dataset.categoryId === category.id);
      if (selectedButton) selectedButton.focus();
      subjectPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    categoryGrid.append(button);
  }
}

function renderSubjectPanel() {
  subjectPanel.replaceChildren();
  const category = naturalInquiryIndexCategories.find((entry) => entry.id === activeCategoryId);
  if (!category) {
    subjectPanel.hidden = true;
    return;
  }

  subjectPanel.hidden = false;

  const headingRow = document.createElement("div");
  headingRow.className = "index-panel-heading";

  const heading = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Discipline";
  const title = document.createElement("h2");
  title.textContent = category.title;
  heading.append(eyebrow, title);

  const backButton = document.createElement("button");
  backButton.className = "index-back-button";
  backButton.type = "button";
  backButton.textContent = "← Return to all categories";
  backButton.addEventListener("click", () => {
    const previousCategoryId = activeCategoryId;
    activeCategoryId = null;
    activeSubject = null;
    updateCategoryUrl(null);
    searchInput.value = "";
    render();
    const previousCategoryButton = Array.from(categoryGrid.querySelectorAll(".index-category-card"))
      .find((entry) => entry.dataset.categoryId === previousCategoryId);
    if (previousCategoryButton) previousCategoryButton.focus();
    categoryGrid.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  headingRow.append(heading, backButton);

  const subjectList = document.createElement("div");
  subjectList.className = "index-subject-list";
  subjectList.setAttribute("role", "group");
  subjectList.setAttribute("aria-label", `Subjects in ${category.title}`);

  for (const subject of category.subjects) {
    const button = document.createElement("button");
    button.className = "index-subject-button";
    button.type = "button";
    button.dataset.subject = subject;
    button.setAttribute("aria-pressed", String(subject === activeSubject));
    button.textContent = subject;
    button.addEventListener("click", () => {
      activeSubject = subject;
      renderSubjectPanel();
      const selectedButton = Array.from(subjectPanel.querySelectorAll(".index-subject-button"))
        .find((entry) => entry.dataset.subject === subject);
      if (selectedButton) selectedButton.focus();
    });
    subjectList.append(button);
  }

  subjectPanel.append(headingRow, subjectList);

  if (category.relatedWriting?.length) {
    const writingSection = document.createElement("section");
    writingSection.className = "index-related-writing";
    writingSection.setAttribute("aria-labelledby", "index-related-writing-title");

    const writingHeading = document.createElement("h3");
    writingHeading.id = "index-related-writing-title";
    writingHeading.textContent = "Related writing";
    writingSection.append(writingHeading);

    const writingList = document.createElement("div");
    writingList.className = "index-related-writing-list";

    for (const writing of category.relatedWriting) {
      const link = document.createElement("a");
      link.className = "index-related-writing-item";
      link.href = writing.url;

      const title = document.createElement("span");
      title.className = "index-related-writing-title";
      title.textContent = writing.title;

      const description = document.createElement("span");
      description.className = "index-related-writing-description";
      description.textContent = writing.description;

      const type = document.createElement("span");
      type.className = "index-related-writing-type";
      type.textContent = writing.type;

      link.append(title, description, type);
      writingList.append(link);
    }

    writingSection.append(writingList);
    subjectPanel.append(writingSection);
  }

  if (activeSubject) {
    const detail = document.createElement("section");
    detail.className = "index-subject-detail";
    detail.setAttribute("aria-live", "polite");

    const detailLabel = document.createElement("p");
    detailLabel.className = "index-detail-label";
    detailLabel.textContent = "Subject";

    const detailTitle = document.createElement("h3");
    detailTitle.textContent = activeSubject;

    const detailCopy = document.createElement("p");
    detailCopy.textContent = "This subject is part of the index. Introductions, related concepts, projects, writing, images, and references can be added as the directory grows.";
    detail.append(detailLabel, detailTitle, detailCopy);
    subjectPanel.append(detail);
  }
}

function renderSearchResults(query) {
  searchResults.replaceChildren();
  if (!query.trim()) {
    searchResults.hidden = true;
    searchStatus.textContent = "";
    return;
  }

  const matches = getMatchingEntries(query);
  searchResults.hidden = false;
  searchStatus.textContent = `${matches.length} ${matches.length === 1 ? "subject" : "subjects"} found`;

  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "index-empty";
    empty.textContent = "No subjects found. Try another search.";
    searchResults.append(empty);
    return;
  }

  for (const { category, subject } of matches) {
    const button = document.createElement("button");
    button.className = "index-search-result";
    button.type = "button";

    const subjectName = document.createElement("span");
    subjectName.textContent = subject;
    const categoryName = document.createElement("span");
    categoryName.textContent = category.title;
    button.append(subjectName, categoryName);
    button.addEventListener("click", () => {
      activeCategoryId = category.id;
      activeSubject = subject;
      updateCategoryUrl(category.id);
      searchInput.value = "";
      render();
      const selectedButton = Array.from(subjectPanel.querySelectorAll(".index-subject-button"))
        .find((entry) => entry.dataset.subject === subject);
      if (selectedButton) selectedButton.focus();
      subjectPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    searchResults.append(button);
  }
}

function render() {
  renderCategories(searchInput.value);
  renderSubjectPanel();
  renderSearchResults(searchInput.value);
}

searchInput.addEventListener("input", () => {
  activeCategoryId = null;
  activeSubject = null;
  updateCategoryUrl(null);
  render();
});

document.querySelector("#current-year").textContent = new Date().getFullYear();
render();
