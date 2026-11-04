const articleSubjects = document.querySelector("#article-subjects");

if (articleSubjects) {
  const writingUrl = articleSubjects.dataset.writingUrl;
  const relatedEntries = naturalInquiryIndexCategories.flatMap((category) => {
    const categoryMatches = category.relatedWriting?.some((writing) => writing.url === writingUrl);
    const subjectMatches = Object.entries(category.subjectWriting || {})
      .filter(([, writings]) => writings.some((writing) => writing.url === writingUrl))
      .map(([subject]) => subject);
    return categoryMatches || subjectMatches.length > 0
      ? [{ category, subjects: subjectMatches }]
      : [];
  });

  if (relatedEntries.length > 0) {
    const label = document.createElement("span");
    label.className = "article-subjects-label";
    label.textContent = "Filed in the Index";
    articleSubjects.append(label);

    for (const { category, subjects } of relatedEntries) {
      if (category.relatedWriting?.some((writing) => writing.url === writingUrl)) {
        const categoryLink = document.createElement("a");
        categoryLink.className = "article-subject-link";
        categoryLink.href = `../natural-inquiry-index.html?category=${encodeURIComponent(category.id)}`;
        categoryLink.textContent = category.title;
        articleSubjects.append(categoryLink);
      }

      for (const subject of subjects) {
        const subjectLink = document.createElement("a");
        subjectLink.className = "article-subject-link";
        subjectLink.href = `../natural-inquiry-index.html?category=${encodeURIComponent(category.id)}&subject=${encodeURIComponent(subject)}`;
        subjectLink.textContent = subject;
        articleSubjects.append(subjectLink);
      }
    }
  }
}
