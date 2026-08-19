import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");

function fakeServiceWorker({ controller = null } = {}) {
  const listeners = {};
  const registration = { updates: 0, update: async () => (registration.updates += 1) };
  return {
    controller,
    registration,
    registered: [],
    register(url) {
      this.registered.push(url);
      return Promise.resolve(registration);
    },
    addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn)),
    dispatch: (type) => {
      for (const fn of listeners[type] ?? []) fn({});
    },
  };
}

async function launch(options = {}) {
  const serviceWorker = fakeServiceWorker(options);
  const page = await loadIndexPage({ serviceWorker });
  page.fire("window", "load");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { page, serviceWorker };
}

test("앱을 켜면 새 일꾼이 있는지 묻는다", async () => {
  const { serviceWorker } = await launch();

  assert.deepEqual(serviceWorker.registered, ["./sw.js"], "서비스워커를 등록하지 않는다");
  assert.equal(serviceWorker.registration.updates, 1, "새 코드가 있는지 확인하지 않는다");
});

test("접었다 다시 펼 때마다 새 코드가 왔는지 다시 묻는다", async () => {
  const { page, serviceWorker } = await launch();

  page.app.document.visibilityState = "visible";
  page.fire("document", "visibilitychange");
  assert.equal(serviceWorker.registration.updates, 2, "다시 볼 때 확인하지 않는다");

  page.app.document.visibilityState = "hidden";
  page.fire("document", "visibilitychange");
  assert.equal(serviceWorker.registration.updates, 2, "감춘 화면까지 확인한다");
});

test("새 일꾼이 자리를 넘겨받으면 화면을 다시 읽는다", async () => {
  const { page, serviceWorker } = await launch({ controller: {} });

  serviceWorker.dispatch("controllerchange");
  assert.equal(page.reloads(), 1, "옛 코드를 그대로 띄워 둔다");

  serviceWorker.dispatch("controllerchange");
  assert.equal(page.reloads(), 1, "다시 읽기를 되풀이한다");
});

test("처음 설치할 때는 다시 읽지 않는다", async () => {
  const { page, serviceWorker } = await launch({ controller: null });

  serviceWorker.dispatch("controllerchange");
  assert.equal(page.reloads(), 0, "첫 방문인데 화면을 새로 고친다");
});

test("페이지 코드에는 캐시 우선 규칙을 두지 않는다", async () => {
  const sw = await readFile(path.join(root, "docs/sw.js"), "utf8");

  assert.match(sw, /function isPageCode/, "페이지 코드를 따로 가르지 않는다");
  assert.match(sw, /url\.pathname\.endsWith\("\.js"\)/, "스크립트가 캐시 우선으로 남는다");
  assert.match(sw, /cache: "reload"/, "브라우저 캐시를 건너뛰지 않는다");
});
