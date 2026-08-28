const sanitize = require("../../src/middleware/sanitize");
const { sanitizeAny } = require("../../src/middleware/sanitize");

describe("Sanitize middleware — edge cases", () => {
  describe("Deeply nested object sanitization", () => {
    it("trims and strips null bytes from a deeply nested object", (done) => {
      const req = {
        params: {},
        query: {},
        body: {
          a: {
            b: {
              c: {
                d: {
                  e: {
                    f: {
                      value: "  deep\0value  ",
                    },
                  },
                },
              },
            },
          },
        },
      };
      const res = {};
      sanitize(req, res, () => {
        expect(req.body.a.b.c.d.e.f.value).toBe("deepvalue");
        done();
      });
    });
  });

  describe("Array of strings in request body", () => {
    it("sanitizes an array of strings in req.body", (done) => {
      const req = {
        params: {},
        query: {},
        body: ["  first\0item  ", "  second\0item  ", "  third  "],
      };
      const res = {};
      sanitize(req, res, () => {
        expect(req.body).toEqual(["firstitem", "seconditem", "third"]);
        done();
      });
    });
  });

  describe("Body with 100 keys", () => {
    it("sanitizes a body with 100 keys", (done) => {
      const body = {};
      for (let i = 0; i < 100; i++) {
        body[`key${i}`] = `  value${i}  `;
      }
      const req = { params: {}, query: {}, body };
      const res = {};
      sanitize(req, res, () => {
        for (let i = 0; i < 100; i++) {
          expect(req.body[`key${i}`]).toBe(`value${i}`);
        }
        done();
      });
    });
  });

  describe("Request with no body", () => {
    it("calls next() when req.body is null", (done) => {
      const req = { params: {}, query: {}, body: null };
      const res = {};
      sanitize(req, res, () => {
        done();
      });
    });

    it("calls next() when req.body is undefined", (done) => {
      const req = { params: {}, query: {}, body: undefined };
      const res = {};
      sanitize(req, res, () => {
        done();
      });
    });
  });

  describe("Coverage — additional edge cases", () => {
    it("passes non-string values (number, boolean, null) through sanitizeAny", (done) => {
      const res = {};
      expect(sanitizeAny(42, res)).toBe(42);
      expect(sanitizeAny(true, res)).toBe(true);
      expect(sanitizeAny(null, res)).toBe(null);
      expect(sanitizeAny(false, res)).toBe(false);
      done();
    });

    it("covers walkValidate returning true for non-string values", (done) => {
      const req = {
        params: {},
        query: {},
        body: { count: 5, flag: true, nothing: null },
      };
      const res = {};
      sanitize(req, res, () => {
        expect(req.body.count).toBe(5);
        expect(req.body.flag).toBe(true);
        expect(req.body.nothing).toBe(null);
        done();
      });
    });

    it("sanitizes array values in query params", (done) => {
      const req = {
        params: {},
        query: { tags: ["  a  ", "  b\0c  ", "  d  "] },
        body: {},
      };
      const res = {};
      sanitize(req, res, () => {
        expect(req.query.tags).toEqual(["a", "bc", "d"]);
        done();
      });
    });

    it("returns aborted when sanitizeAny encounters a string over 500 chars in body", (done) => {
      const res = {
        status(code) {
          this._code = code;
          return this;
        },
        json(body) {
          expect(this._code).toBe(400);
          expect(body.success).toBe(false);
          expect(body.error.type).toBe("ValidationError");
          done();
        },
      };
      const result = sanitizeAny("X".repeat(501), res);
      expect(result).toEqual({ aborted: true });
    });
  });
});