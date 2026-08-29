/**
 * 한국은행 경제통계시스템(ECOS) Open API.
 *
 * 기준금리를 bok.or.kr 포털 HTML에서 정규식으로 긁고 있었다. 표 구조가 바뀌면
 * 아무 소리 없이 멈추는 경로다 - 값을 못 읽으면 어제 값을 그대로 다시 쓰므로
 * 화면은 멀쩡해 보이고, 며칠 지나서야 이상하다는 걸 알게 된다.
 *
 * 인증키는 ecos.bok.or.kr/api에서 가입하면 즉시 무료로 나온다. 없으면 공개된
 * sample 키로 도는데, sample은 한 번에 열 건까지만 준다 - 오늘 값을 읽기에는
 * 넉넉하고 시계열에는 모자란다. 그래서 키가 있으면 창을 넓게 잡는다.
 */

export const ECOS_BASE = "https://ecos.bok.or.kr/api";

/** 누구나 쓸 수 있는 공개 키. 열 건 제한이 붙는다. */
export const SAMPLE_KEY = "sample";
export const SAMPLE_MAX_ROWS = 10;
export const KEYED_MAX_ROWS = 1000;

/** 1.3.1. 한국은행 기준금리 및 여수신금리 → 한국은행 기준금리, 일별. */
export const BASE_RATE = { stat: "722Y001", item: "0101000", cycle: "D" };

/**
 * 8.2.1. 주식시장 → KOSPI지수, 일별.
 *
 * 네이버 비공식 폴링에서 옮겨 왔다. 그쪽은 장중 스냅숏을 주므로 언제 부르느냐에 따라
 * 뜻이 달라진다 - 개장 전에 부르면 전일 종가에 등락 0.00이 붙어 오고, 장중에 부르면
 * 그 순간 값이 온다. 하루 한 번 받아 "그날 값"으로 저장하면 두 뜻이 한 계열에 섞인다.
 * ECOS는 마감된 종가를 거래일에 맞춰 주므로 그 문제가 없다. 대신 하루 늦다.
 */
export const KOSPI = { stat: "802Y001", item: "0001000", cycle: "D" };

export function ecosKey(env = process.env) {
  const key = String(env?.ECOS_API_KEY ?? "").trim();
  return key || SAMPLE_KEY;
}

export const maxRows = (key) => (key === SAMPLE_KEY ? SAMPLE_MAX_ROWS : KEYED_MAX_ROWS);

/** sample 키로 열 건을 넘겨 부르면 조회 자체가 오류가 된다. 부르기 전에 자른다. */
export const clampRows = (key, want) => Math.min(want, maxRows(key));

export function searchUrl({ key, stat, cycle, from, to, item, rows }) {
  return [ECOS_BASE, "StatisticSearch", key, "json", "kr", 1, rows, stat, cycle, from, to, item].join("/");
}

/**
 * 통계 조회. 오름차순(오래된 것부터)으로 돌려준다.
 *
 * ECOS는 조회 결과가 없을 때도 200으로 응답하고 RESULT에 코드를 담는다.
 * "없음"과 "잘못 물어봄"을 가르지 않으면, 코드를 잘못 적어 놓고도 그냥
 * 데이터가 없는 날이라고 넘어가게 된다.
 */
export async function statisticSearch(options, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(searchUrl(options));
  if (!res.ok) throw new Error(`ecos http ${res.status}`);

  const json = await res.json();
  const code = json?.RESULT?.CODE;
  if (code) {
    if (code === "INFO-200") return [];
    throw new Error(`ecos ${code}: ${json.RESULT?.MESSAGE ?? ""}`.trim());
  }

  const rows = json?.StatisticSearch?.row;
  if (!Array.isArray(rows)) throw new Error("ecos 응답 형식 이상");
  return rows;
}

/**
 * 값이 마지막으로 바뀐 날.
 *
 * 받아 온 창 안에서 뒤에서부터 같은 값이 이어지는 첫 날이다. 창 전체가 같은
 * 값이면 바뀐 것은 그 전이라 여기서는 알 수 없다 - 그때는 null이다.
 */
export function changedOn(rows) {
  if (!rows?.length) return null;
  const latest = rows.at(-1).DATA_VALUE;
  let at = rows.length - 1;
  while (at > 0 && rows[at - 1].DATA_VALUE === latest) at -= 1;
  return at === 0 ? null : rows[at].TIME;
}
