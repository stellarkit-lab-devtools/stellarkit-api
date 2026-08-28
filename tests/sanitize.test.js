const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("Sanitize Middleware", () => {
  beforeEach(() => {
    jest.spyOn(server, "serverInfo").mockResolvedValue({ horizon_version: "2.33.0" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe("Whitespace trimming", () => {
    it("trims leading and trailing whitespace from query params", async () => {
      const res = await request(app).get("/utils/validate-account?id=%20GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN%20");
      expect(res.statusCode).not.toBe(400);
    });
  });

  describe("Null byte stripping", () => {
    it("strips null bytes from query params", async () => {
      const res = await request(app).get("/health?foo=bar%00baz");
      expect(res.statusCode).toBe(200);
    });

    it("strips null bytes from path params", async () => {
      const res = await request(app).get("/account/GAAZI%004TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
      expect(res.statusCode).not.toBe(500);
    });
  });

  describe("Length enforcement", () => {
    it("returns 400 when a query param exceeds 500 characters", async () => {
      const longValue = "A".repeat(501);
      const res = await request(app).get(`/health?foo=${longValue}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
      expect(res.body.error.message).toContain("500");
    });

    it("returns 400 when a path param exceeds 100 characters", async () => {
      const longValue = "G".repeat(101);
      const res = await request(app).get(`/account/${longValue}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("InvalidParameter");
    });

    it("allows query params exactly at the 500 character limit", async () => {
      const exactValue = "A".repeat(500);
      const res = await request(app).get(`/health?foo=${exactValue}`);
      expect(res.statusCode).not.toBe(400);
    });
  });

  describe("Route parameter injection patterns", () => {
    it("rejects account IDs containing SQL-like injection patterns", async () => {
      const res = await request(app).get("/account/GAAZI'; DROP TABLE--");
      expect(res.statusCode).toBe(400);
      expect(res.body.error.type).toBe("InvalidParameter");
    });

    it("rejects asset codes containing angle brackets", async () => {
      const res = await request(app).get("/asset/<script>/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
      expect(res.statusCode).toBe(400);
      expect(res.body.error.type).toBe("InvalidParameter");
    });

    it("rejects contract IDs containing double quotes", async () => {
      const res = await request(app).get('/soroban/contract/C"INJECTED');
      expect(res.statusCode).toBe(400);
      expect(res.body.error.type).toBe("InvalidParameter");
    });
  });

  describe("Unit tests for sanitize function", () => {
    const sanitize = require("../src/middleware/sanitize");

    it("calls next() for valid input", (done) => {
      const req = { params: { id: "valid" }, query: { foo: "bar" }, body: { a: "b" } };
      const res = { status: () => res, json: () => res };
      sanitize(req, res, () => {
        expect(req.params.id).toBe("valid");
        expect(req.query.foo).toBe("bar");
        expect(req.body.a).toBe("b");
        done();
      });
    });

    it("trims whitespace from params, query, and body", (done) => {
      const req = {
        params: { id: "  hello  " },
        query: { q: "  world  " },
        body: { nested: { a: "  body  " } },
      };
      const res = {};
      sanitize(req, res, () => {
        expect(req.params.id).toBe("hello");
        expect(req.query.q).toBe("world");
        expect(req.body.nested.a).toBe("body");
        done();
      });
    });

    it("removes null bytes from params and query", (done) => {
      const req = { params: { id: "hel\0lo" }, query: { q: "wo\0rld" } };
      const res = {};
      sanitize(req, res, () => {
        expect(req.params.id).toBe("hello");
        expect(req.query.q).toBe("world");
        done();
      });
    });

    it("returns InvalidParameter for route params over 100 characters", (done) => {
      const req = { params: { id: "G".repeat(101) }, query: {} };
      const res = {
        status(code) {
          this._code = code;
          return this;
        },
        json(body) {
          expect(this._code).toBe(400);
          expect(body.success).toBe(false);
          expect(body.error.type).toBe("InvalidParameter");
          done();
        },
      };
      sanitize(req, res, () => {
        done(new Error("next() should not have been called"));
      });
    });

    it("returns InvalidParameter for route params with injection characters", (done) => {
      const req = { params: { id: "abc<script>" }, query: {} };
      const res = {
        status(code) {
          this._code = code;
          return this;
        },
        json(body) {
          expect(this._code).toBe(400);
          expect(body.error.type).toBe("InvalidParameter");
          done();
        },
      };
      sanitize(req, res, () => {
        done(new Error("next() should not have been called"));
      });
    });

    it("returns 400 JSON for query value exceeding 500 chars", (done) => {
      const req = { params: {}, query: { foo: "B".repeat(501) } };
      const res = {
        status(code) {
          this._code = code;
          return this;
        },
        json(body) {
          expect(this._code).toBe(400);
          expect(body.success).toBe(false);
          done();
        },
      };
      sanitize(req, res, () => {
        done(new Error("next() should not have been called"));
      });
    });

    it("trims leading/trailing whitespace from body string values", (done) => {
      const req = { params: {}, query: {}, body: { name: "  Alice  ", note: "  hello  " } };
      const res = {};
      sanitize(req, res, () => {
        expect(req.body.name).toBe("Alice");
        expect(req.body.note).toBe("hello");
        done();
      });
    });

    it("strips null bytes from body string values", (done) => {
      const req = { params: {}, query: {}, body: { name: "Ali\0ce", token: "abc\0def" } };
      const res = {};
      sanitize(req, res, () => {
        expect(req.body.name).toBe("Alice");
        expect(req.body.token).toBe("abcdef");
        done();
      });
    });

    it("returns 400 when a body string value exceeds 500 characters", (done) => {
      const req = { params: {}, query: {}, body: { data: "X".repeat(501) } };
      const res = {
        status(code) {
          this._code = code;
          return this;
        },
        json(body) {
          expect(this._code).toBe(400);
          expect(body.success).toBe(false);
          expect(body.error.type).toBe("ValidationError");
          expect(body.error.message).toContain("500");
          done();
        },
      };
      sanitize(req, res, () => {
        done(new Error("next() should not have been called"));
      });
    });

    it("recursively sanitizes nested object body values", (done) => {
      const req = {
        params: {},
        query: {},
        body: {
          outer: "  trim me  ",
          nested: {
            inner: "  deep  ",
            arr: ["  a  ", "  b  "],
            deep: { value: "  deeper\0  " },
          },
        },
      };
      const res = {};
      sanitize(req, res, () => {
        expect(req.body.outer).toBe("trim me");
        expect(req.body.nested.inner).toBe("deep");
        expect(req.body.nested.arr).toEqual(["a", "b"]);
        expect(req.body.nested.deep.value).toBe("deeper");
        done();
      });
    });
  });
});
