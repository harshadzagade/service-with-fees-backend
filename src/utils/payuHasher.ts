import * as crypto from 'crypto';

export interface PayURequestParams {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  salt: string;
}

export function generatePayUHash(params: PayURequestParams): string {
  const {
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1 = '',
    udf2 = '',
    udf3 = '',
    udf4 = '',
    udf5 = '',
    salt,
  } = params;

  // Pattern: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
  const hashString = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
  
  return crypto.createHash('sha512').update(hashString).digest('hex');
}

export interface PayUResponseParams {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  status: string; // success, failure
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  additionalcharges?: string;
  salt: string;
}

export function verifyPayUHash(params: PayUResponseParams, receivedHash: string): boolean {
  const {
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    status,
    udf1 = '',
    udf2 = '',
    udf3 = '',
    udf4 = '',
    udf5 = '',
    additionalcharges = '',
    salt,
  } = params;

  // PayU response hash calculation pattern:
  // If additionalcharges is present:
  // sha512(additionalcharges|salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
  // Else:
  // sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
  
  const baseString = `${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  
  let hashString = '';
  if (additionalcharges) {
    hashString = `${additionalcharges}|${salt}|${baseString}`;
  } else {
    hashString = `${salt}|${baseString}`;
  }

  const calculatedHash = crypto.createHash('sha512').update(hashString).digest('hex');
  return calculatedHash.toLowerCase() === receivedHash.toLowerCase();
}
