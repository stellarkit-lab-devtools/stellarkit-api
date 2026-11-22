const http = require("http");
const WebSocket = require("ws");
const app = require("../src/index");
const { setupWebSocket } = require("../src/websocket");
const { streamingServer: stellarServer } = require("../src/config/stellar");

describe("WebSocket Ledger Stream", () => {
  let server;
  let wss;
  let port;

  beforeAll((done) => {
    server = http.createServer(app);
    wss = setupWebSocket(server);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    wss.close(() => {
      server.close(() => {
        done();
      });
    });
  });

  it("should stream ledger events to the connected client on /stream/ledgers", (done) => {
    const mockCloseStream = jest.fn();
    const fakeLedger = {
      sequence: 54321,
      closed_at: "2026-05-26T20:10:00Z",
      base_fee_in_stroops: 200,
      successful_transaction_count: 12,
    };

    // Spy on stellarServer.ledgers().stream
    const streamSpy = jest.spyOn(stellarServer, "ledgers").mockReturnValue({
      stream: jest.fn().mockImplementation(({ onmessage }) => {
        // Send a fake ledger update asynchronously
        setTimeout(() => {
          onmessage(fakeLedger);
        }, 10);
        return mockCloseStream;
      }),
    });

    const client = new WebSocket(`ws://localhost:${port}/stream/ledgers`);

    let assertionError = null;

    client.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        expect(parsed).toEqual({
          sequence: 54321,
          closedAt: "2026-05-26T20:10:00Z",
          baseFee: 200,
          transactionCount: 12,
        });
      } catch (err) {
        assertionError = err;
      } finally {
        client.close();
      }
    });

    client.on("close", () => {
      // Use setTimeout to allow the server's close handler to execute in the event loop
      setTimeout(() => {
        try {
          expect(mockCloseStream).toHaveBeenCalled();
          if (assertionError) {
            throw assertionError;
          }
        } catch (err) {
          done(err);
          return;
        } finally {
          streamSpy.mockRestore();
        }
        done();
      }, 50);
    });
  });

  it("should reject connections to other paths", (done) => {
    const client = new WebSocket(`ws://localhost:${port}/other-path`);
    client.on("error", (err) => {
      expect(err).toBeDefined();
      done();
    });
  });
});
