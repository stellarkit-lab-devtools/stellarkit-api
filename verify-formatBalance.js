#!/usr/bin/env node
const { formatBalance } = require("./src/utils/formatBalance");

console.log("Testing formatBalance utility...\n");

const testCases = [
  { input: "10000.1234567", expected: "10,000.1234567", description: "Basic formatting with decimals" },
  { input: "0.0000100", expected: "0.0000100", description: "Small balance - no trailing zero stripping" },
  { input: "1234567.89", expected: "1,234,567.89", description: "Large balance" },
  { input: "100", expected: "100", description: "Small number under 1000" },
  { input: "1000", expected: "1,000", description: "Exactly 1000" },
  { input: "50000.0000000", expected: "50,000.0000000", description: "XLM balance" },
  { input: "0", expected: "0", description: "Zero" },
  { input: "999999999.999999", expected: "999,999,999.999999", description: "Large balance with decimals" },
  { input: null, expected: null, description: "Null input" },
  { input: undefined, expected: undefined, description: "Undefined input" },
];

let passed = 0;
let failed = 0;

testCases.forEach(({ input, expected, description }) => {
  const result = formatBalance(input);
  const isPass = result === expected;
  
  if (isPass) {
    console.log(`✓ ${description}`);
    console.log(`  Input: ${JSON.stringify(input)} → Output: ${JSON.stringify(result)}`);
    passed++;
  } else {
    console.log(`✗ ${description}`);
    console.log(`  Input: ${JSON.stringify(input)}`);
    console.log(`  Expected: ${JSON.stringify(expected)}`);
    console.log(`  Got: ${JSON.stringify(result)}`);
    failed++;
  }
  console.log();
});

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}

console.log("✅ All tests passed!");
process.exit(0);
