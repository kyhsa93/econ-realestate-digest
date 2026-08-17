const SOURCES = [
  {
    host: "www.yna.co.kr",
    allowPath: (pathname) => /^\/view\/AKR/.test(pathname),
    extract: extractYna,
  },
  {
    host: "www.hankyung.com",
    allowPath: (pathname) => pathname.startsWith("/article/") && !pathname.startsWith("/article/download/"),
    extract: extractHankyung,
  },
];

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

export function isScrapable(url) {
  return sourceFor(url) !== null;
}

export function extractArticleBody(url, html) {
  const source = sourceFor(url);
  if (!source) return null;

  const markup = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const body = source.extract(markup) || extractMetaDescription(markup);
  if (!body) return null;

  const cleaned = body.replace(/\s+/g, " ").trim();
  return cleaned.length >= 40 ? cleaned : null;
}
