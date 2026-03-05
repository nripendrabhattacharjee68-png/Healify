const tabs = Array.from(document.querySelectorAll("#step-tabs button"));
const panels = Array.from(document.querySelectorAll(".step-panel"));

function showStep(step) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.step === step);
  });

  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === step);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    showStep(tab.dataset.step);
  });
});
