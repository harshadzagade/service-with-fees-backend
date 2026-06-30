import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyPayUHash } from '../utils/payuHasher';
import { sendPaymentSuccessEmail } from '../utils/emailSender';

const router = Router();
const prisma = new PrismaClient();

// Helper to handle successful payment processing (shared by redirect callback and webhook)
async function processSuccessfulPayment(txnId: string, amount: string, payload: any) {
  // Idempotency Check: check if payment log already exists
  const existingLog = await prisma.paymentLog.findUnique({
    where: { payuTxnId: txnId },
  });

  if (existingLog) {
    console.log(`Payment already processed for txnId: ${txnId} (Idempotent bypass)`);
    return;
  }

  // Fetch applications and related details
  const applications = await prisma.application.findMany({
    where: { payuTxnId: txnId },
    include: {
      service: {
        include: { institute: true },
      },
      programme: true,
    },
  });

  if (applications.length === 0) {
    console.error(`Applications not found for transaction: ${txnId}`);
    return;
  }

  // 1. Amount Tampering Check: Ensure received amount matches expected total of applications in database
  const totalExpected = applications.reduce((sum, app) => sum + Number(app.totalAmount), 0);
  if (Math.abs(totalExpected - Number(amount)) > 0.01) {
    console.error(`Amount mismatch for transaction ${txnId}. Expected: ${totalExpected}, Received: ${amount}`);
    throw new Error(`Payment amount mismatch. Tampering suspected. Expected: ${totalExpected}, Received: ${amount}`);
  }

  const firstApp = applications[0];
  const institute = firstApp.service.institute;

  // 1. Create Payment Log
  await prisma.paymentLog.create({
    data: {
      payuTxnId: txnId,
      amount: Number(amount),
      status: 'SUCCESS',
      payload: payload,
    },
  });

  // 2. Update Application statuses to SUCCESS
  await prisma.application.updateMany({
    where: { payuTxnId: txnId },
    data: { status: 'SUCCESS' },
  });

  console.log(`Updated applications to SUCCESS for txnId: ${txnId}`);

  // 3. Trigger email notification with receipt attachment asynchronously (don't block thread)
  sendPaymentSuccessEmail({
    applications,
    institute,
  }).catch((err) => {
    console.error('Asynchronous email trigger failure:', err);
  });

  // 4. Create Audit Log for successful payment
  try {
    await prisma.auditLog.create({
      data: {
        userId: null,
        userEmail: firstApp.studentEmail,
        userName: firstApp.studentName,
        action: 'PAYMENT_SUCCESSFUL',
        details: {
          payuTxnId: txnId,
          amount: amount,
          studentRollNo: firstApp.studentRollNo,
          serviceName: firstApp.service.name,
          instituteCode: firstApp.service.institute.code,
        }
      }
    });
  } catch (auditErr) {
    console.error('Failed to log payment success activity:', auditErr);
  }
}

// 1. Success Callback Redirect (POST request from PayU)
router.post('/callback/success', async (req: Request, res: Response) => {
  const {
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    status,
    hash,
    additionalcharges,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
  } = req.body;

  console.log(`Received SUCCESS payment redirect from PayU for txnId: ${txnid}`);

  try {
    // Resolve institute salt
    const firstApp = await prisma.application.findFirst({
      where: { payuTxnId: txnid },
      include: {
        service: {
          include: { institute: true },
        },
      },
    });

    if (!firstApp) {
      return res.status(404).send('Transaction record not found.');
    }

    const institute = firstApp.service.institute;
    const salt = institute.payuSalt || 'DEFAULT_SANDBOX_SALT';

    // Verify hash server-side
    const isValidHash = verifyPayUHash(
      {
        key,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        status,
        udf1,
        udf2,
        udf3,
        udf4,
        udf5,
        additionalcharges,
        salt,
      },
      hash
    );

    // For mock sandbox keys, let's bypass strict hash check if key is a mock key, ONLY in development/sandbox mode
    const isMock = process.env.NODE_ENV !== 'production' && (key === 'DEFAULT_SANDBOX_KEY' || (typeof key === 'string' && key.startsWith('MOCK_KEY_')) || (typeof key === 'string' && key.includes('MOCK')));
    console.log(`SUCCESS redirect check - key: ${key}, isValidHash: ${isValidHash}, isMock: ${isMock}`);

    if (!isValidHash && !isMock) {
      console.error(`Hash verification failed for success transaction: ${txnid}`);
      return res.status(400).send('Hash verification failed. Potential request tampering.');
    }

    await processSuccessfulPayment(txnid, amount, req.body);

    // Redirect student back to frontend success page
    const clientUrl = `http://localhost:5173/success?txnId=${txnid}&amount=${amount}`;
    res.redirect(clientUrl);
  } catch (error) {
    console.error('Payment success callback processing error:', error);
    res.status(500).send('Payment completion processing failed.');
  }
});

// 2. Failure Callback Redirect (POST request from PayU)
router.post('/callback/failure', async (req: Request, res: Response) => {
  const { txnid, amount } = req.body;
  console.log(`Received FAILURE payment redirect from PayU for txnId: ${txnid}`);

  try {
    // Record failure log
    await prisma.paymentLog.create({
      data: {
        payuTxnId: txnid,
        amount: Number(amount || 0),
        status: 'FAILED',
        payload: req.body,
      },
    }).catch(() => {}); // ignore duplicates

    // Record failure Audit Log
    try {
      await prisma.auditLog.create({
        data: {
          userId: null,
          userEmail: 'anonymous',
          userName: 'student',
          action: 'PAYMENT_FAILED',
          details: {
            payuTxnId: txnid,
            amount: amount,
          }
        }
      });
    } catch (err) {}

    const clientUrl = `http://localhost:5173/failure?txnId=${txnid}`;
    res.redirect(clientUrl);
  } catch (error) {
    console.error('Payment failure callback processing error:', error);
    res.status(500).send('Payment failure logging failed.');
  }
});

// 3. Server-to-Server Webhook (HTTP callback)
router.post('/webhook', async (req: Request, res: Response) => {
  const {
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    status,
    hash,
    additionalcharges,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
  } = req.body;

  console.log(`Received PayU Webhook webhook hit for txnId: ${txnid}`);

  try {
    const firstApp = await prisma.application.findFirst({
      where: { payuTxnId: txnid },
      include: {
        service: {
          include: { institute: true },
        },
      },
    });

    if (!firstApp) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const institute = firstApp.service.institute;
    const salt = institute.payuSalt || 'DEFAULT_SANDBOX_SALT';

    const isValidHash = verifyPayUHash(
      {
        key,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        status,
        udf1,
        udf2,
        udf3,
        udf4,
        udf5,
        additionalcharges,
        salt,
      },
      hash
    );

    const isMock = process.env.NODE_ENV !== 'production' && (key === 'DEFAULT_SANDBOX_KEY' || (typeof key === 'string' && key.startsWith('MOCK_KEY_')) || (typeof key === 'string' && key.includes('MOCK')));
    console.log(`WEBHOOK check - key: ${key}, isValidHash: ${isValidHash}, isMock: ${isMock}`);
    if (!isValidHash && !isMock) {
      console.error(`Hash verification failed for webhook: ${txnid}`);
      return res.status(400).json({ error: 'Hash verification failed' });
    }

    if (status === 'success') {
      await processSuccessfulPayment(txnid, amount, req.body);
    } else {
      await prisma.paymentLog.create({
        data: {
          payuTxnId: txnid,
          amount: Number(amount || 0),
          status: 'FAILED',
          payload: req.body,
        },
      }).catch(() => {});
    }

    res.status(200).json({ status: 'OK' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
