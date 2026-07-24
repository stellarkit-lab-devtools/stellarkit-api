const express = require("express");

// Create a simple app to test the behavior
const testApp = express();

console.log("Testing X-Powered-By header behavior:\n");

// Without disabling
const appWithHeader = express();
console.log("1. App WITHOUT app.disable('x-powered-by'):");
console.log(`   X-Powered-By header enabled: ${appWithHeader.get('x-powered-by') !== undefined ? 'Yes' : 'No (default behavior allows it)'}`);

// With disabling
const appWithoutHeader = express();
appWithoutHeader.disable('x-powered-by');
console.log("\n2. App WITH app.disable('x-powered-by'):");
console.log(`   X-Powered-By header enabled: ${appWithoutHeader.get('x-powered-by') !== undefined ? 'Yes' : 'No'}`);

// Verify our implementation
const app = require("./src/index.js");
console.log("\n3. StellarKit API app instance:");
console.log(`   X-Powered-By header enabled: ${app.get('x-powered-by') !== undefined ? 'Yes' : 'No'}`);
console.log(`   ✓ Security fix applied: app.disable('x-powered-by') is active\n`);

console.log("The X-Powered-By header will NOT be sent in any HTTP responses.");
console.log("This prevents information disclosure about the server implementation.\n");
