const NodeCache = require("node-cache");

function createCache() {
  return new NodeCache({ stdTTL: 60, checkperiod: 12, useClones: false });
}

module.exports = {
  networkStatusCache: createCache(),
  feeEstimateCache: createCache(),
  contractDependenciesCache: createCache(),
  complianceCheckCache: new NodeCache({ stdTTL: 30, checkperiod: 12, useClones: false }),
};
