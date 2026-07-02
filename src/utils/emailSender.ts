import * as nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import { generateReceiptPdf } from './pdfReceipt';

const prisma = new PrismaClient();

export interface SendEmailParams {
  applications: any[];
  institute: any;
}

export async function sendPaymentSuccessEmail(params: SendEmailParams): Promise<void> {
  const { applications, institute } = params;
  if (!applications || applications.length === 0) return;

  const firstApp = applications[0];
  const studentEmail = firstApp.studentEmail;
  const studentName = firstApp.studentName;
  const txnId = firstApp.payuTxnId;
  const finalTotalAmount = applications.reduce((sum, app) => sum + Number(app.totalAmount), 0);

  // Fetch admin emails for this institute from database
  let adminEmails: string[] = [];
  try {
    const admins = await prisma.user.findMany({
      where: {
        instituteId: institute.id,
        role: 'INSTITUTE_ADMIN',
      },
      select: { email: true },
    });
    adminEmails = admins.map(a => a.email);
  } catch (err) {
    console.error('Failed to fetch admin users for email CC:', err);
  }

  // 1. Establish Transporter settings (dynamically read from Institute or default to Env)
  const instSmtp = institute.smtpConfig as any;
  const smtpHost = instSmtp?.host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(instSmtp?.port || process.env.SMTP_PORT || 587);
  const smtpUser = instSmtp?.user || process.env.SMTP_USER || 'test@example.com';
  const smtpPass = instSmtp?.pass || process.env.SMTP_PASS || '';
  const smtpFrom = instSmtp?.from || process.env.SMTP_FROM || smtpUser || 'noreply@met.edu';

  // Compile CC recipients: SMTP config ccEmail, global fallbacks, and all institute admins
  const ccRecipients: string[] = [];
  if (instSmtp?.ccEmail) ccRecipients.push(instSmtp.ccEmail);
  if (process.env.SMTP_CC) ccRecipients.push(process.env.SMTP_CC);
  if (process.env.ADMIN_EMAIL) ccRecipients.push(process.env.ADMIN_EMAIL);

  adminEmails.forEach((email) => {
    if (email && !ccRecipients.includes(email)) {
      ccRecipients.push(email);
    }
  });

  const finalCcString = ccRecipients.join(', ');

  console.log(`Configuring SMTP connection for ${institute.name} via ${smtpHost}:${smtpPort}...`);

  try {
    // Generate PDF receipt buffer
    const pdfBuffer = await generateReceiptPdf(applications, institute);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const itemsHtml = applications
      .map(
        (app) =>
          `<li><strong>${app.service.name}</strong> - Rs. ${Number(app.totalAmount).toFixed(2)}</li>`
      )
      .join('');

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px;">MET Registrar Services</h2>
        <p>Dear <strong>${studentName}</strong>,</p>
        <p>Your payment for registrar services has been processed successfully. Below are your transaction details:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #4b5563;">Transaction ID:</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right; font-family: monospace;">${txnId}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #4b5563;">Institute:</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${institute.name}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #4b5563;">Total Paid:</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: bold; color: #1e3a8a;">Rs. ${finalTotalAmount.toFixed(2)}</td>
          </tr>
        </table>

        <p><strong>Services Applied:</strong></p>
        <ul style="padding-left: 20px; margin-bottom: 20px;">
          ${itemsHtml}
        </ul>

        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 13px; color: #4b5563;">
            We have attached your official GST Tax Invoice / Payment Receipt to this email. 
            The registrar administration has been notified of your request and will process it offline.
          </p>
        </div>

        <p style="font-size: 12px; color: #9ca3af; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 10px;">
          This is an automated notification. Please do not reply directly to this email. For service inquiries, contact your respective MET Registrar office.
        </p>
      </div>
    `;

    const mailOptions: nodemailer.SendMailOptions = {
      from: `"${institute.name} Registrar" <${smtpFrom}>`,
      to: studentEmail,
      subject: `Payment Successful - MET Registrar Services (Txn ID: ${txnId})`,
      html: htmlContent,
      attachments: [
        {
          filename: `Receipt_${txnId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    };

    if (finalCcString) {
      mailOptions.cc = finalCcString;
      console.log(`Adding CC recipients: ${finalCcString}`);
    }

    await transporter.sendMail(mailOptions);
    console.log(`Notification email with receipt PDF sent successfully to ${studentEmail}`);
  } catch (error) {
    // Catch SMTP configuration or mail sending issues to prevent webhook failure
    console.error('SMTP Error: Failed to send payment confirmation email.');
    console.error(error);
  }
}
