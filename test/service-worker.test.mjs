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
  const calls = [];

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
    fetch: async (request, init) => {
      calls.push({ url: String(request.url ?? request), init });
      return network ? network(request) : new FakeResponse("live", { status: 200 });
    },
    self: {
      addEventListener: (type, fn) => (handlers[type] = fn),
      skipWaiting() {},
      clients: { claim() {} },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "docs/sw.js" }).runInContext(sandbox);

  const respond = async (url, init) => {
    const request = new FakeRequest(url, init);
    let responded;
    handlers.fetch({ request, respondWith: (p) => (responded = p) });
    return responded === undefined ? undefined : await responded;
  };

  return { respond, store, cache, calls };
}

test("데이터는 쿼리를 뗀 주소로 캐시해서 다음에 찾을 수 있게 한다", async () => {
  const sw = await loadServiceWorker();

  await sw.respond(`${ORIGIN}/econ-realestate-digest/data/news.json?_=1755200000000`);
  await new Promise((r) => setTimeout(r, 0));

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
  for (const asset of ["./index.html", "./rates.html", "./news.html", "./style.css", "./analytics.js"]) {
    assert.ok(source.includes(`"${asset}"`), `${asset}이 셸 목록에 없다`);
  }
  assert.ok(/CACHE_NAME = "econ-digest-v10"/.test(source), "캐시 버전을 올리지 않았다");
});

test("페이지 코드는 브라우저 캐시를 건너뛰고 받는다", async () => {
  const sw = await loadServiceWorker();

  await sw.respond(`${ORIGIN}/econ-realestate-digest/index.html`, { mode: "navigate" });
  await sw.respond(`${ORIGIN}/econ-realestate-digest/analytics.js`);
  // 62장이 같은 style.css를 본다. 캐시부터 주면 한 번 낡을 때 사이트 전체가 낡는다.
  await sw.respond(`${ORIGIN}/econ-realestate-digest/style.css`);
  await sw.respond(`${ORIGIN}/econ-realestate-digest/data/news.json?_=1`);

  assert.equal(sw.calls.length, 4, "가로채지 못한 요청이 있다");
  for (const call of sw.calls) {
    assert.equal(call.init?.cache, "reload", `${call.url}: 브라우저 캐시가 끼어들 수 있다`);
  }
});

test("스크립트도 네트워크를 먼저 본다", async () => {
  let body = "old";
  const sw = await loadServiceWorker({ network: async () => new FakeResponse(body, { status: 200 }) });
  const url = `${ORIGIN}/econ-realestate-digest/analytics.js`;

  await sw.respond(url);
  await new Promise((r) => setTimeout(r, 0));

  body = "new";
  const again = await sw.respond(url);
  assert.equal(again.body, "new", "받아둔 옛 스크립트를 그대로 준다");
});

test("스크립트가 안 받아지면 받아둔 것으로 버틴다", async () => {
  let online = true;
  const sw = await loadServiceWorker({
    network: async () => {
      if (!online) throw new Error("offline");
      return new FakeResponse("script", { status: 200 });
    },
  });
  const url = `${ORIGIN}/econ-realestate-digest/analytics.js`;

  await sw.respond(url);
  await new Promise((r) => setTimeout(r, 0));

  online = false;
  const cached = await sw.respond(url);
  assert.equal(cached.body, "script", "오프라인에서 스크립트가 통째로 빈다");
});
