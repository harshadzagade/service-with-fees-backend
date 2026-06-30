import { Router, Request, Response } from 'express';
import { PrismaClient, FeeCalculationType } from '@prisma/client';
import { getPresignedUploadUrl } from '../utils/fileUploader';
import { calculateFee } from '../utils/feeCalculator';
import { generatePayUHash } from '../utils/payuHasher';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const prisma = new PrismaClient();

// 1. Get all active institutes
router.get('/institutes', async (req: Request, res: Response) => {
  try {
    const institutes = await prisma.institute.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        code: true,
        gstin: true,
      },
    });
    res.json(institutes);
  } catch (error) {
    console.error('Fetch institutes error:', error);
    res.status(500).json({ error: 'Failed to fetch institutes' });
  }
});

// 2. Get programmes for an institute
router.get('/institutes/:id/programmes', async (req: Request, res: Response) => {
  try {
    const programmes = await prisma.programme.findMany({
      where: { instituteId: req.params.id },
      select: {
        id: true,
        name: true,
        category: true,
        duration: true,
      },
    });
    res.json(programmes);
  } catch (error) {
    console.error('Fetch programmes error:', error);
    res.status(500).json({ error: 'Failed to fetch programmes' });
  }
});

// 3. Get services for an institute
router.get('/institutes/:id/services', async (req: Request, res: Response) => {
  try {
    const services = await prisma.service.findMany({
      where: { instituteId: req.params.id },
    });
    res.json(services);
  } catch (error) {
    console.error('Fetch services error:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// 4. Generate Pre-signed URL
router.post('/presign-upload', async (req: Request, res: Response) => {
  const { fileName, fileType } = req.body;
  if (!fileName || !fileType) {
    return res.status(400).json({ error: 'fileName and fileType are required' });
  }
  try {
    const presignedData = await getPresignedUploadUrl(fileName, fileType);
    res.json(presignedData);
  } catch (error) {
    console.error('Pre-sign URL generation error:', error);
    res.status(500).json({ error: 'Failed to generate pre-signed URL' });
  }
});

// 5. Local Mock PUT Upload Route (matches AWS S3 PUT request structure)
router.put('/upload-local', (req: Request, res: Response) => {
  const fileName = req.query.fileName as string;
  if (!fileName) {
    return res.status(400).json({ error: 'fileName query param is required' });
  }

  // Ensure uploads directory exists
  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const uploadPath = path.join(uploadDir, fileName);
  const writeStream = fs.createWriteStream(uploadPath);

  req.pipe(writeStream);

  writeStream.on('finish', () => {
    console.log(`Successfully saved local upload to: ${uploadPath}`);
    res.status(200).json({ success: true, url: `/uploads/${fileName}` });
  });

  writeStream.on('error', (err) => {
    console.error('Local file write error:', err);
    res.status(500).json({ error: 'Failed to write file locally' });
  });
});

// 6. Checkout - Calculate Pricing, Create PENDING applications, and build PayU Request payload
router.post('/checkout', async (req: Request, res: Response) => {
  const {
    studentEmail,
    studentName,
    studentPhone,
    studentRollNo,
    instituteId,
    programmeId,
    cart, // Array of { serviceId, submittedData, files: Array<{ fileName, s3Url, fileType }> }
  } = req.body;

  if (
    !studentEmail ||
    !studentName ||
    !studentPhone ||
    !studentRollNo ||
    !instituteId ||
    !programmeId ||
    !cart ||
    !Array.isArray(cart) ||
    cart.length === 0
  ) {
    return res.status(400).json({ error: 'Missing required student or cart fields' });
  }

  try {
    const institute = await prisma.institute.findUnique({ where: { id: instituteId } });
    if (!institute) return res.status(404).json({ error: 'Institute not found' });

    const programme = await prisma.programme.findUnique({ where: { id: programmeId } });
    if (!programme) return res.status(404).json({ error: 'Programme not found' });

    const txnId = `MET_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const createdApplications = [];
    let cartTotalAmount = 0;
    const serviceNames: string[] = [];

    // Process each cart item to calculate GST-compliant fees and store as PENDING application
    for (const item of cart) {
      const service = await prisma.service.findFirst({
        where: { id: item.serviceId, instituteId: instituteId },
      });

      if (!service) {
        return res.status(400).json({ error: `Service ID ${item.serviceId} not found under this institute` });
      }

      serviceNames.push(service.name);

      // Perform backend calculations
      const breakdown = calculateFee(
        service.feeCalculationType,
        Number(service.basePrice),
        Number(service.additionalPrice),
        Number(service.gstRate),
        service.isGstExempt,
        item.submittedData,
        service.includedQuantity
      );

      cartTotalAmount += breakdown.totalAmount;

      // Save application with status PENDING
      const application = await prisma.application.create({
        data: {
          studentEmail,
          studentName,
          studentPhone,
          studentRollNo,
          programmeId,
          serviceId: service.id,
          submittedData: item.submittedData,
          baseAmount: breakdown.baseAmount,
          gstAmount: breakdown.gstAmount,
          cgstAmount: breakdown.cgstAmount,
          sgstAmount: breakdown.sgstAmount,
          roundOff: breakdown.roundOff,
          totalAmount: breakdown.totalAmount,
          status: 'PENDING',
          payuTxnId: txnId,
        },
      });

      // Save associated documents if uploaded
      if (item.files && Array.isArray(item.files)) {
        for (const file of item.files) {
          await prisma.document.create({
            data: {
              applicationId: application.id,
              fileName: file.fileName,
              s3Url: file.s3Url,
              fileType: file.fileType,
            },
          });
        }
      }

      createdApplications.push(application);
    }

    // Build PayU Request Hash
    const merchantKey = institute.payuMerchantKey || 'DEFAULT_SANDBOX_KEY';
    const merchantSalt = institute.payuSalt || 'DEFAULT_SANDBOX_SALT';
    const productInfo = serviceNames.join(', ').substring(0, 80); // PayU limit

    const payuHashParams = {
      key: merchantKey,
      txnid: txnId,
      amount: cartTotalAmount.toString(),
      productinfo: productInfo,
      firstname: studentName.split(' ')[0], // First name only
      email: studentEmail,
      salt: merchantSalt,
    };

    const hash = generatePayUHash(payuHashParams);

    res.json({
      txnId,
      totalAmount: cartTotalAmount,
      payuParams: {
        key: payuHashParams.key,
        txnid: payuHashParams.txnid,
        amount: payuHashParams.amount,
        productinfo: payuHashParams.productinfo,
        firstname: payuHashParams.firstname,
        email: payuHashParams.email,
        hash: hash,
        surl: `http://localhost:5000/api/payments/callback/success`,
        furl: `http://localhost:5000/api/payments/callback/failure`,
      },
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Checkout failed due to internal error' });
  }
});

export default router;
