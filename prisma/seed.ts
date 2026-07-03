import { PrismaClient, FeeCalculationType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database safely (upserting configurations)...');

  // 1. Read master data JSON file
  const dataPath = path.join(__dirname, 'master_data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Master data file not found at ${dataPath}. Run parse_excel.py first.`);
  }
  const masterData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // 2. Upsert Superadmin User
  const superadminPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'superadmin@met.edu' },
    update: {
      name: 'Super Admin',
      role: UserRole.SUPERADMIN,
    },
    create: {
      email: 'superadmin@met.edu',
      name: 'Super Admin',
      password: superadminPassword,
      role: UserRole.SUPERADMIN,
    },
  });
  console.log('Superadmin user upserted.');

  // 3. Upsert Institutes and admin accounts
  const createdInstitutes: { [code: string]: any } = {};
  for (const inst of masterData.institutes) {
    const dbInst = await prisma.institute.upsert({
      where: { code: inst.code },
      update: {
        name: inst.name,
        payuMerchantKey: inst.payuMerchantKey,
        payuSalt: inst.payuSalt,
        smtpConfig: inst.smtpConfig,
        gstin: inst.gstin,
      },
      create: {
        name: inst.name,
        code: inst.code,
        payuMerchantKey: inst.payuMerchantKey,
        payuSalt: inst.payuSalt,
        smtpConfig: inst.smtpConfig,
        gstin: inst.gstin,
        status: 'ACTIVE',
      },
    });
    createdInstitutes[inst.code] = dbInst;
    console.log(`Institute configured: ${inst.name} (${inst.code})`);

    // Upsert default admin account for this institute
    const adminEmail = `${inst.code.toLowerCase()}admin@met.edu`;
    const adminPassword = await bcrypt.hash(`${inst.code.toLowerCase()}123`, 10);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        name: `${inst.code} Admin`,
        instituteId: dbInst.id,
      },
      create: {
        email: adminEmail,
        name: `${inst.code} Admin`,
        password: adminPassword,
        role: UserRole.INSTITUTE_ADMIN,
        instituteId: dbInst.id,
      },
    });
    console.log(`Admin account configured for ${inst.code}: ${adminEmail}`);
  }

  // 4. Upsert Programmes
  for (const prog of masterData.programmes) {
    const inst = createdInstitutes[prog.instituteCode];
    if (!inst) {
      console.warn(`Warning: Institute code ${prog.instituteCode} not found for programme ${prog.name}. Skipping.`);
      continue;
    }

    // Check if programme already exists for this institute
    let dbProg = await prisma.programme.findFirst({
      where: {
        instituteId: inst.id,
        name: prog.name,
      },
    });

    if (!dbProg) {
      dbProg = await prisma.programme.create({
        data: {
          instituteId: inst.id,
          name: prog.name,
          category: prog.category,
          duration: prog.duration,
        },
      });
      console.log(`Programme created: ${prog.name} under ${prog.instituteCode}`);
    } else {
      dbProg = await prisma.programme.update({
        where: { id: dbProg.id },
        data: {
          category: prog.category,
          duration: prog.duration,
        },
      });
      console.log(`Programme updated: ${prog.name} under ${prog.instituteCode}`);
    }
  }

  // 5. Upsert Services
  for (const srv of masterData.services) {
    const inst = createdInstitutes[srv.instituteCode];
    if (!inst) {
      console.warn(`Warning: Institute code ${srv.instituteCode} not found for service ${srv.name}. Skipping.`);
      continue;
    }

    // Map string calculation engine to enum
    let calcType: FeeCalculationType;
    if (srv.feeCalculationType === 'FIXED') calcType = FeeCalculationType.FIXED;
    else if (srv.feeCalculationType === 'FLAT_COPY_WISE') calcType = FeeCalculationType.FLAT_COPY_WISE;
    else if (srv.feeCalculationType === 'BASE_PLUS_ADDITIONAL') calcType = FeeCalculationType.BASE_PLUS_ADDITIONAL;
    else if (srv.feeCalculationType === 'SEMESTER_WISE') calcType = FeeCalculationType.SEMESTER_WISE;
    else calcType = FeeCalculationType.FIXED;

    // Check if service already exists for this institute
    let dbSrv = await prisma.service.findFirst({
      where: {
        instituteId: inst.id,
        name: srv.name,
      },
    });

    if (!dbSrv) {
      await prisma.service.create({
        data: {
          instituteId: inst.id,
          name: srv.name,
          formSchema: srv.formSchema,
          feeCalculationType: calcType,
          basePrice: srv.basePrice,
          additionalPrice: srv.additionalPrice,
          includedQuantity: srv.includedQuantity,
          gstRate: 18.00,
          isGstExempt: srv.isGstExempt,
        },
      });
      console.log(`Service created: ${srv.name} under ${srv.instituteCode}`);
    } else {
      await prisma.service.update({
        where: { id: dbSrv.id },
        data: {
          formSchema: srv.formSchema,
          feeCalculationType: calcType,
          basePrice: srv.basePrice,
          additionalPrice: srv.additionalPrice,
          includedQuantity: srv.includedQuantity,
          isGstExempt: srv.isGstExempt,
        },
      });
      console.log(`Service updated: ${srv.name} under ${srv.instituteCode}`);
    }
  }

  console.log('Seeding database complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
