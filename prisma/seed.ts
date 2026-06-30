import { PrismaClient, FeeCalculationType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Clear existing data (in order of dependencies)
  await prisma.document.deleteMany();
  await prisma.application.deleteMany();
  await prisma.paymentLog.deleteMany();
  await prisma.service.deleteMany();
  await prisma.programme.deleteMany();
  await prisma.user.deleteMany();
  await prisma.institute.deleteMany();
  await prisma.auditLog.deleteMany();

  console.log('Existing tables cleared.');

  // 2. Read master data JSON file
  const dataPath = path.join(__dirname, 'master_data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Master data file not found at ${dataPath}. Run parse_excel.py first.`);
  }
  const masterData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // 3. Create Superadmin User
  const superadminPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      email: 'superadmin@met.edu',
      name: 'Super Admin',
      password: superadminPassword,
      role: UserRole.SUPERADMIN,
    },
  });
  console.log('Superadmin user created.');

  // 4. Create Institutes
  const createdInstitutes: { [code: string]: any } = {};
  for (const inst of masterData.institutes) {
    const dbInst = await prisma.institute.create({
      data: {
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
    console.log(`Institute created: ${inst.name} (${inst.code})`);

    // Create a default admin account for this institute
    const adminPassword = await bcrypt.hash(`${inst.code.toLowerCase()}123`, 10);
    await prisma.user.create({
      data: {
        email: `${inst.code.toLowerCase()}admin@met.edu`,
        name: `${inst.code} Admin`,
        password: adminPassword,
        role: UserRole.INSTITUTE_ADMIN,
        instituteId: dbInst.id,
      },
    });
    console.log(`Admin account created for ${inst.code}: ${inst.code.toLowerCase()}admin@met.edu`);
  }

  // 5. Create Programmes
  const createdProgrammes: { [key: string]: any } = {};
  for (const prog of masterData.programmes) {
    const inst = createdInstitutes[prog.instituteCode];
    if (!inst) {
      console.warn(`Warning: Institute code ${prog.instituteCode} not found for programme ${prog.name}. Skipping.`);
      continue;
    }
    const dbProg = await prisma.programme.create({
      data: {
        instituteId: inst.id,
        name: prog.name,
        category: prog.category,
        duration: prog.duration,
      },
    });
    createdProgrammes[`${prog.instituteCode}_${prog.name}`] = dbProg;
  }
  console.log(`Programmes created: ${masterData.programmes.length}`);

  // 6. Create Services
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
