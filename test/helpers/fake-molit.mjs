import { createServer } from "node:http";

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function itemXml(item) {
  const body = Object.entries(item)
    .map(([key, value]) => `<${key}>${escape(value)}</${key}>`)
    .join("");
  return `<item>${body}</item>`;
}

export function successXml(items, totalCount = items.length) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><response>` +
    `<header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>` +
    `<body><items>${items.map(itemXml).join("")}</items>` +
    `<numOfRows>9999</numOfRows><pageNo>1</pageNo><totalCount>${totalCount}</totalCount></body></response>`
  );
}

export function errorXml(message = "SERVICE ERROR") {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><response>` +
    `<header><resultCode>99</resultCode><resultMsg>${escape(message)}</resultMsg></header>` +
    `<body></body></response>`
  );
}

export async function startFakeMolit(respond) {
  const calls = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const kind = url.pathname.includes("rent") ? "rent" : "sale";
    const code = url.searchParams.get("LAWD_CD");
    const yearMonth = url.searchParams.get("DEAL_YMD");
    calls.push({ kind, code, yearMonth });

    const body = respond(kind, { code, yearMonth, calls });
    res.writeHead(body === undefined ? 500 : 200, { "content-type": "application/xml" });
    res.end(body === undefined ? "" : (body ?? successXml([])));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    calls,
    saleUrl: `http://127.0.0.1:${port}/sale`,
    rentUrl: `http://127.0.0.1:${port}/rent`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const saleItem = (extra = {}) => ({
  aptNm: "테스트단지",
  buildYear: 2005,
  dealAmount: "52,000",
  dealDay: 14,
  dealMonth: 8,
  dealYear: 2026,
  dealingGbn: "중개거래",
  excluUseAr: 84.97,
  floor: 5,
  umdNm: "테스트동",
  ...extra,
});

export const rentItem = (extra = {}) => ({
  aptNm: "테스트단지",
  buildYear: 2005,
  deposit: "40,000",
  dealDay: 14,
  dealMonth: 8,
  dealYear: 2026,
  excluUseAr: 84.97,
  floor: 5,
  monthlyRent: 0,
  umdNm: "테스트동",
  ...extra,
});
