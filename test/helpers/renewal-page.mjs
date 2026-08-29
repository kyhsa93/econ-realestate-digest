import { loadPage } from "./digest-page.mjs";

const SUB_NAV = ["all", "sale", "jeonse", "wolse", "search", "conversion", "renewal", "cancelled"];

export async function loadRenewalPage({ renewal, ...rest } = {}) {
  const page = await loadPage({
    file: "renewal-vs-new.html",
    // fetch 스텁은 파일 이름에서 키를 뽑는다 - renewal-facts.json이라 키도 그대로다.
    data: { "renewal-facts": renewal },
    subNav: SUB_NAV,
    ...rest,
  });

  return {
    ...page,
    leadText: () => page.text("lead"),
    leadHtml: () => page.html("lead"),
    capLeadText: () => page.text("cap-lead"),
    districtTable: () => page.html("district-table"),
    districtLinks: () => page.html("district-links"),
    districtNote: () => page.text("district-note"),
    toggleLang: () => page.click("lang-toggle"),
  };
}
