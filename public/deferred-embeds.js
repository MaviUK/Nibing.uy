(function () {
  function runNear(element, callback, rootMargin) {
    if (!element) return;

    if (!("IntersectionObserver" in window)) {
      callback();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        callback();
      },
      { rootMargin: rootMargin || "500px 0px" }
    );

    observer.observe(element);
  }

  runNear(document.getElementById("customer-reviews"), () => {
    window.dispatchEvent(new Event("nbg:load-reviews"));
  });

  runNear(document.getElementById("customer-portal"), () => {
    if (document.getElementById("squeegee-widget-script")) return;
    const script = document.createElement("script");
    script.id = "squeegee-widget-script";
    script.src = "https://widgets.sqg.ee/main.js";
    script.async = true;
    document.head.appendChild(script);
  }, "350px 0px");
})();
