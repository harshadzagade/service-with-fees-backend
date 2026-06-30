import PDFDocument from 'pdfkit';

export function generateReceiptPdf(applications: any[], institute: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const firstApp = applications[0];
      const studentName = firstApp.studentName;
      const studentEmail = firstApp.studentEmail;
      const studentPhone = firstApp.studentPhone;
      const studentRollNo = firstApp.studentRollNo;
      const programmeName = firstApp.programme.name;
      const txnId = firstApp.payuTxnId;
      const dateStr = new Date(firstApp.createdAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // 1. Header (Brand Color Accent: HSL 220, 80%, 30% -> dark navy)
      doc.rect(0, 0, 595.28, 12).fill('#1e3a8a');
      doc.y = 30;

      // Institute Logo Placeholder & Name
      doc.fontSize(16).fillColor('#1e3a8a').text(institute.name, { align: 'left' });
      doc.fontSize(10).fillColor('#4b5563').text(`Code: ${institute.code} | GSTIN: ${institute.gstin || 'N/A'}`);
      doc.text(`Address: Mumbai, Maharashtra, India`, { lineGap: 15 });

      // Invoice Title
      doc.fontSize(20).fillColor('#111827').text('TAX INVOICE / RECEIPT', { align: 'right' });
      doc.moveDown(1);

      // Horizontal line separator
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
      doc.moveDown(1);

      // 2. Info Columns (Student Info & Invoice Info side by side)
      const currentY = doc.y;
      
      // Left Column: Student Details
      doc.fontSize(11).fillColor('#1e3a8a').text('BILL TO (APPLICANT):', 40, currentY);
      doc.fontSize(10).fillColor('#1f2937');
      doc.text(`Name: ${studentName}`);
      doc.text(`Email: ${studentEmail}`);
      doc.text(`Phone: ${studentPhone}`);
      doc.text(`Roll No: ${studentRollNo}`);
      doc.text(`Programme: ${programmeName}`);

      // Right Column: Invoice Details
      doc.fontSize(11).fillColor('#1e3a8a').text('TRANSACTION DETAILS:', 340, currentY);
      doc.fontSize(10).fillColor('#1f2937');
      doc.text(`Transaction ID: ${txnId}`, 340);
      doc.text(`Date & Time: ${dateStr}`, 340);
      doc.text(`Payment Gateway: PayU`, 340);
      doc.text(`Status: Paid / Success`, 340);

      doc.y = Math.max(doc.y, currentY + 110);
      doc.moveDown(1);

      // 3. Table of Services
      doc.fontSize(11).fillColor('#1e3a8a').text('ITEMS / SERVICES SUMMARY:', 40);
      doc.moveDown(0.5);

      // Table Header
      const tableTop = doc.y;
      doc.rect(40, tableTop, 515, 20).fill('#f3f4f6');
      doc.fontSize(9).fillColor('#374151');
      doc.text('Service Requested', 45, tableTop + 6, { width: 180, ellipsis: true });
      doc.text('Qty / Details', 230, tableTop + 6, { width: 70 });
      doc.text('Base Amt', 310, tableTop + 6, { width: 60, align: 'right' });
      doc.text('GST Rate', 380, tableTop + 6, { width: 50, align: 'right' });
      doc.text('GST (CGST/SGST)', 440, tableTop + 6, { width: 60, align: 'right' });
      doc.text('Total', 505, tableTop + 6, { width: 45, align: 'right' });

      let rowY = tableTop + 20;
      let totalBase = 0;
      let totalGst = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let grandTotalBeforeRound = 0;
      let finalGrandTotal = 0;

      applications.forEach((app) => {
        const base = Number(app.baseAmount);
        const gst = Number(app.gstAmount);
        const cgst = Number(app.cgstAmount);
        const sgst = Number(app.sgstAmount);
        const total = Number(app.totalAmount);

        totalBase += base;
        totalGst += gst;
        totalCgst += cgst;
        totalSgst += sgst;
        grandTotalBeforeRound += base + gst;
        finalGrandTotal += total;

        // Determine description detail based on dynamic responses
        let details = '1 Copy';
        const calcType = app.service.feeCalculationType;
        const submitted = (app.submittedData || {}) as any;

        const qtyKey = Object.keys(submitted).find(k => 
          k.toLowerCase().includes('copies') || 
          k.toLowerCase().includes('quantity') || 
          k.toLowerCase().includes('qty')
        );
        const qtyVal = qtyKey ? Number(submitted[qtyKey]) : 1;
        const qty = isNaN(qtyVal) ? 1 : qtyVal;

        const semKey = Object.keys(submitted).find(k => 
          k.toLowerCase().includes('semester') || 
          k.toLowerCase().includes('sem')
        );
        const sems = semKey ? submitted[semKey] : null;

        if (calcType === 'FLAT_COPY_WISE' || calcType === 'BASE_PLUS_ADDITIONAL') {
          details = `${qty} Cop${qty > 1 ? 'ies' : 'y'}`;
        } else if (calcType === 'SEMESTER_WISE') {
          details = Array.isArray(sems) ? `${sems.length} Sem(s)` : (sems ? '1 Sem' : '0 Sem');
        }

        // Draw row borders
        doc.rect(40, rowY, 515, 24).strokeColor('#f3f4f6').lineWidth(1).stroke();

        // Print row values
        doc.fontSize(9).fillColor('#1f2937');
        doc.text(app.service.name, 45, rowY + 8, { width: 180, ellipsis: true });
        doc.text(details, 230, rowY + 8, { width: 70 });
        doc.text(`Rs. ${base.toFixed(2)}`, 310, rowY + 8, { width: 60, align: 'right' });
        doc.text(`${app.service.isGstExempt ? 'Exempt' : `${app.service.gstRate}%`}`, 380, rowY + 8, { width: 50, align: 'right' });
        doc.text(`Rs. ${gst.toFixed(2)}`, 440, rowY + 8, { width: 60, align: 'right' });
        doc.text(`Rs. ${total.toFixed(2)}`, 505, rowY + 8, { width: 45, align: 'right' });

        rowY += 24;
      });

      doc.y = rowY;
      doc.moveDown(1.5);

      // 4. Financial Calculations Summary
      const summaryY = doc.y;
      
      // Bottom left terms
      doc.fontSize(8).fillColor('#6b7280').text('Terms & Conditions:', 40, summaryY, { width: 250 });
      doc.text('1. This receipt is computer-generated and requires no physical signature.', 40, doc.y + 4);
      doc.text('2. Payments are non-refundable and routed to respective MET institute accounts.', 40, doc.y + 4);
      doc.text('3. For any service issues, please contact your registrar office offline.', 40, doc.y + 4);

      // Bottom right breakdown
      const startX = 340;
      doc.fontSize(9).fillColor('#374151');
      
      doc.text('Total Base Amount:', startX, summaryY, { width: 120 });
      doc.text(`Rs. ${totalBase.toFixed(2)}`, 460, summaryY, { width: 90, align: 'right' });

      doc.text('CGST Split (50%):', startX, doc.y + 6, { width: 120 });
      doc.text(`Rs. ${totalCgst.toFixed(2)}`, 460, doc.y, { width: 90, align: 'right' });

      doc.text('SGST Split (50%):', startX, doc.y + 6, { width: 120 });
      doc.text(`Rs. ${totalSgst.toFixed(2)}`, 460, doc.y, { width: 90, align: 'right' });

      doc.text('Total Tax (GST):', startX, doc.y + 6, { width: 120 });
      doc.text(`Rs. ${totalGst.toFixed(2)}`, 460, doc.y, { width: 90, align: 'right' });

      const roundOffVal = finalGrandTotal - grandTotalBeforeRound;
      doc.text('Round Off Adjustment:', startX, doc.y + 6, { width: 120 });
      doc.text(`${roundOffVal >= 0 ? '+' : ''}Rs. ${roundOffVal.toFixed(2)}`, 460, doc.y, { width: 90, align: 'right' });

      // Separator
      doc.moveTo(startX, doc.y + 6).lineTo(555, doc.y + 6).strokeColor('#9ca3af').lineWidth(1.5).stroke();

      // Grand Total
      doc.fontSize(12).fillColor('#1e3a8a').text('Grand Total:', startX, doc.y + 10, { width: 120 });
      doc.text(`Rs. ${finalGrandTotal.toFixed(0)}`, 460, doc.y, { width: 90, align: 'right' });

      // Footer
      doc.rect(0, 830, 595.28, 12).fill('#1e3a8a');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
