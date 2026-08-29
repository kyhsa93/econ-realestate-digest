// 무엇을 넣어도 받는 검색창. 예순두 장이 같은 파일을 쓴다.
//
// 검색이 세 군데로 쪼개져 있었다 - 첫 화면의 지역 검색(표 거르기), 금리 화면의
// 상품 검색, 그리고 '실거래 검색'이라는 이름의 화면. 마지막 것에는 정작 검색창이
// 없고 셀렉트가 일곱 개였고, 단지명으로 찾으려면 자치구를 먼저 골라야 해서
// "래미안"을 서울 전체에서 찾을 수 없었다.
//
// 색인은 처음 쓸 때 받는다. 22KB(gzip)라 작지만, 검색을 안 쓰는 사람에게까지
// 매번 받게 할 이유는 없다.
(function () {
  const form = document.querySelector(".site-search");
  if (!form) return;

  const input = form.querySelector("input");
  const list = form.querySelector(".site-search-results");
  if (!input || !list) return;

  const MAX = 8;
  const squash = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, "");

  let index = null;
  let loading = null;
  let items = [];
  let active = -1;

  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch("./data/search-index.json")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (index = data))
        .catch(() => null);
    }
    return loading;
  }

  /**
   * 이름 그대로 > 앞에서부터 > 어디든. 같은 등급이면 자치구·화면이 단지보다 앞이다 -
   * "강남"을 친 사람은 대개 강남구 페이지를 찾지 강남 이름이 든 단지를 찾지 않는다.
   */
  function score(text, query) {
    const t = squash(text);
    if (!t.includes(query)) return null;
    if (t === query) return 0;
    if (t.startsWith(query)) return 1;
    return 2;
  }

  function search(query) {
    if (!index) return [];
    const q = squash(query);
    if (!q) return [];
    const hits = [];

    for (const entry of index.entries ?? []) {
      const fields = [entry.text, ...(entry.also ?? [])].filter(Boolean);
      const best = fields.map((f) => score(f, q)).filter((s) => s !== null).sort()[0];
      if (best === undefined) continue;
      hits.push({ rank: best * 10, text: entry.text, sub: null, href: entry.href });
    }

    for (const [district, names] of Object.entries(index.complexes ?? {})) {
      for (const name of names) {
        const best = score(name, q);
        if (best === null) continue;
        hits.push({
          rank: best * 10 + 5,
          text: name,
          sub: district,
          href: `./deal-search.html?district=${encodeURIComponent(district)}&apt=${encodeURIComponent(name)}`,
        });
      }
    }

    return hits.sort((a, b) => a.rank - b.rank || a.text.length - b.text.length).slice(0, MAX);
  }

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function render() {
    if (!items.length) {
      list.innerHTML = "";
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      return;
    }
    list.innerHTML = items
      .map(
        (item, i) =>
          `<a role="option" id="site-search-option-${i}" href="${escapeHtml(item.href)}"` +
          `${i === active ? ' aria-selected="true"' : ""}>` +
          `<span class="hit">${escapeHtml(item.text)}</span>` +
          (item.sub ? `<span class="where">${escapeHtml(item.sub)}</span>` : "") +
          `</a>`
      )
      .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `site-search-option-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  async function update() {
    await load();
    items = search(input.value);
    active = -1;
    render();
  }

  input.addEventListener("focus", load);
  input.addEventListener("input", update);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      items = [];
      render();
      return;
    }
    if (!items.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : items.length - 1) + items.length) % items.length;
      render();
    }
  });

  // 아무것도 안 고르고 엔터를 치면 맨 위로 간다. 폼이 그냥 새로고침되게 두면
  // 친 글자만 사라지고 아무 일도 일어나지 않는다.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const target = items[active >= 0 ? active : 0];
    if (target) location.href = target.href;
  });

  document.addEventListener("click", (event) => {
    if (!form.contains(event.target)) {
      items = [];
      render();
    }
  });
})();
