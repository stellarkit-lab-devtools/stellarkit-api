// Asset Code Normalizer Middleware
// Uppercases asset code in route params and query params
module.exports = (req, res, next) => {
  if (req.params && typeof req.params.code === 'string') {
    req.params.code = req.params.code.toUpperCase();
  }
  if (req.query && typeof req.query.code === 'string') {
    req.query.code = req.query.code.toUpperCase();
  }
  next();
};
