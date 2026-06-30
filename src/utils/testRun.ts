import { calculateFee } from './feeCalculator';
import { generatePayUHash, verifyPayUHash } from './payuHasher';
import { FeeCalculationType } from '@prisma/client';

console.log('==================================================');
console.log(' RUNNING AUTOMATED CHECKS FOR MET REGISTRAR PORTAL ');
console.log('==================================================\n');

let passedTestsCount = 0;
let totalTestsCount = 0;

function assert(condition: boolean, testName: string) {
  totalTestsCount++;
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passedTestsCount++;
  } else {
    console.error(`[FAIL] ${testName}`);
  }
}

// ----------------------------------------------------
// FEE CALCULATION TEST 1: FIXED (Bonafide)
// ----------------------------------------------------
try {
  const result = calculateFee(
    FeeCalculationType.FIXED,
    200.00,
    0.00,
    18.00,
    false,
    {}
  );
  
  assert(result.baseAmount === 200, 'Fixed calculation - Base price matches');
  assert(result.gstAmount === 36, 'Fixed calculation - GST 18% matches (36.00)');
  assert(result.cgstAmount === 18 && result.sgstAmount === 18, 'Fixed calculation - CGST/SGST split matches 50/50');
  assert(result.roundOff === 0, 'Fixed calculation - Round off is 0.00');
  assert(result.totalAmount === 236, 'Fixed calculation - Final total is 236');
} catch (e: any) {
  console.error('[FAIL] Fixed calculation crashed', e);
  totalTestsCount++;
}

// ----------------------------------------------------
// FEE CALCULATION TEST 2: SEMESTER_WISE & Fuzzy Key Matching (Duplicate Marksheet)
// ----------------------------------------------------
try {
  const result = calculateFee(
    FeeCalculationType.SEMESTER_WISE,
    150.00,
    0.00,
    18.00,
    false,
    { semesters_to_apply: ['Semester 1', 'Semester 2', 'Semester 3'] }
  );
  
  assert(result.baseAmount === 450, 'Semester-wise calculation - Base price (150 * 3) matches');
  assert(result.qty === 3, 'Semester-wise - Fuzzy semesters key matching works');
  assert(result.gstAmount === 81, 'Semester-wise calculation - GST (450 * 0.18) matches (81.00)');
  assert(result.cgstAmount === 40.5 && result.sgstAmount === 40.5, 'Semester-wise calculation - CGST/SGST splits match 50/50');
  assert(result.totalAmount === 531, 'Semester-wise calculation - Final total is 531');
} catch (e: any) {
  console.error('[FAIL] Semester-wise calculation crashed', e);
  totalTestsCount++;
}

// ----------------------------------------------------
// FEE CALCULATION TEST 3: BASE_PLUS_ADDITIONAL & ROUNDING (Transcript - 2 Copies)
// ----------------------------------------------------
try {
  const result = calculateFee(
    FeeCalculationType.BASE_PLUS_ADDITIONAL,
    125.00,
    50.00,
    18.00,
    false,
    { number_of_copies: 2 },
    1 // includedQuantity = 1
  );

  assert(result.baseAmount === 175, 'Base+Additional - Base price (125 + 50) matches');
  assert(result.qty === 2, 'Base+Additional - Fuzzy copies key matching works');
  assert(result.additionalQty === 1, 'Base+Additional - Additional quantity is 1');
  assert(result.additionalFee === 50, 'Base+Additional - Additional fee is 50');
  assert(result.gstAmount === 31.5, 'Base+Additional - GST matches (31.50)');
  assert(result.cgstAmount === 15.75 && result.sgstAmount === 15.75, 'Base+Additional - CGST/SGST splits match 15.75');
  assert(result.totalAmount === 207, 'Base+Additional - Rounded Grand Total is 207');
  assert(result.roundOff === 0.5, 'Base+Additional - Round off adjustment is +0.50');
} catch (e: any) {
  console.error('[FAIL] Base+Additional calculation crashed', e);
  totalTestsCount++;
}

// ----------------------------------------------------
// FEE CALCULATION TEST 4: BASE_PLUS_ADDITIONAL with includedQuantity = 2 (Pharma Transcripts - 3 Copies)
// ----------------------------------------------------
try {
  const result = calculateFee(
    FeeCalculationType.BASE_PLUS_ADDITIONAL,
    500.00,
    200.00,
    18.00,
    false,
    { number_of_copies: 3 },
    2 // includedQuantity = 2
  );

  assert(result.baseAmount === 700, 'Base+Additional (Pharma) - Base price (500 + 200) matches');
  assert(result.qty === 3, 'Base+Additional (Pharma) - Fuzzy copies key matching works');
  assert(result.additionalQty === 1, 'Base+Additional (Pharma) - Additional quantity is 1 (3 - 2)');
  assert(result.additionalFee === 200, 'Base+Additional (Pharma) - Additional fee is 200');
  assert(result.gstAmount === 126, 'Base+Additional (Pharma) - GST matches (126.00)');
  assert(result.totalAmount === 826, 'Base+Additional (Pharma) - Rounded Grand Total is 826');
} catch (e: any) {
  console.error('[FAIL] Base+Additional Pharma calculation crashed', e);
  totalTestsCount++;
}

// ----------------------------------------------------
// PAYU CRYPTOGRAPHIC HASHER TESTS
// ----------------------------------------------------
try {
  const requestParams = {
    key: 'MOCK_KEY',
    txnid: 'TXN12345',
    amount: '200',
    productinfo: 'Bonafide Certificate',
    firstname: 'Rahul',
    email: 'rahul@example.com',
    salt: 'MOCK_SALT',
  };

  const reqHash = generatePayUHash(requestParams);
  assert(reqHash !== '', 'PayU Request Hash generated successfully');

  const responseParams = {
    key: 'MOCK_KEY',
    txnid: 'TXN12345',
    amount: '200',
    productinfo: 'Bonafide Certificate',
    firstname: 'Rahul',
    email: 'rahul@example.com',
    status: 'success',
    salt: 'MOCK_SALT',
  };

  const crypto = require('crypto');
  const hashString = `MOCK_SALT|success|||||||||||rahul@example.com|Rahul|Bonafide Certificate|200|TXN12345|MOCK_KEY`;
  const responseHash = crypto.createHash('sha512').update(hashString).digest('hex');

  const isValid = verifyPayUHash(responseParams, responseHash);
  assert(isValid, 'PayU Response Hash verified successfully');
} catch (e: any) {
  console.error('[FAIL] PayU Hasher tests crashed', e);
  totalTestsCount++;
}

console.log('\n==================================================');
console.log(` RESULT: Passed ${passedTestsCount} out of ${totalTestsCount} tests.`);
console.log('==================================================');
process.exit(passedTestsCount === totalTestsCount ? 0 : 1);
