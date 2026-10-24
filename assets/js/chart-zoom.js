import mediumZoom from "medium-zoom";

const images = document.querySelectorAll("img.chart-figure");
if (images.length > 0) {
  mediumZoom(images, {
    margin: 24,
    background: "var(--theme)",
  });
}
