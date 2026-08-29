import { loadPage } from "./digest-page.mjs";

const SUB_NAV = ["all", "sale", "jeonse", "wolse", "search", "conversion", "renewal", "cancelled"];

export async function loadCancellationPage({ cancellation, ...rest } = {}) {
  const page = await loadPage({ file: "cancelled-deals.html", data: { cancellation }, subNav: SUB_NAV, ...rest });

  return {
    ...page,
    leadText: () => page.text("lead"),
    leadHtml: () => page.html("lead"),
    monthLeadText: () => page.text("month-lead"),
    districtTable: () => page.html("district-table"),
    monthTable: () => page.html("month-table"),
    districtLinks: () => page.html("district-links"),
    toggleLang: () => page.click("lang-toggle"),
  };
}
