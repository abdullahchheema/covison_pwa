// Runs before first paint (external file so the CSP needs no 'unsafe-inline').
// Applies the saved theme override so there is no light/dark flash.
(function () {
  try {
    var t = localStorage.getItem("covison.theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    /* storage unavailable: follow the system theme */
  }
})();
