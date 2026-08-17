import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(import.meta.dirname, "../scripts/fetch-rates.mjs");

function startStub(handler) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const endpoint = url.pathname.split("/").pop().replace(".json", "");
    const body = handler({
      endpoint,
      topFinGrpNo: url.searchParams.get("topFinGrpNo"),
      pageNo: Number(url.searchParams.get("pageNo")),
      auth: url.searchParams.get("auth"),
      userAgent: req.headers["user-agent"],
    });
    res.writeHead(body.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body.json));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function savingResponse({ products, maxPageNo = 1 }) {
  return {
    result: {
      err_cd: "000",
      err_msg: "정상",
      max_page_no: String(maxPageNo),
      baseList: products.map((p) => ({
        dcls_month: "202608",
        fin_co_no: p.co,
        fin_prdt_cd: p.cd,
        kor_co_nm: p.company,
        fin_prdt_nm: p.name,
        join_way: "인터넷",
        join_deny: "1",
        join_member: "실명의 개인",
        max_limit: p.maxLimit ?? null,
        spcl_cnd: p.spclCnd ?? "해당사항 없음",
        mtrt_int: "만기 후 이율",
      })),
      optionList: products.flatMap((p) =>
        (p.options ?? []).map((o) => ({
          fin_co_no: p.co,
          fin_prdt_cd: p.cd,
          intr_rate_type_nm: o.rateTypeName ?? "단리",
          save_trm: String(o.term),
          intr_rate: o.rate,
          intr_rate2: o.maxRate,
        }))
      ),
    },
  };
}

function loanResponse({ products }) {
  return {
    result: {
      err_cd: "000",
      err_msg: "정상",
      max_page_no: "1",
      baseList: products.map((p) => ({
        dcls_month: "202608",
        fin_co_no: p.co,
        fin_prdt_cd: p.cd,
        kor_co_nm: p.company,
        fin_prdt_nm: p.name,
        join_way: "영업점",
        loan_lmt: "담보평가액 이내",
        erly_rpay_fee: "1.2%",
        dly_rate: "연 3%",
        loan_inci_expn: "인지세",
      })),
      optionList: products.flatMap((p) =>
        (p.options ?? []).map((o) => ({
          fin_co_no: p.co,
          fin_prdt_cd: p.cd,
          mrtg_type_nm: "아파트",
          rpay_type_nm: "분할상환방식",
          lend_rate_type_nm: o.rateType,
          lend_rate_min: o.min,
          lend_rate_max: o.max,
          lend_rate_avg: o.avg,
        }))
      ),
    },
  };
}

async function run(base, outDir, { key = "TESTKEY", force = false } = {}) {
  return execFileAsync("node", [scriptPath], {
    env: {
      ...process.env,
      FSS_API_BASE: base,
      RATES_OUT_DIR: outDir,
      FSS_FINLIFE_API_KEY: key,
      ...(force ? { RATES_FORCE: "1" } : {}),
    },
  });
}

async function readJson(dir, name) {
  return JSON.parse(await readFile(path.join(dir, name), "utf-8"));
}

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "rates-test-"));
}

test("예·적금과 대출을 수집해 상품 목록과 히스토리를 저장한다", async () => {
  const stub = await startStub(({ endpoint, topFinGrpNo }) => {
    if (endpoint === "depositProductsSearch" || endpoint === "savingProductsSearch") {
      const isBank = topFinGrpNo === "020000";
      return {
        json: savingResponse({
          products: [
            {
              co: topFinGrpNo,
              cd: "P1",
              company: isBank ? "우리은행" : "OK저축은행",
              name: isBank ? "WON플러스예금" : "OK정기예금",
              maxLimit: 100000000,
              options: [
                { term: 12, rate: isBank ? 2.5 : 3.2, maxRate: isBank ? 2.6 : 3.5 },
                { term: 24, rate: 2.4, maxRate: 2.45 },
              ],
            },
          ],
        }),
      };
    }
    return {
      json: loanResponse({
        products: [
          {
            co: topFinGrpNo,
            cd: "L1",
            company: "국민은행",
            name: "주택담보대출",
            options: [{ rateType: "변동금리", min: 3.8, max: 5.2, avg: 4.3 }],
          },
        ],
      }),
    };
  });
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    const rates = await readJson(outDir, "rates.json");

    assert.equal(rates.deposit.length, 2);
    assert.deepEqual(
      rates.deposit.map((p) => p.sector).sort(),
      ["bank", "savingsBank"]
    );
    assert.equal(rates.disclosureMonth, "202608");

    const savingsBank = rates.deposit.find((p) => p.sector === "savingsBank");
    assert.equal(savingsBank.company, "OK저축은행");
    assert.equal(savingsBank.maxLimit, 100000000);
    assert.deepEqual(
      savingsBank.options.map((o) => o.term).sort((a, b) => a - b),
      [12, 24]
    );

    assert.equal(rates.mortgage.length, 1);
    assert.equal(rates.mortgage[0].options[0].avg, 4.3);
    assert.equal(rates.mortgage[0].options[0].rateType, "변동금리");
    assert.equal(rates.mortgage[0].loanLmt, "담보평가액 이내");

    const history = await readJson(outDir, "rates-history.json");
    assert.equal(history.length, 1);
    assert.equal(history[0].deposit12.bank.rate, 2.6);
    assert.equal(history[0].deposit12.savingsBank.rate, 3.5);
    assert.equal(history[0].deposit12.savingsBank.company, "OK저축은행");
    assert.equal(history[0].mortgage.rate, 4.3);
  } finally {
    await stub.close();
  }
});

test("여러 페이지를 max_page_no만큼 이어서 가져온다", async () => {
  let pagesServed = 0;
  const stub = await startStub(({ endpoint, topFinGrpNo, pageNo }) => {
    if (endpoint !== "depositProductsSearch") {
      return { json: savingResponse({ products: [] }) };
    }
    pagesServed += 1;
    return {
      json: savingResponse({
        maxPageNo: 3,
        products: [
          {
            co: topFinGrpNo,
            cd: `P${pageNo}`,
            company: "테스트은행",
            name: `상품${pageNo}`,
            options: [{ term: 12, rate: 2.0, maxRate: 2.1 }],
          },
        ],
      }),
    };
  });
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    const rates = await readJson(outDir, "rates.json");
    assert.equal(pagesServed, 6);
    assert.equal(rates.deposit.length, 6);
  } finally {
    await stub.close();
  }
});

test("금리 옵션이 없는 상품은 목록에서 제외한다", async () => {
  const stub = await startStub(({ topFinGrpNo }) =>
    ({
      json: savingResponse({
        products: [
          { co: topFinGrpNo, cd: "EMPTY", company: "빈은행", name: "옵션없음", options: [] },
          {
            co: topFinGrpNo,
            cd: "OK",
            company: "정상은행",
            name: "정상상품",
            options: [{ term: 12, rate: 3.0, maxRate: 3.1 }],
          },
        ],
      }),
    })
  );
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    const rates = await readJson(outDir, "rates.json");
    assert.deepEqual(
      [...new Set(rates.deposit.map((p) => p.name))],
      ["정상상품"]
    );
  } finally {
    await stub.close();
  }
});

test("일부 상품군이 실패하면 직전 데이터를 유지하고 나머지는 갱신한다", async () => {
  const stub = await startStub(({ endpoint, topFinGrpNo }) => {
    if (endpoint === "savingProductsSearch") {
      return { json: { result: { err_cd: "010", err_msg: "미등록 인증키", total_count: "0" } } };
    }
    return {
      json: savingResponse({
        products: [
          {
            co: topFinGrpNo,
            cd: "P1",
            company: "새은행",
            name: "새상품",
            options: [{ term: 12, rate: 3.0, maxRate: 3.3 }],
          },
        ],
      }),
    };
  });
  const outDir = await tempDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "rates.json"),
    JSON.stringify({
      updatedAt: "2026-08-01T00:00:00.000Z",
      saving: [
        {
          id: "old",
          sector: "bank",
          company: "이전은행",
          name: "이전상품",
          options: [{ term: 12, rate: 1.0, maxRate: 1.1 }],
        },
      ],
    })
  );

  try {
    await run(stub.base, outDir);
    const rates = await readJson(outDir, "rates.json");
    assert.equal(rates.saving[0].name, "이전상품");
    assert.equal(rates.deposit[0].name, "새상품");
  } finally {
    await stub.close();
  }
});

test("상품이 0건으로 와도 직전 목록을 지우지 않는다", async () => {
  const stub = await startStub(({ endpoint }) =>
    endpoint === "savingProductsSearch"
      ? { json: savingResponse({ products: [] }) }
      : {
          json: savingResponse({
            products: [
              { co: "0010001", cd: "P1", company: "새은행", name: "새상품", options: [{ term: 12, rate: 3, maxRate: 3.3 }] },
            ],
          }),
        }
  );
  const outDir = await tempDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "rates.json"),
    JSON.stringify({
      updatedAt: "2026-08-01T00:00:00.000Z",
      saving: [
        {
          id: "old",
          sector: "bank",
          company: "이전은행",
          name: "이전상품",
          options: [{ term: 12, rate: 1.0, maxRate: 1.1 }],
        },
      ],
    })
  );

  try {
    const { stderr } = await run(stub.base, outDir);
    const rates = await readJson(outDir, "rates.json");
    assert.equal(rates.saving.length, 1, "0건 응답으로 목록을 지웠다");
    assert.equal(rates.saving[0].name, "이전상품");
    assert.equal(rates.deposit[0].name, "새상품", "다른 상품군까지 멈췄다");
    assert.match(stderr, /0건으로 왔다/);
  } finally {
    await stub.close();
  }
});

test("모든 상품군이 실패하면 0이 아닌 코드로 종료하고 기존 파일을 덮어쓰지 않는다", async () => {
  const stub = await startStub(() => ({
    status: 500,
    json: { message: "server error" },
  }));
  const outDir = await tempDir();
  await mkdir(outDir, { recursive: true });
  const original = JSON.stringify({ updatedAt: "2026-08-01T00:00:00.000Z", deposit: [] });
  await writeFile(path.join(outDir, "rates.json"), original);

  try {
    await assert.rejects(() => run(stub.base, outDir));
    assert.equal(await readFile(path.join(outDir, "rates.json"), "utf-8"), original);
  } finally {
    await stub.close();
  }
});

test("인증키가 없으면 즉시 실패한다", async () => {
  const stub = await startStub(() => ({ json: savingResponse({ products: [] }) }));
  const outDir = await tempDir();
  try {
    await assert.rejects(() => run(stub.base, outDir, { key: "" }));
  } finally {
    await stub.close();
  }
});

test("같은 기간에 단리·복리가 함께 공시되면 금리가 높은 쪽만 남긴다", async () => {
  const stub = await startStub(({ endpoint, topFinGrpNo }) => {
    if (endpoint !== "depositProductsSearch") return { json: savingResponse({ products: [] }) };
    return {
      json: savingResponse({
        products: [
          {
            co: topFinGrpNo,
            cd: "P1",
            company: "테스트은행",
            name: "이자율선택예금",
            options: [
              { term: 12, rate: 3.0, maxRate: 3.1, rateTypeName: "단리" },
              { term: 12, rate: 3.2, maxRate: 3.4, rateTypeName: "복리" },
              { term: 24, rate: 3.0, maxRate: 3.0, rateTypeName: "단리" },
            ],
          },
        ],
      }),
    };
  });
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    const rates = await readJson(outDir, "rates.json");
    const product = rates.deposit[0];
    assert.deepEqual(product.options.map((o) => o.term), [12, 24]);
    const twelve = product.options.find((o) => o.term === 12);
    assert.equal(twelve.maxRate, 3.4);
    assert.equal(twelve.rateTypeName, "복리");
  } finally {
    await stub.close();
  }
});

test("공시 내용이 그대로면 rates.json을 다시 쓰지 않는다", async () => {
  const stub = await startStub(({ endpoint, topFinGrpNo }) => {
    if (endpoint !== "depositProductsSearch") return { json: savingResponse({ products: [] }) };
    return {
      json: savingResponse({
        products: [
          {
            co: topFinGrpNo,
            cd: "P1",
            company: "테스트은행",
            name: "그대로예금",
            options: [{ term: 12, rate: 3.0, maxRate: 3.1 }],
          },
        ],
      }),
    };
  });
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    const first = await readJson(outDir, "rates.json");
    await run(stub.base, outDir, { force: true });
    const second = await readJson(outDir, "rates.json");
    assert.equal(second.updatedAt, first.updatedAt, "내용이 같은데 updatedAt이 갱신됨");
  } finally {
    await stub.close();
  }
});

test("대표 금리가 그대로면 히스토리에 새 점을 찍지 않는다", async () => {
  const stub = await startStub(({ endpoint, topFinGrpNo }) => {
    if (endpoint !== "depositProductsSearch") return { json: savingResponse({ products: [] }) };
    return {
      json: savingResponse({
        products: [
          {
            co: topFinGrpNo,
            cd: "P1",
            company: "테스트은행",
            name: "그대로예금",
            options: [{ term: 12, rate: 3.0, maxRate: 3.1 }],
          },
        ],
      }),
    };
  });
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    const first = await readJson(outDir, "rates-history.json");
    assert.equal(first.length, 1);

    first[0].date = "2000-01-01";
    await writeFile(path.join(outDir, "rates-history.json"), JSON.stringify(first));
    await run(stub.base, outDir, { force: true });

    const second = await readJson(outDir, "rates-history.json");
    assert.equal(second.length, 1);
    assert.equal(second[0].date, "2000-01-01");
  } finally {
    await stub.close();
  }
});

test("같은 날 다시 실행하면 API를 아예 호출하지 않는다", async () => {
  let calls = 0;
  const stub = await startStub(({ topFinGrpNo }) => {
    calls += 1;
    return {
      json: savingResponse({
        products: [
          {
            co: topFinGrpNo,
            cd: "P1",
            company: "테스트은행",
            name: "예금",
            options: [{ term: 12, rate: 3.0, maxRate: 3.1 }],
          },
        ],
      }),
    };
  });
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    const afterFirst = calls;
    assert.ok(afterFirst > 0, "첫 실행에서 호출이 있어야 한다");

    const { stdout } = await run(stub.base, outDir);
    assert.equal(calls, afterFirst, "같은 날인데 API를 다시 호출했다");
    assert.match(stdout, /이미 조회함/);

    await run(stub.base, outDir, { force: true });
    assert.ok(calls > afterFirst, "RATES_FORCE=1인데도 호출하지 않았다");
  } finally {
    await stub.close();
  }
});

test("요청에 User-Agent를 반드시 실어 보낸다", async () => {
  const seen = new Set();
  const stub = await startStub(({ userAgent }) => {
    seen.add(userAgent);
    return { json: savingResponse({ products: [] }) };
  });
  const outDir = await tempDir();

  try {
    await run(stub.base, outDir);
    assert.ok(seen.size > 0);
    for (const ua of seen) {
      assert.ok(ua && ua.length > 0, "User-Agent 헤더가 비어 있음");
      assert.notEqual(ua, "undefined");
    }
  } finally {
    await stub.close();
  }
});
