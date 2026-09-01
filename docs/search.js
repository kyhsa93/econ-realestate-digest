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

  // 안내문에 예시가 붙어 있는데("...로 찾기 (예: 강남구, 래미안, 10억)"), 폰에서는
  // 그 괄호가 입력칸 밖으로 나가 "(예: 강남구, 래미"에서 잘린다. 잘린 안내문은
  // 없는 것만 못하므로 좁은 화면에서는 예시를 떼고 할 일만 남긴다.
  const FULL_HINT = input.placeholder || "";
  const SHORT_HINT = FULL_HINT.replace(/\s*[(（].*$/, "");
  if (SHORT_HINT && SHORT_HINT !== FULL_HINT && typeof window.matchMedia === "function") {
    const narrow = window.matchMedia("(max-width: 560px)");
    const fitHint = () => {
      input.placeholder = narrow.matches ? SHORT_HINT : FULL_HINT;
    };
    fitHint();
    narrow.addEventListener("change", fitHint);
  }

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

  // --- 정해진 이름이 아닌 말 읽기 -------------------------------------------
  //
  // 색인에 담긴 이름만 맞추면 "8억"이나 "84㎡"나 "강남구 84㎡" 같은 말이 전부
  // 0건이 된다. 사람은 그렇게 친다. 그래서 이름으로 못 맞춘 글자를 숫자로 한 번
  // 더 읽어 본다 - 예산·면적은 우리가 이미 조건으로 가진 것들이다.

  /** 면적 구간. deal-search.html의 AREA_BUCKETS와 같은 선이다. */
  const AREA_KEYS = [
    { max: 60, key: "60" },
    { max: 85, key: "60-85" },
    { max: 135, key: "85-135" },
    { max: Infinity, key: "135" },
  ];

  const PYEONG_M2 = 3.3058;

  /** "8억" "3억5천" "12억 3000" -> 억 단위 숫자. 없으면 null. */
  function parseEok(text) {
    const t = squash(text);
    const eok = /(\d+(?:\.\d+)?)억/.exec(t);
    if (!eok) return null;
    let value = Number(eok[1]);
    const rest = t.slice(eok.index + eok[0].length);
    const cheon = /^(\d+)천/.exec(rest);
    if (cheon) value += Number(cheon[1]) / 10;
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /**
   * "84㎡" "84제곱" "84m2" "34평" -> { m2, label }. 없으면 null.
   * 라벨은 친 그대로 둔다 - 34평을 쳤는데 112㎡라고 답하면 자기가 친 것이 맞게
   * 읽혔는지 알 수 없다.
   */
  function parseArea(text) {
    const t = squash(text);
    const pyeong = /(\d+(?:\.\d+)?)평/.exec(t);
    if (pyeong) return { m2: Number(pyeong[1]) * PYEONG_M2, label: `${pyeong[1]}평` };
    const m2 = /(\d+(?:\.\d+)?)\s*(?:㎡|m2|m²|제곱미?터?)/.exec(t);
    return m2 ? { m2: Number(m2[1]), label: `${m2[1]}㎡` } : null;
  }

  const areaKeyOf = (m2) => AREA_KEYS.find((bucket) => m2 <= bucket.max)?.key ?? null;

  /** 자치구·동 이름이 글자 안에 들어 있는지. 긴 이름부터 봐서 "중구"가 "중랑구"를 먹지 않게. */
  function findPlace(query) {
    const q = squash(query);
    let hit = null;
    for (const [district, dongs] of Object.entries(index?.dongs ?? {})) {
      for (const dong of dongs) {
        if (q.includes(squash(dong)) && (!hit || dong.length > (hit.dong?.length ?? 0))) {
          hit = { district, dong };
        }
      }
    }
    if (hit) return hit;
    for (const entry of index?.entries ?? []) {
      if (entry.kind !== "district") continue;
      if (q.includes(squash(entry.text)) && (!hit || entry.text.length > (hit.district?.length ?? 0))) {
        hit = { district: entry.text, dong: null };
      }
    }
    return hit;
  }

  /**
   * 친 글자를 조건으로 읽는다. 하나라도 읽히면 "조건으로 찾기"를 맨 위에 준다.
   * 이름으로 딱 맞는 것이 있으면 그게 먼저다 - "강남구"를 친 사람은 조건 검색이
   * 아니라 강남구 페이지를 찾는다.
   */
  function interpret(query) {
    const place = findPlace(query);
    const eok = parseEok(query);
    const area = parseArea(query);
    const areaKey = area ? areaKeyOf(area.m2) : null;
    if (!place && !eok && !areaKey) return null;

    const params = new URLSearchParams();
    if (place?.district) params.set("district", place.district);
    if (place?.dong) params.set("dong", place.dong);
    if (eok) params.set("budget", String(Math.floor(eok)));
    if (areaKey) params.set("area", areaKey);

    const parts = [];
    if (place?.dong) parts.push(`${place.district} ${place.dong}`);
    else if (place?.district) parts.push(place.district);
    if (eok) parts.push(`${eok % 1 ? eok.toFixed(1) : eok}억대`);
    if (areaKey) parts.push(area.label);

    return {
      rank: -1,
      text: parts.filter(Boolean).join(" · "),
      sub: "조건으로 찾기",
      href: `./deal-search.html?${params.toString()}`,
    };
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

    for (const [district, names] of Object.entries(index.dongs ?? {})) {
      for (const name of names) {
        const best = score(name, q);
        if (best === null) continue;
        hits.push({
          rank: best * 10 + 3,
          text: name,
          sub: district,
          href: `./deal-search.html?district=${encodeURIComponent(district)}&dong=${encodeURIComponent(name)}`,
        });
      }
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

    const sorted = hits.sort((a, b) => a.rank - b.rank || a.text.length - b.text.length);

    // 이름으로 딱 맞는 것이 없을 때만 조건으로 읽어 준다. "강남구"를 친 사람은
    // 조건 검색이 아니라 강남구 페이지를 찾는다.
    const exact = sorted.length > 0 && sorted[0].rank < 10;
    const guess = exact ? null : interpret(query);
    return (guess ? [guess, ...sorted] : sorted).slice(0, MAX);
  }

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /**
   * 못 찾았을 때.
   *
   * 전에는 드롭다운이 그냥 사라졌다. 사용자는 검색이 고장 났는지, 자기가 잘못
   * 쳤는지, 그런 게 없는 건지 알 수 없었다 - 셋 중 무엇이든 막다른 길이다.
   *
   * 무엇을 찾을 수 있는지 적고, <strong>없는 것은 없다고 말한다.</strong>
   * 학군·교통·재건축은 이 사이트가 다루지 않는다. 붙잡아 두는 것보다 그렇게
   * 말하는 편이 낫다 - method.html의 "하지 않는 것"과 같은 태도다.
   */
  function renderMiss(query) {
    list.innerHTML =
      `<div class="site-search-miss">` +
      `<p class="miss-head">${escapeHtml(query)}</p>` +
      `<p class="miss-can">자치구·동·단지 이름, 예산(8억), 면적(84㎡·34평)으로 찾을 수 있습니다. 두 가지를 같이 쳐도 됩니다 &mdash; 강남구 84㎡</p>` +
      `<p class="miss-cannot">학군·교통·재건축 정보는 이 사이트가 다루지 않습니다.</p>` +
      `</div>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");

    // 못 찾은 말을 모아 두면 동의어를 추측이 아니라 실제로 들어온 글자로 채울 수 있다.
    window.analytics?.debouncedEvent?.("search_miss", { search_term: query.slice(0, 60) });
  }

  function render() {
    if (!items.length) {
      const query = input.value.trim();
      if (query) {
        renderMiss(query);
        return;
      }
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
