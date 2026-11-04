const articleSubjects = document.querySelector("#article-subjects");

if (articleSubjects) {
  const writingUrl = articleSubjects.dataset.writingUrl;
  const relatedCategories = naturalInquiryIndexCategories.filter((category) =>
    category.relatedWriting?.some((writing) => writing.url === writingUrl)
  );

  if (relatedCategories.length > 0) {
    const label = document.createElement("span");
    label.className = "article-subjects-label";
    label.textContent = "Filed in the Index";
    articleSubjects.append(label);

    for (const category of relatedCategories) {
      const link = document.createElement("a");
      link.className = "article-subject-link";
      link.href = `../natural-inquiry-index.html?category=${encodeURIComponent(category.id)}`;
      link.textContent = category.title;
      articleSubjects.append(link);
    }
  }
}
