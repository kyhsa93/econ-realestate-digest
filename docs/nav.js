// 가로로 넘치는 내비게이션을 다룬다. 예순두 장이 같은 파일을 쓴다.
//
// 1층(page-nav)과 2층(sub-nav)은 좁은 화면에서 가로로 잘린다. 잘렸다는 신호가
// 없으면 사용자는 보이는 데까지가 전부인 줄 안다 - 2층 오른쪽 끝에 있는
// '거래내역 검색'과 '전세 vs 월세'가 그래서 아무도 안 누르는 자리에 있었다.
//
// 이 파일이 없어도 페이지는 그대로 돈다. 페이드가 안 보이고 현재 항목이
// 스크롤 밖에 남을 뿐이다.
(function () {
  const navs = document.querySelectorAll(".page-nav, .sub-nav");
  if (!navs.length) return;

  // 양 끝 페이드는 넘칠 때만, 그리고 그 방향에 남은 것이 있을 때만 켠다.
  // 늘 켜 두면 끝까지 밀었는데도 더 있다고 거짓말을 한다.
  function markEdges(nav) {
    const max = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle("scroll-start", max > 1 && nav.scrollLeft > 1);
    nav.classList.toggle("scroll-end", max > 1 && nav.scrollLeft < max - 1);
  }

  // scrollIntoView는 세로로도 움직여 페이지를 끌어내린다. 가로만 직접 옮긴다.
  function revealCurrent(nav) {
    const current = nav.querySelector('[aria-current="page"], .active');
    if (!current || nav.scrollWidth <= nav.clientWidth) return;
    const centered = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, centered);
  }

  for (const nav of navs) {
    revealCurrent(nav);
    markEdges(nav);
    nav.addEventListener("scroll", () => markEdges(nav), { passive: true });
  }

  window.addEventListener("resize", () => {
    for (const nav of navs) markEdges(nav);
  });
})();

// 건너뛰기 링크는 스크립트 없이도 있어야 하므로 HTML에 한국어로 박아 두었다.
// 화면 언어가 영어면 여기서 바꾼다 - 이 파일이 페이지 스크립트보다 뒤에 돌아
// documentElement.lang은 이미 정해져 있다.
(function () {
  const link = document.querySelector(".skip-link[data-skip-en]");
  if (link && document.documentElement.getAttribute("lang") === "en") {
    link.textContent = link.getAttribute("data-skip-en");
  }
})();
