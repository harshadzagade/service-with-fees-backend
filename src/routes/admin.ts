import { Router, Response } from 'express';
import { PrismaClient, ApplicationStatus, FeeCalculationType, UserRole } from '@prisma/client';
import { authenticateToken, authorizeRoles, AuthenticatedRequest } from '../middleware/auth';
import * as bcrypt from 'bcryptjs';

const router = Router();
const prisma = new PrismaClient();

// Helper to write to database audit_logs table
function getDiff(oldObj: any, newObj: any) {
  const diffs: any = {};
  if (!oldObj || !newObj) return diffs;
  for (const key of Object.keys(newObj)) {
    if (key === 'password' || key === 'updatedAt' || key === 'createdAt') continue;
    const oldVal = oldObj[key];
    const newVal = newObj[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs[key] = { from: oldVal, to: newVal };
    }
  }
  return diffs;
}

async function logAction(req: AuthenticatedRequest, action: string, details?: any) {
  try {
    const user = req.user!;
    const ip = req.ip || req.headers['x-forwarded-for'] || '';
    const userAgent = req.headers['user-agent'] || '';

    const finalDetails = {
      ...(details || {}),
      metadata: { ip, userAgent },
    };

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        userEmail: user.email,
        userName: user.name || 'unknown',
        action,
        details: finalDetails,
      },
    });
    console.log(`[AUDIT LOG] User: ${user.email} | Action: ${finalDetails.metadata.ip} | Action: ${action}`);
  } catch (error) {
    console.error('AuditLog insert failure:', error);
  }
}

// ==========================================
// 1. APPLICATIONS & REPORTING ENDPOINTS
// ==========================================

// Fetch Applications (paid/completed)
router.get('/applications', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { status, search } = req.query;
  const user = req.user!;

  try {
    const where: any = {
      status: status
        ? (status as ApplicationStatus)
        : { in: ['SUCCESS', 'FULFILLED'] as ApplicationStatus[] },
    };

    if (user.role !== 'SUPERADMIN' && user.instituteId) {
      where.service = {
        instituteId: user.instituteId,
      };
    }

    if (search) {
      const searchStr = String(search).trim();
      where.OR = [
        { studentName: { contains: searchStr, mode: 'insensitive' } },
        { studentEmail: { contains: searchStr, mode: 'insensitive' } },
        { studentRollNo: { contains: searchStr, mode: 'insensitive' } },
        { studentPhone: { contains: searchStr, mode: 'insensitive' } },
        { payuTxnId: { contains: searchStr, mode: 'insensitive' } },
      ];
    }

    const applications = await prisma.application.findMany({
      where,
      include: {
        service: {
          select: {
            id: true,
            name: true,
            gstRate: true,
            isGstExempt: true,
            feeCalculationType: true,
            instituteId: true,
            institute: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        programme: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
        documents: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(applications);
  } catch (error) {
    console.error('Fetch applications error:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Mark Application as FULFILLED (processed offline)
router.put('/applications/:id/fulfill', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { remarks } = req.body;
  const user = req.user!;

  try {
    const application = await prisma.application.findUnique({
      where: { id },
      include: {
        service: true,
      },
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (user.role !== 'SUPERADMIN' && user.instituteId !== application.service.instituteId) {
      return res.status(403).json({ error: 'Unauthorized to fulfill applications for this institute' });
    }

    const updatedApp = await prisma.application.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        remarks: remarks || application.remarks,
      },
      include: {
        service: true,
        programme: true,
        documents: true,
      },
    });

    // Write Audit Log
    await logAction(req, 'FULFILL_APPLICATION', {
      applicationId: id,
      studentName: application.studentName,
      serviceName: application.service.name,
      remarks,
    });

    res.json({
      message: 'Application marked as FULFILLED successfully',
      application: updatedApp,
    });
  } catch (error) {
    console.error('Fulfill application error:', error);
    res.status(500).json({ error: 'Failed to fulfill application' });
  }
});

// Analytics & Financial Reporting
router.get('/reports', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;

  try {
    const where: any = {
      status: { in: ['SUCCESS', 'FULFILLED'] as ApplicationStatus[] },
    };

    if (user.role !== 'SUPERADMIN' && user.instituteId) {
      where.service = {
        instituteId: user.instituteId,
      };
    }

    const paidApplications = await prisma.application.findMany({
      where,
      include: {
        service: true,
      },
    });

    let totalRevenue = 0;
    let totalBase = 0;
    let totalGst = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalRoundOff = 0;

    const serviceCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = { SUCCESS: 0, FULFILLED: 0 };

    paidApplications.forEach((app) => {
      totalBase += Number(app.baseAmount);
      totalGst += Number(app.gstAmount);
      totalCgst += Number(app.cgstAmount);
      totalSgst += Number(app.sgstAmount);
      totalRoundOff += Number(app.roundOff);
      totalRevenue += Number(app.totalAmount);

      statusCounts[app.status] = (statusCounts[app.status] || 0) + 1;

      const sName = app.service.name;
      serviceCounts[sName] = (serviceCounts[sName] || 0) + 1;
    });

    const pendingWhere: any = { status: 'PENDING' };
    if (user.role !== 'SUPERADMIN' && user.instituteId) {
      pendingWhere.service = { instituteId: user.instituteId };
    }
    const totalPendingCount = await prisma.application.count({ where: pendingWhere });

    res.json({
      metrics: {
        totalPaidApplications: paidApplications.length,
        totalPendingApplications: totalPendingCount,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalBase: Math.round(totalBase * 100) / 100,
        totalGst: Math.round(totalGst * 100) / 100,
        totalCgst: Math.round(totalCgst * 100) / 100,
        totalSgst: Math.round(totalSgst * 100) / 100,
        totalRoundOff: Math.round(totalRoundOff * 100) / 100,
      },
      serviceVolumes: Object.entries(serviceCounts).map(([name, count]) => ({ name, count })),
      statusDistribution: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate financial report' });
  }
});

// ==========================================
// 2. MASTER CONFIGURATIONS (SUPERADMIN ONLY)
// ==========================================

// --- AUDIT LOGS VIEW ---
router.get('/audit-logs', authenticateToken, authorizeRoles('SUPERADMIN'), async (req, res) => {
  const { search } = req.query;
  try {
    const where: any = {};
    if (search) {
      const searchStr = String(search).trim();
      where.OR = [
        { userName: { contains: searchStr, mode: 'insensitive' } },
        { userEmail: { contains: searchStr, mode: 'insensitive' } },
        { action: { contains: searchStr, mode: 'insensitive' } },
      ];
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// --- INSTITUTES CRUD ---
router.get('/institutes', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  try {
    const where: any = {};
    if (user.role === 'INSTITUTE_ADMIN' && user.instituteId) {
      where.id = user.instituteId;
    }
    const insts = await prisma.institute.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(insts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch institutes' });
  }
});

router.post('/institutes', authenticateToken, authorizeRoles('SUPERADMIN'), async (req: AuthenticatedRequest, res) => {
  const { name, code, payuMerchantKey, payuSalt, smtpConfig, gstin, status } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and Code are required' });

  try {
    const inst = await prisma.institute.create({
      data: {
        name,
        code: code.toUpperCase(),
        payuMerchantKey,
        payuSalt,
        smtpConfig: smtpConfig || {},
        gstin,
        status: status || 'ACTIVE',
      },
    });

    await logAction(req, 'CREATE_INSTITUTE', { code: inst.code, name: inst.name });

    res.json(inst);
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Institute Code already exists' });
    res.status(500).json({ error: 'Failed to create institute' });
  }
});

router.put('/institutes/:id', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { name, payuMerchantKey, payuSalt, smtpConfig, gstin, status } = req.body;
  const user = req.user!;

  try {
    if (user.role === 'INSTITUTE_ADMIN') {
      if (user.instituteId !== id) {
        return res.status(403).json({ error: 'Unauthorized to update this institute' });
      }
    }

    const oldInst = await prisma.institute.findUnique({ where: { id } });
    const inst = await prisma.institute.update({
      where: { id },
      data: {
        name: user.role === 'SUPERADMIN' ? name : oldInst?.name,
        payuMerchantKey,
        payuSalt,
        smtpConfig: smtpConfig || {},
        gstin,
        status: user.role === 'SUPERADMIN' ? status : oldInst?.status,
      },
    });

    await logAction(req, 'UPDATE_INSTITUTE', { id: inst.id, name: inst.name, code: inst.code, changes: getDiff(oldInst, inst) });

    res.json(inst);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update institute' });
  }
});

// --- PROGRAMMES CRUD ---
router.get('/programmes', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  try {
    const where: any = {};
    if (user.role === 'INSTITUTE_ADMIN' && user.instituteId) {
      where.instituteId = user.instituteId;
    }
    const progs = await prisma.programme.findMany({
      where,
      include: { institute: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(progs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch programmes' });
  }
});

router.post('/programmes', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const { instituteId, name, category, duration } = req.body;
  const user = req.user!;

  const targetInstId = user.role === 'INSTITUTE_ADMIN' ? user.instituteId : instituteId;
  if (!targetInstId || !name || !category || !duration) {
    return res.status(400).json({ error: 'Missing required programme fields' });
  }

  try {
    const prog = await prisma.programme.create({
      data: { instituteId: targetInstId, name, category, duration },
    });

    await logAction(req, 'CREATE_PROGRAMME', { name: prog.name, instituteId: targetInstId });

    res.json(prog);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create programme' });
  }
});

router.put('/programmes/:id', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { name, category, duration, instituteId } = req.body;
  const user = req.user!;

  try {
    if (user.role === 'INSTITUTE_ADMIN') {
      const existingProg = await prisma.programme.findUnique({ where: { id } });
      if (!existingProg || existingProg.instituteId !== user.instituteId) {
        return res.status(403).json({ error: 'Unauthorized to modify this programme' });
      }
    }

    const targetInstId = user.role === 'INSTITUTE_ADMIN' ? user.instituteId : instituteId;
    if (!targetInstId || !name || !category || !duration) {
      return res.status(400).json({ error: 'Missing required programme fields' });
    }

    const oldProg = await prisma.programme.findUnique({ where: { id } });
    const prog = await prisma.programme.update({
      where: { id },
      data: { name, category, duration, instituteId: targetInstId },
    });

    await logAction(req, 'UPDATE_PROGRAMME', { id: prog.id, name: prog.name, instituteId: targetInstId, changes: getDiff(oldProg, prog) });

    res.json(prog);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update programme' });
  }
});

router.delete('/programmes/:id', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const user = req.user!;
  try {
    if (user.role === 'INSTITUTE_ADMIN') {
      const existingProg = await prisma.programme.findUnique({ where: { id } });
      if (!existingProg || existingProg.instituteId !== user.instituteId) {
        return res.status(403).json({ error: 'Unauthorized to delete this programme' });
      }
    }

    const prog = await prisma.programme.delete({ where: { id } });
    
    await logAction(req, 'DELETE_PROGRAMME', { id: prog.id, name: prog.name });

    res.json({ message: 'Programme deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete programme' });
  }
});

// --- SERVICES CRUD ---
router.get('/services', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  try {
    const where: any = {};
    if (user.role === 'INSTITUTE_ADMIN' && user.instituteId) {
      where.instituteId = user.instituteId;
    }
    const services = await prisma.service.findMany({
      where,
      include: { institute: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

router.post('/services', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const {
    instituteId,
    name,
    formSchema,
    feeCalculationType,
    basePrice,
    additionalPrice,
    gstRate,
    isGstExempt,
  } = req.body;
  const user = req.user!;

  const targetInstId = user.role === 'INSTITUTE_ADMIN' ? user.instituteId : instituteId;
  if (!targetInstId || !name || !feeCalculationType || basePrice === undefined) {
    return res.status(400).json({ error: 'Missing required service fields' });
  }

  try {
    const service = await prisma.service.create({
      data: {
        instituteId: targetInstId,
        name,
        formSchema: formSchema || [],
        feeCalculationType: feeCalculationType as FeeCalculationType,
        basePrice,
        additionalPrice: additionalPrice || 0,
        gstRate: gstRate || 18,
        isGstExempt: !!isGstExempt,
      },
    });

    await logAction(req, 'CREATE_SERVICE', { name: service.name, id: service.id, instituteId: targetInstId });

    res.json(service);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

router.put('/services/:id', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const {
    name,
    formSchema,
    feeCalculationType,
    basePrice,
    additionalPrice,
    gstRate,
    isGstExempt,
  } = req.body;
  const user = req.user!;

  try {
    if (user.role === 'INSTITUTE_ADMIN') {
      const existingService = await prisma.service.findUnique({ where: { id } });
      if (!existingService || existingService.instituteId !== user.instituteId) {
        return res.status(403).json({ error: 'Unauthorized to modify this service' });
      }
    }

    const oldSrv = await prisma.service.findUnique({ where: { id } });
    const service = await prisma.service.update({
      where: { id },
      data: {
        name,
        formSchema: formSchema || [],
        feeCalculationType: feeCalculationType as FeeCalculationType,
        basePrice,
        additionalPrice: additionalPrice || 0,
        gstRate: gstRate || 18,
        isGstExempt: !!isGstExempt,
      },
    });

    await logAction(req, 'UPDATE_SERVICE', { name: service.name, id: service.id, changes: getDiff(oldSrv, service) });

    res.json(service);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update service' });
  }
});

router.delete('/services/:id', authenticateToken, authorizeRoles('SUPERADMIN', 'INSTITUTE_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const user = req.user!;
  try {
    if (user.role === 'INSTITUTE_ADMIN') {
      const existingService = await prisma.service.findUnique({ where: { id } });
      if (!existingService || existingService.instituteId !== user.instituteId) {
        return res.status(403).json({ error: 'Unauthorized to delete this service' });
      }
    }

    const service = await prisma.service.delete({ where: { id } });
    
    await logAction(req, 'DELETE_SERVICE', { name: service.name, id: service.id });

    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// --- USERS CRUD ---
router.get('/users', authenticateToken, authorizeRoles('SUPERADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { institute: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const safeUsers = users.map((u) => {
      const { password, ...safe } = u;
      return safe;
    });
    res.json(safeUsers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', authenticateToken, authorizeRoles('SUPERADMIN'), async (req: AuthenticatedRequest, res) => {
  const { email, name, password, role, instituteId } = req.body;
  if (!email || !name || !password || !role) {
    return res.status(400).json({ error: 'Missing required user fields' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: role as UserRole,
        instituteId: role === 'SUPERADMIN' ? null : instituteId,
      },
    });

    await logAction(req, 'CREATE_USER', { email: user.email, role: user.role, name: user.name });
    
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'User email already exists' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/profile', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const { name, email, password } = req.body;
  const loggedInUser = req.user!;

  if (!email || !name) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  try {
    const updateData: any = { name, email };
    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.user.update({
      where: { id: loggedInUser.id },
      data: updateData,
    });

    await logAction(req, 'UPDATE_PROFILE', { email: updated.email, name: updated.name });

    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/users/:id', authenticateToken, authorizeRoles('SUPERADMIN'), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { email, name, role, instituteId } = req.body;
  if (!email || !name || !role) {
    return res.status(400).json({ error: 'Missing required user fields' });
  }

  try {
    const oldUser = await prisma.user.findUnique({ where: { id } });
    const updated = await prisma.user.update({
      where: { id },
      data: {
        email,
        name,
        role: role as UserRole,
        instituteId: role === 'SUPERADMIN' ? null : instituteId,
      },
    });

    await logAction(req, 'UPDATE_USER', { targetUserId: updated.id, targetEmail: updated.email, targetName: updated.name, role: updated.role, changes: getDiff(oldUser, updated) });

    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'User email already exists' });
    res.status(500).json({ error: 'Failed to update user details' });
  }
});

router.put('/users/:id/reset-password', authenticateToken, authorizeRoles('SUPERADMIN'), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'New password is required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    await logAction(req, 'RESET_PASSWORD', { targetUserId: user.id, targetEmail: user.email, targetName: user.name });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.delete('/users/:id', authenticateToken, authorizeRoles('SUPERADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requestingUser = req.user!;
    if (requestingUser.id === req.params.id) {
      return res.status(400).json({ error: 'Cannot delete your own superadmin account' });
    }
    
    const user = await prisma.user.delete({ where: { id: req.params.id } });

    await logAction(req, 'DELETE_USER', { email: user.email, role: user.role, name: user.name });

    res.json({ message: 'User account deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
