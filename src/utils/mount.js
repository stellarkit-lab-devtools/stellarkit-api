/**
 * Route mounting helper that records prefixes for endpoint discovery.
 * 
 * This replaces manual app.use('/prefix', router) calls with mount(app, '/prefix', router).
 * It builds a registry that can be inspected to generate the / endpoints list.
 */

// Global registry of mounted routes
const mountedRoutes = [];

/**
 * Mount a router at a prefix and record it for endpoint discovery.
 * 
 * @param {Express app} app - The Express application
 * @param {string} prefix - The URL prefix (e.g., '/api', '/account')
 * @param {Express Router} router - The router to mount
 * @param {Object} options - Optional configuration
 * @param {string} options.description - Description of this route group
 * @param {string} options.kind - Type of route: 'http' (default), 'sse', 'websocket'
 * @returns {Express Router} The router that was mounted (for chaining)
 */
function mount(app, prefix, router, options = {}) {
  // Record this mount for endpoint discovery
  mountedRoutes.push({
    prefix,
    router,
    description: options.description || `Routes under ${prefix}`,
    kind: options.kind || 'http',
  });

  // Mount the router
  app.use(prefix, router);

  return router;
}

/**
 * Get all registered routes from the registry
 * @returns {Array} Array of mounted route info
 */
function getMountedRoutes() {
  return [...mountedRoutes];
}

/**
 * Clear the route registry (primarily for testing)
 */
function clearMountedRoutes() {
  mountedRoutes.length = 0;
}

/**
 * Describe a route - used by route files to add descriptions to specific routes
 * 
 * This middleware can be added to individual routes to provide descriptions
 * that will be included in the GET / endpoint list.
 * 
 * @param {string} text - Description of the route
 * @param {Object} options - Route options
 * @param {string} options.kind - 'http' (default), 'sse', 'websocket'
 */
function describe(text, options = {}) {
  return (req, res, next) => {
    // Store description on the route for later retrieval
    req.routeDescription = text;
    req.routeKind = options.kind || 'http';
    next();
  };
}

/**
 * Extract all endpoints from an Express app by walking the router stack.
 * Returns sorted list by path then method.
 * 
 * @param {Express app} app - The Express application
 * @returns {Array} Array of { method, path, description, kind }
 */
function extractEndpoints(app) {
  const endpoints = [];
  const seen = new Set(); // Prevent duplicates by construction

  // Walk the middleware stack
  const stack = app._router?.stack || [];
  
  for (const layer of stack) {
    // Handle mounted routers
    if (layer.route) {
      // Direct route
      const route = layer.route;
      const path = layer.regexp?.source 
        ? layer.regexp.source.replace(/\\\//g, '/').replace(/\/\?/g, '/:').replace(/^\\?/, '')
        : '/';
      
      const methods = Object.keys(route.methods).map(m => m.toUpperCase());
      
      for (const method of methods) {
        const key = `${method}:${path}`;
        if (!seen.has(key)) {
          seen.add(key);
          endpoints.push({
            method,
            path,
            description: route.description || '',
            kind: route.kind || 'http',
          });
        }
      }
    } else if (layer.handle && layer.handle.stack) {
      // Nested router
      extractFromRouter(layer.handle, '', endpoints, seen);
    }
  }

  // Sort by path then method
  return endpoints.sort((a, b) => {
    const pathCompare = a.path.localeCompare(b.path, undefined, { numeric: true });
    if (pathCompare !== 0) return pathCompare;
    return a.method.localeCompare(b.method);
  });
}

/**
 * Helper to extract endpoints from a router
 */
function extractFromRouter(router, basePath, endpoints, seen) {
  const stack = router.stack || [];
  
  for (const layer of stack) {
    if (layer.route) {
      const route = layer.route;
      const fullPath = basePath + (layer.regexp?.source 
        ? layer.regexp.source.replace(/\\\//g, '/').replace(/\/\?/g, '/:').replace(/^\\?/, '')
        : '/');
      
      const methods = Object.keys(route.methods).map(m => m.toUpperCase());
      
      for (const method of methods) {
        const key = `${method}:${fullPath}`;
        if (!seen.has(key)) {
          seen.add(key);
          endpoints.push({
            method,
            path: fullPath,
            description: route.description || '',
            kind: route.kind || 'http',
          });
        }
      }
    } else if (layer.handle && layer.handle.stack) {
      // Further nested router - extract its path
      const nestedPath = layer.regexp?.source 
        ? basePath + layer.regexp.source.replace(/\\\//g, '/').replace(/\/\?/g, '/:').replace(/^\\?/, '')
        : basePath;
      extractFromRouter(layer.handle, nestedPath, endpoints, seen);
    }
  }
}

module.exports = {
  mount,
  getMountedRoutes,
  clearMountedRoutes,
  describe,
  extractEndpoints,
};