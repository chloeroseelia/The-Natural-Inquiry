const interestTopics = [
  {
    id: "marine",
    category: "life",
    title: "Marine and Aquatic Sciences",
    description: "Ichthyology, marine biology, oceanography, limnology, aquatic biodiversity, and fish health."
  },
  {
    id: "mycology",
    category: "life",
    title: "Mycology and Parasitology",
    description: "Fungal diversity, parasite biology, host-parasite interactions, microbial relationships, and the roles of fungi and parasites in natural systems."
  },
  {
    id: "botany",
    category: "life",
    title: "Botany and Plant Biology",
    description: "Plant diversity, physiology, adaptation, ecology, and the relationships between plants and their environments."
  },
  {
    id: "entomology",
    category: "life",
    title: "Entomology",
    description: "Insect diversity, anatomy, behavior, classification, and ecological relationships."
  },
  {
    id: "atmosphere",
    category: "environment",
    title: "Meteorology and Climatology",
    description: "Weather systems, atmospheric processes, climate patterns, and the influence of environmental conditions on living organisms."
  },
  {
    id: "biotech",
    category: "technology",
    title: "Biotechnology and Biomedical Science",
    description: "Cellular and molecular biology, biological processes, disease mechanisms, and the development of technologies for biological and biomedical applications."
  },
  {
    id: "bioinformatics",
    category: "technology",
    title: "Bioinformatics and Computational Biology",
    description: "Biological data analysis, computational methods, statistical applications, and the use of programming to investigate biological systems."
  },
  {
    id: "imaging",
    category: "technology",
    title: "Scientific Imaging and Emerging Technologies",
    description: "Digital microscopy, histology, image processing, scientific instrumentation, and innovative tools for biological research."
  }
];

const topicButtons = [...document.querySelectorAll(".interest-node")];
const filterButtons = [...document.querySelectorAll(".interest-map-filter")];
const detailTitle = document.querySelector("#interest-detail-title");
const detailCategory = document.querySelector("#interest-detail-category");
const detailDescription = document.querySelector("#interest-detail-description");
const mapCount = document.querySelector("#interest-map-count");
let activeCategory = "all";

function showTopic(topic) {
  detailTitle.textContent = topic.title;
  detailCategory.textContent = {
    life: "Life sciences",
    environment: "Earth systems",
    technology: "Research tools and technology"
  }[topic.category];
  detailDescription.textContent = topic.description;

  topicButtons.forEach((button) => {
    const isSelected = button.dataset.topic === topic.id;
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function applyCategory(category) {
  activeCategory = category;
  filterButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.category === category));
  });

  let visibleCount = 0;
  let selectedVisibleTopic = null;
  topicButtons.forEach((button) => {
    const topic = interestTopics.find((item) => item.id === button.dataset.topic);
    const isVisible = category === "all" || topic.category === category;
    button.hidden = !isVisible;
    if (isVisible) {
      visibleCount += 1;
      if (button.getAttribute("aria-pressed") === "true") {
        selectedVisibleTopic = topic;
      }
    }
  });

  mapCount.textContent = `${visibleCount} ${visibleCount === 1 ? "area" : "areas"}`;
  if (!selectedVisibleTopic) {
    const firstVisibleButton = topicButtons.find((button) => !button.hidden);
    selectedVisibleTopic = interestTopics.find((topic) => topic.id === firstVisibleButton.dataset.topic);
    showTopic(selectedVisibleTopic);
  }
}

topicButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const topic = interestTopics.find((item) => item.id === button.dataset.topic);
    showTopic(topic);
  });
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => applyCategory(button.dataset.category));
});

applyCategory(activeCategory);
