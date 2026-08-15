// 서비스워커는 화면에 안 보이고 브라우저 안에서만 도는 코드라, 잘못돼도 알아채기가
// 제일 어렵다. 실제 파일을 가짜 브라우저 위에서 돌려 응답 규칙을 확인한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const ORIGIN = "https://kyhsa93.github.io";

class FakeResponse {
  constructor(body, { status = 200, statusText = "" } = {}) {
    this.body = body;
    this.status = status;
    this.statusText = statusText;
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status, statusText: this.statusText });
  }
}

class FakeRequest {
  constructor(url, { method = "GET", mode = "no-cors", headers = {} } = {}) {
    this.url = String(url);
    this.method = method;
    this.mode = mode;
    this.headers = { get: (k) => headers[k.toLowerCase()] ?? null };
  }
}

async function loadServiceWorker({ network } = {}) {
  const source = await readFile(path.join(root, "docs/sw.js"), "utf8");
  const store = new Map();
  const handlers = {};

  const cache = {
    addAll: async () => {},
    put: async (request, response) => store.set(String(request.url ?? request), response),
    match: async (request) => store.get(String(request.url ?? request)) ?? undefined,
  };

  const sandbox = {
    URL,
    Request: FakeRequest,
    Response: FakeResponse,
    Promise,
    console,
    location: { origin: ORIGIN },
    caches: {
      open: async () => cache,
      match: async (request) => cache.match(request),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async (request) =>
      network ? network(request) : new FakeResponse("live", { status: 200 }),
    self: {
      addEventListener: (type, fn) => (handlers[type] = fn),
      skipWaiting() {},
      clients: { claim() {} },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "docs/sw.js" }).runInContext(sandbox);

  // fetch 핸들러를 실제 이벤트처럼 불러 응답을 받아낸다.
  const respond = async (url, init) => {
    const request = new FakeRequest(url, init);
    let responded;
    handlers.fetch({ request, respondWith: (p) => (responded = p) });
    return responded === undefined ? undefined : await responded;
  };

  return { respond, store, cache };
}

test("데이터는 쿼리를 뗀 주소로 캐시해서 다음에 찾을 수 있게 한다", async () => {
  const sw = await loadServiceWorker();

  await sw.respond(`${ORIGIN}/econ-realestate-digest/data/news.json?_=1755200000000`);
  await new Promise((r) => setTimeout(r, 0));

  // 캐시 키에 타임스탬프가 남아 있으면 다음 요청은 주소가 달라 영영 못 찾는다.
  assert.deepEqual([...sw.store.keys()], [`${ORIGIN}/econ-realestate-digest/data/news.json`]);
});

test("네트워크가 끊겨도 캐시해둔 데이터로 답한다", async () => {
  let online = true;
  const sw = await loadServiceWorker({
    network: async () => {
      if (!online) throw new Error("offline");
      return new FakeResponse("fresh", { status: 200 });
    },
  });

  await sw.respond(`${ORIGIN}/econ-realestate-digest/data/news.json?_=1`);
  await new Promise((r) => setTimeout(r, 0));

  online = false;
  const cached = await sw.respond(`${ORIGIN}/econ-realestate-digest/data/news.json?_=2`);
  assert.equal(cached.body, "fresh", "다른 타임스탬프로 요청하면 캐시를 못 찾는다");
});

// 예전엔 캐시가 없으면 undefined를 돌려줘서 페이지가 알 수 없는 오류로 죽었다.
test("오프라인인데 캐시도 없으면 실패를 분명히 알린다", async () => {
  const sw = await loadServiceWorker({
    network: async () => {
      throw new Error("offline");
    },
  });

  const res = await sw.respond(`${ORIGIN}/econ-realestate-digest/data/news.json?_=1`);
  assert.ok(res, "응답을 아예 안 준다");
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
});

// 페이지를 캐시 우선으로 주면 배포한 지 한참 지나도 예전 화면이 남는다.
test("페이지는 네트워크를 먼저 보고, 안 되면 캐시로 떨어진다", async () => {
  let online = true;
  const sw = await loadServiceWorker({
    network: async () => {
      if (!online) throw new Error("offline");
      return new FakeResponse("new-page", { status: 200 });
    },
  });

  const fresh = await sw.respond(`${ORIGIN}/econ-realestate-digest/index.html`, { mode: "navigate" });
  assert.equal(fresh.body, "new-page");
  await new Promise((r) => setTimeout(r, 0));

  online = false;
  const offline = await sw.respond(`${ORIGIN}/econ-realestate-digest/index.html`, { mode: "navigate" });
  assert.equal(offline.body, "new-page", "오프라인에서 캐시로 못 떨어진다");
});

test("다른 도메인 요청에는 끼어들지 않는다", async () => {
  const sw = await loadServiceWorker();
  const res = await sw.respond("https://www.googletagmanager.com/gtag/js?id=G-X");
  assert.equal(res, undefined, "바깥 요청까지 가로챈다");
});

test("새 페이지들이 설치 시 미리 받는 목록에 들어 있다", async () => {
  const source = await readFile(path.join(root, "docs/sw.js"), "utf8");
  for (const asset of ["./index.html", "./rates.html", "./news.html", "./analytics.js"]) {
    assert.ok(source.includes(`"${asset}"`), `${asset}이 셸 목록에 없다`);
  }
  // 캐시 키를 안 올리면 옛 규칙으로 저장된 항목이 그대로 남는다.
  assert.ok(/CACHE_NAME = "econ-digest-v8"/.test(source), "캐시 버전을 올리지 않았다");
});
