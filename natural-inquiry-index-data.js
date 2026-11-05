const naturalInquiryIndexCategories = [
  {
    id: "marine-aquatic",
    title: "Marine & Aquatic Sciences",
    subjects: [
      "Ichthyology",
      "Oceanography",
      "Limnology",
      "Fish Health",
      "Marine Biology"
    ],
    relatedWriting: [
      {
        title: "The Choice to Sail Away",
        type: "Essay",
        description: "A personal essay about life at sea, grief, and learning to face what lies ahead.",
        url: "writing/the-choice-to-sail-away.html"
      }
    ],
    subjectWriting: {
      Oceanography: [
        {
          title: "The Choice to Sail Away",
          type: "Essay",
          description: "A personal essay about life at sea, grief, and learning to face what lies ahead.",
          url: "writing/the-choice-to-sail-away.html"
        }
      ]
    }
  },
  {
    id: "mycology-parasitology",
    title: "Mycology & Parasitology",
    subjects: [
      "Fungal Biology",
      "Parasite Biology",
      "Host-Parasite Relationships"
    ]
  },
  {
    id: "botany",
    title: "Botany & Plant Biology",
    subjects: [
      "Plant Physiology",
      "Plant Diversity",
      "Plant Adaptation"
    ],
    relatedWriting: [
      {
        title: "Seaweed Made Simple: Quick, Affordable Meals for Busy Students",
        type: "Essay",
        description: "A student-focused exploration of seaweed as a sustainable food source, paired with quick, affordable recipes.",
        url: "writing/seaweed-made-simple.html"
      }
    ],
    subjectWriting: {
      "Plant Diversity": [
        {
          title: "Seaweed Made Simple: Quick, Affordable Meals for Busy Students",
          type: "Essay",
          description: "A student-focused exploration of seaweed as a sustainable food source, paired with quick, affordable recipes.",
          url: "writing/seaweed-made-simple.html"
        }
      ]
    }
  },
  {
    id: "entomology",
    title: "Entomology",
    subjects: [
      "Insect Anatomy",
      "Insect Diversity",
      "Insect Classification"
    ]
  },
  {
    id: "meteorology-climatology",
    title: "Meteorology & Climatology",
    subjects: [
      "Atmospheric Circulation",
      "Pacific Trade Winds",
      "Climate Patterns",
      "Weather Systems"
    ]
  },
  {
    id: "biotechnology-biomedical",
    title: "Biotechnology & Biomedical Science",
    subjects: [
      "Histology",
      "Cellular Biology",
      "Biomedical Applications"
    ]
  },
  {
    id: "bioinformatics",
    title: "Bioinformatics & Computational Biology",
    subjects: [
      "Biological Data Analysis",
      "Statistical Analysis",
      "Computational Methods"
    ]
  },
  {
    id: "scientific-imaging",
    title: "Scientific Imaging & Emerging Technologies",
    subjects: [
      "Digital Microscopy",
      "Image Analysis",
      "Scientific Instrumentation"
    ]
  }
];

const naturalInquiryWritings = [
  {
    title: "The Choice to Sail Away",
    type: "Essay",
    description: "A personal essay presented in its own reading page.",
    url: "writing/the-choice-to-sail-away.html"
  },
  {
    title: "Seaweed Made Simple: Quick, Affordable Meals for Busy Students",
    type: "Essay",
    description: "A student-focused exploration of seaweed as a sustainable food source, paired with quick, affordable recipes.",
    url: "writing/seaweed-made-simple.html"
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

window.NaturalInquiryIndexTaxonomy = naturalInquiryIndexCategories.map(({ id, title, subjects }) => ({
  id,
  title,
  subjects: [...subjects]
}));

for (const publishedEntry of window.NaturalInquiryPublishedEntries || []) {
  if (!naturalInquiryWritings.some((writing) => writing.url === publishedEntry.url)) {
    naturalInquiryWritings.push({
      title: publishedEntry.title,
      type: publishedEntry.type,
      description: publishedEntry.description,
      url: publishedEntry.url,
      year: publishedEntry.year
    });
  }

  for (const filing of publishedEntry.filings || []) {
    const category = naturalInquiryIndexCategories.find((entry) => entry.id === filing.categoryId);
    if (!category) continue;

    const relatedWriting = category.relatedWriting || (category.relatedWriting = []);
    if (!relatedWriting.some((writing) => writing.url === publishedEntry.url)) {
      relatedWriting.push({
        title: publishedEntry.title,
        type: publishedEntry.type,
        description: publishedEntry.description,
        url: publishedEntry.url
      });
    }

    category.subjectWriting ||= {};
    for (const subject of filing.subjects || []) {
      const subjectWriting = category.subjectWriting[subject] || (category.subjectWriting[subject] = []);
      if (!subjectWriting.some((writing) => writing.url === publishedEntry.url)) {
        subjectWriting.push({
          title: publishedEntry.title,
          type: publishedEntry.type,
          description: publishedEntry.description,
          url: publishedEntry.url
        });
      }
    }
  }
}
