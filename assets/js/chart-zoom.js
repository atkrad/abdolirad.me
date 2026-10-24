import mediumZoom from "medium-zoom";

const images = document.querySelectorAll(".chart-figure img");
if (images.length > 0) {
  mediumZoom(images, {
    margin: 24,
    background: "var(--theme)",
  });
}
