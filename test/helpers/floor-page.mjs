import { loadPage } from "./digest-page.mjs";

export async function loadFloorPage({ floor, ...rest } = {}) {
  const page = await loadPage({
    file: "floor-gap.html",
    // fetch 스텁은 파일 이름에서 키를 뽑는다 - floor-gap.json이라 키도 그대로다.
    data: { "floor-gap": floor },
    ...rest,
  });

  return {
    ...page,
    leadText: () => page.text("lead"),
    topLeadText: () => page.text("top-lead"),
    districtLeadText: () => page.text("district-lead"),
    districtTable: () => page.html("district-table"),
    districtNote: () => page.text("district-note"),
    toggleLang: () => page.click("lang-toggle"),
  };
}
