import { FeeCalculationType } from '@prisma/client';

export interface FeeBreakdown {
  baseAmount: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  roundOff: number;
  totalAmount: number;
  qty: number;
  basePrice: number;
  additionalPrice: number;
  additionalQty: number;
  additionalFee: number;
}

export function calculateFee(
  calculationType: FeeCalculationType,
  basePrice: number,
  additionalPrice: number,
  gstRate: number,
  isGstExempt: boolean,
  submittedData: any,
  includedQuantity?: number
): FeeBreakdown {
  let baseAmount = 0;
  let qtyUsed = 1;
  let addQty = 0;
  let addFee = 0;

  // 1. Resolve qty and semester count dynamically using fuzzy matching
  const qtyKey = Object.keys(submittedData || {}).find(k => 
    k.toLowerCase().includes('copies') || 
    k.toLowerCase().includes('quantity') || 
    k.toLowerCase().includes('qty')
  );
  const qtyVal = qtyKey ? Number(submittedData[qtyKey]) : 1;
  const qty = isNaN(qtyVal) ? 1 : qtyVal;

  const semKey = Object.keys(submittedData || {}).find(k => 
    k.toLowerCase().includes('semester') || 
    k.toLowerCase().includes('sem')
  );
  const semesters = semKey ? submittedData[semKey] : null;
  const semesterCount = Array.isArray(semesters) ? semesters.length : (semesters !== null && semesters !== undefined ? 1 : 1);

  // 2. Calculate Base Amount based on Calculation Type
  switch (calculationType) {
    case FeeCalculationType.FIXED: {
      baseAmount = basePrice;
      break;
    }
    case FeeCalculationType.FLAT_COPY_WISE: {
      qtyUsed = qty;
      baseAmount = basePrice * qtyUsed;
      break;
    }
    case FeeCalculationType.BASE_PLUS_ADDITIONAL: {
      qtyUsed = qty;
      const incQty = includedQuantity !== undefined ? includedQuantity : 1;
      addQty = Math.max(0, qtyUsed - incQty);
      addFee = additionalPrice * addQty;
      baseAmount = basePrice + addFee;
      break;
    }
    case FeeCalculationType.SEMESTER_WISE: {
      qtyUsed = semesterCount;
      baseAmount = basePrice * qtyUsed;
      break;
    }
    default: {
      baseAmount = basePrice;
    }
  }

  // 3. Calculate GST Amount
  const rate = isGstExempt ? 0 : gstRate;
  const rawGst = baseAmount * (rate / 100);
  const gstAmount = Math.round(rawGst * 100) / 100; // Retain 2 decimal places

  // 4. CGST/SGST Split (50/50 before rounding)
  const cgstAmount = Math.round((gstAmount / 2) * 100) / 100;
  const sgstAmount = Math.round((gstAmount - cgstAmount) * 100) / 100; // Ensures CGST + SGST = GST exactly

  // 5. Calculate Total Before Round Off
  const totalBeforeRoundOff = baseAmount + gstAmount;

  // 6. Calculate Final Total Amount (nearest whole rupee)
  const totalAmount = Math.round(totalBeforeRoundOff);

  // 7. Calculate Round Off Adjustment
  const roundOff = Math.round((totalAmount - totalBeforeRoundOff) * 100) / 100;

  return {
    baseAmount: Math.round(baseAmount * 100) / 100,
    gstAmount,
    cgstAmount,
    sgstAmount,
    roundOff,
    totalAmount,
    qty: qtyUsed,
    basePrice,
    additionalPrice,
    additionalQty: addQty,
    additionalFee: Math.round(addFee * 100) / 100,
  };
}
