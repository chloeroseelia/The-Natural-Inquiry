const carouselTrack = document.querySelector("[data-carousel-track]");

if (carouselTrack) {
  const slides = Array.from(carouselTrack.querySelectorAll(".research-carousel-slide"));
  const dots = Array.from(document.querySelectorAll("[data-carousel-dot]"));
  const previousButton = document.querySelector("[data-carousel-previous]");
  const nextButton = document.querySelector("[data-carousel-next]");
  const status = document.querySelector("[data-carousel-status]");
  let activeIndex = 0;

  function updateCarousel(index) {
    activeIndex = Math.max(0, Math.min(index, slides.length - 1));
    previousButton.disabled = activeIndex === 0;
    nextButton.disabled = activeIndex === slides.length - 1;
    status.textContent = `Project ${activeIndex + 1} of ${slides.length}`;

    slides.forEach((slide, slideIndex) => {
      slide.setAttribute("aria-label", `${slideIndex + 1} of ${slides.length}`);
    });

    dots.forEach((dot, dotIndex) => {
      dot.setAttribute("aria-pressed", String(dotIndex === activeIndex));
    });
  }

  function goToSlide(index) {
    const targetIndex = Math.max(0, Math.min(index, slides.length - 1));
    carouselTrack.scrollTo({
      left: slides[targetIndex].offsetLeft
    });
    updateCarousel(targetIndex);
  }

  previousButton.addEventListener("click", () => goToSlide(activeIndex - 1));
  nextButton.addEventListener("click", () => goToSlide(activeIndex + 1));

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      goToSlide(Number(dot.dataset.carouselDot));
    });
  });

  carouselTrack.addEventListener("scroll", () => {
    const nearestIndex = slides.reduce((nearest, slide, index) => {
      const distance = Math.abs(slide.offsetLeft - carouselTrack.scrollLeft);
      const nearestDistance = Math.abs(slides[nearest].offsetLeft - carouselTrack.scrollLeft);
      return distance < nearestDistance ? index : nearest;
    }, 0);

    if (nearestIndex !== activeIndex) {
      updateCarousel(nearestIndex);
    }
  }, { passive: true });

  updateCarousel(0);
}
