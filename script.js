// Add published pieces here. Each entry's type should be Essay, Research, or Notes.
const writings = [
  {
    title: "The Choice to Sail Away",
    type: "Essay",
    description: "A personal essay presented in its own reading page.",
    url: "writing/the-choice-to-sail-away.html"
  },
  {
    title: "Birds as Neighbors: Learning to Notice the Living World",
    type: "Essay",
    year: 2026,
    description: "A sample essay about everyday encounters with birds and the practice of paying attention.",
    url: "writing/birds-as-neighbors.html",
    status: "Sample placeholder"
  }
];

const writingList = document.querySelector("#writing-list");
const emptyState = document.querySelector("#empty-state");
const archiveCount = document.querySelector("#archive-count");
const searchInput = document.querySelector("#search-input");
const filterButtons = document.querySelectorAll(".filter-button");
let activeFilter = "all";

function renderWritings() {
  const query = searchInput.value.trim().toLowerCase();
  const visibleWritings = writings
    .filter((writing) => activeFilter === "all" || writing.type === activeFilter)
    .filter((writing) => {
      const searchableText = `${writing.title} ${writing.description} ${writing.type} ${writing.year ?? ""}`.toLowerCase();
      return searchableText.includes(query);
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  writingList.replaceChildren();
  archiveCount.textContent = `${visibleWritings.length} ${visibleWritings.length === 1 ? "piece" : "pieces"}`;
  emptyState.hidden = visibleWritings.length > 0;
  emptyState.textContent = writings.length === 0
    ? "The archive is just getting started. New writing will appear here."
    : "No writing matches your search. Try another term or filter.";

  for (const writing of visibleWritings) {
    const item = document.createElement("a");
    item.className = "writing-item";
    item.href = writing.url;
    item.setAttribute(
      "aria-label",
      [writing.title, writing.type, writing.year].filter(Boolean).join(", ")
    );

    const type = document.createElement("span");
    type.className = "writing-type";
    type.textContent = writing.type;

    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "writing-title";
    title.textContent = writing.title;
    content.append(title);

    if (writing.description) {
      const description = document.createElement("p");
      description.className = "writing-description";
      description.textContent = writing.description;
      content.append(description);
    }

    if (writing.status) {
      const status = document.createElement("span");
      status.className = "writing-status";
      status.textContent = writing.status;
      content.append(status);
    }

    const year = document.createElement("span");
    year.className = "writing-year";
    year.textContent = writing.year ?? "";

    item.append(type, content, year);
    writingList.append(item);
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((filterButton) => {
      const isActive = filterButton === button;
      filterButton.classList.toggle("is-active", isActive);
      filterButton.setAttribute("aria-pressed", String(isActive));
    });
    renderWritings();
  });
});

searchInput.addEventListener("input", renderWritings);

const homeNavigation = document.querySelector(".home-header nav");
if (homeNavigation) {
  const updateFloatingNavigation = () => {
    if (window.scrollY > 100) {
      homeNavigation.classList.add("is-floating");
    } else if (window.scrollY <= 1) {
      homeNavigation.classList.remove("is-floating");
    }
  };

  window.addEventListener("scroll", updateFloatingNavigation, { passive: true });
  updateFloatingNavigation();
}

document.querySelector("#current-year").textContent = new Date().getFullYear();
renderWritings();
