# MET Registrar Services & Fees Engine - Backend v2.7

This is the secure backend server for the MET Registrar Services & Academic Portal. It manages university, AICTE, autonomous, and pharma college records, computes GST and rounding-compliant fee breakdowns, handles PayU checkout transactions with server-side validation, and stores application files securely on AWS S3.

---

## 🛠️ Technology Stack
- **Runtime:** Node.js (v18+) with TypeScript (`tsc`)
- **Web Framework:** Express.js with CORS and secure request body parsers
- **ORM & Database:** Prisma ORM with PostgreSQL database driver
- **Security Middlewares:** `express-rate-limit` (brute-force defense)
- **PDF Invoicing:** `pdfkit` dynamic tax invoice compilation
- **File Uploads:** `multer` with AWS S3 storage engine integration
- **Email Dispatch:** `nodemailer` with dynamic SMTP configurations

---

## 🔒 Security Features
1. **API Rate Limiting:**
   - **General Rate Limiter:** Restricts client IPs to a maximum of 300 requests per 15 minutes globally on `/api` routes.
   - **Strict Rate Limiter:** Restricts client IPs to a maximum of 20 requests per 15 minutes on brute-force sensitive endpoints: `/api/auth/login` (admin entry points) and `/api/public/checkout` (checkout request creations).
2. **SQL Injection Immunity:**
   - The database layer queries records strictly utilizing the **Prisma ORM** query APIs (prepared statements). There are zero raw SQL executions, making the database layer immune to injection vectors.
3. **Payment Integrity & Sandbox Isolation:**
   - Server-side expected amount verification compares callback values against the expected total inside the database to prevent payment price tampering.
   - Sandbox mock bypass checks are restricted strictly to non-production environments (`process.env.NODE_ENV !== 'production'`).

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have Node.js and PostgreSQL installed.

### 2. Installation
Install the project dependencies:
```bash
npm install
```

### 3. Setup Environment Variables
Create a `.env` file in the root directory:
```env
PORT=5000
DATABASE_URL="postgresql://user:password@localhost:5432/met_registrar?schema=public"

# AWS S3 Storage Config
AWS_ACCESS_KEY_ID="your_access_key"
AWS_SECRET_ACCESS_KEY="your_secret_key"
AWS_REGION="ap-south-1"
S3_BUCKET_NAME="met-registrar-uploads"

# PayU Credentials
PAYU_MERCHANT_KEY="your_payu_key"
PAYU_SALT="your_payu_salt"
PAYU_BASE_URL="https://test.payu.in" # sandbox or production URL
```

### 4. Database Setup & Seeding
Run Prisma migrations to construct the database schema and seed the Master Data:
```bash
npx prisma migrate dev --name init
npx prisma db seed
```

### 5. Running the Application
Run the TypeScript development server with hot-reload:
```bash
npm run dev
```

Run production compiling:
```bash
npm run build
npm run start
```

---

## 📦 Directory Structure
- `src/index.ts` - Main Express app bootstrapping and middleware registration.
- `src/middleware/rateLimiter.ts` - Rate limiter configurations.
- `src/routes/` - Router controllers:
  - `auth.ts` - Registrar admin login session management.
  - `admin.ts` - Applications audit list, logs, and CRUD operations.
  - `payments.ts` - PayU checkout generation, callbacks, and server signature verification.
  - `public.ts` - Public portal configuration queries.
- `src/utils/` - Dynamic PDF invoice compilers, email senders, S3 file upload configurations, and PayU hashing engines.
