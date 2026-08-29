import { loadPage, settle } from "./digest-page.mjs";

const SUB_NAV = ["all", "sale", "jeonse", "wolse", "search", "conversion", "renewal", "floor", "cancelled"];

export async function loadConversionPage({ conversion, ...rest } = {}) {
  const page = await loadPage({ file: "jeonse-vs-wolse.html", data: { conversion }, subNav: SUB_NAV, ...rest });

  const dispatch = (id, type, mutate) => {
    const el = page.byId(id);
    mutate(el);
    page.byId("calc-controls").dispatch(type, { target: el });
    return settle();
  };

  return {
    ...page,
    resultHtml: () => page.html("calc-result"),
    tableHtml: () => page.html("rate-table"),
    leadText: () => page.text("lead"),
    districtOptions: () => page.html("district-select"),
    bandOptions: () => page.html("band-select"),
    chooseDistrict: (value) => dispatch("district-select", "change", (el) => (el.value = value)),
    chooseBand: (value) => dispatch("band-select", "change", (el) => (el.value = value)),
    typeCash: (value) => dispatch("cash-input", "input", (el) => (el.value = String(value))),
    toggleLang: () => page.click("lang-toggle"),
  };
}
