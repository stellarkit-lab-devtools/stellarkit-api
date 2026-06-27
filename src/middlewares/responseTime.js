/**
 * X-Response-Time middleware.
 * Records request start time and attaches elapsed milliseconds
 * as an X-Response-Time header on every response.
 * Also logs the response time alongside request ID and route.
 */

const responseTime = (req, res, next) => {
  const start = process.hrtime.bigint();

  // Attach header once the response is about to be sent
  res.on('prefinish', () => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    res.setHeader('X-Response-Time', `${elapsed.toFixed(2)}ms`);

    const requestId = req.id || req.headers['x-request-id'] || '-';
    const method = req.method;
    const route = req.route ? req.route.path : req.path;
    const status = res.statusCode;

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[${requestId}] ${method} ${route} ${status} ${elapsed.toFixed(2)}ms`);
    }
  });

  next();
};

module.exports = responseTime;
