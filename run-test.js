#!/usr/bin/env node
const request = require('supertest');
const app = require('./src/index');

async function runTest() {
  console.log('Testing /fee-estimate endpoint...\n');
  
  try {
    const res = await request(app).get('/fee-estimate?operations=2');
    
    console.log('Status:', res.statusCode);
    console.log('Response:', JSON.stringify(res.body, null, 2));
    
    if (res.statusCode !== 200) {
      console.error('❌ TEST FAILED: Unexpected status code');
      process.exit(1);
    }
    
    const data = res.body.data;
    
    // Check required fields
    const checks = [
      { field: 'operationCount', check: data.hasOwnProperty('operationCount') },
      { field: 'perOperation', check: data.hasOwnProperty('perOperation') },
      { field: 'context', check: data.hasOwnProperty('context') && typeof data.context === 'string' },
      { field: 'networkCongestion', check: data.hasOwnProperty('networkCongestion') && ['low', 'medium', 'high'].includes(data.networkCongestion) },
      { field: 'recommendation', check: data.hasOwnProperty('recommendation') && typeof data.recommendation === 'string' },
    ];
    
    console.log('\n✓ Field Checks:');
    let allPassed = true;
    checks.forEach(({field, check}) => {
      if (check) {
        console.log(`  ✓ ${field}`);
      } else {
        console.log(`  ✗ ${field}`);
        allPassed = false;
      }
    });
    
    if (allPassed) {
      console.log('\n✅ ALL TESTS PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ SOME TESTS FAILED');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error running test:', err);
    process.exit(1);
  }
}

runTest();
