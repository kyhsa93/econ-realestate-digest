// 기사 페이지에서 본문을 뽑아낸다.
//
// 요약 품질은 모델이 아니라 모델이 보는 재료에서 갈린다. 제목만 주면 어떤 모델도
// 제목을 바꿔 쓰는 것 이상을 못 한다. 그런데 매체마다 RSS에 싣는 양이 천차만별이라
// (조선비즈는 본문 전체, 연합은 37자) RSS만으로는 재료가 채워지지 않는다.
//
// 그래서 RSS가 본문을 안 주는 매체만 기사 페이지를 받아 본문을 뽑는다. 대상은
// robots.txt가 일반 크롤러에게 해당 경로를 열어둔 곳으로 한정한다. 매일경제는
// AI 크롤러(ClaudeBot·anthropic-ai)를 명시적으로 막아두었으므로 넣지 않는다
// (RSS로 이미 100자쯤 주기도 한다).
const SOURCES = [
  {
    host: "www.yna.co.kr",
    // robots.txt: `Allow: /`, 외국어판(/view/AEN* 등)만 금지. 한국어 기사는 AKR.
    allowPath: (pathname) => /^\/view\/AKR/.test(pathname),
    extract: extractYna,
  },
  {
    host: "www.hankyung.com",
    // robots.txt: /article/download/ 만 금지. 기사 본문 경로는 열려 있다.
    allowPath: (pathname) => pathname.startsWith("/article/") && !pathname.startsWith("/article/download/"),
    extract: extractHankyung,
  },
];

// 본문 문단 사이에 섞여 들어오는 것들. 구독 버튼·저작권 표기·자동생성 안내가
// 그대로 요약 재료가 되면 모델이 그걸 그날의 소식으로 쓴다.
const BOILERPLATE = /(인공지능이 자동으로|AI 추천|구독중|구독하기|기자 구독|저작권자|무단 전재|재배포 금지|이 기사는|제보는|카카오톡|▶|ⓒ)/;

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", middot: "·", hellip: "…", ldquo: "“", rdquo: "”",
  lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–", times: "×", copy: "©",
};

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function stripTags(html) {
  // script/style은 태그만 지우면 알맹이(자바스크립트 코드)가 본문으로 남는다.
  const withoutCode = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  return decodeEntities(withoutCode.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html, patterns) {
  for (const pattern of patterns) {
    const matched = html.match(pattern);
    if (matched) return matched[1];
  }
  return null;
}

function extractHankyung(html) {
  const container = firstMatch(html, [
    /<div[^>]+class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<(?:\/div>\s*<\/div|footer)/i,
    /<div[^>]+id="articletxt"[^>]*>([\s\S]*?)<\/div>/i,
  ]);
  return container ? stripTags(container) : null;
}

function extractYna(html) {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (!article) return null;

  // 연합은 본문 블록 안에 기자 프로필·구독 위젯이 같이 들어 있다. 문단 단위로
  // 뽑아서 짧은 조각을 버리면 그것들이 자연스럽게 걸러진다.
  const paragraphs = [...article[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((text) => text.length > 15 && !BOILERPLATE.test(text));

  return paragraphs.length > 0 ? paragraphs.join(" ") : null;
}

function extractMetaDescription(html) {
  const content = firstMatch(html, [
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i,
  ]);
  return content ? decodeEntities(content).replace(/\s+/g, " ").trim() : null;
}

function sourceFor(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const source = SOURCES.find((candidate) => candidate.host === parsed.hostname);
  return source && source.allowPath(parsed.pathname) ? source : null;
}

// robots.txt가 열어둔 경로인지까지 본다. 호스트만 보고 받으면 같은 매체의
// 금지 경로(검색·다운로드 등)를 건드리게 된다.
export function isScrapable(url) {
  return sourceFor(url) !== null;
}

export function extractArticleBody(url, html) {
  const source = sourceFor(url);
  if (!source) return null;

  // 본문 컨테이너 안에도 스크립트가 들어 있어서, 먼저 걷어내지 않으면 컨테이너를
  // 찾는 정규식이 첫 <script>에서 멈춰 빈 본문을 뽑는다.
  const markup = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // 매체별 규칙이 실패해도 meta description은 대개 리드 문단이라 제목보다는 낫다.
  const body = source.extract(markup) || extractMetaDescription(markup);
  if (!body) return null;

  const cleaned = body.replace(/\s+/g, " ").trim();
  return cleaned.length >= 40 ? cleaned : null;
}
