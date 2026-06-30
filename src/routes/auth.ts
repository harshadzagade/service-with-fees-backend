import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'met_registrar_jwt_secret_key_2026_xyz';

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || '';
  const userAgent = req.headers['user-agent'] || '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { institute: true },
    });

    if (!user) {
      // Log failed attempt (email not found)
      await prisma.auditLog.create({
        data: {
          userId: null,
          userEmail: email,
          userName: 'unknown',
          action: 'FAILED_LOGIN_ATTEMPT',
          details: {
            reason: 'User not found',
            metadata: { ip, userAgent }
          }
        }
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      // Log failed attempt (incorrect password)
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          userName: user.name || 'unknown',
          action: 'FAILED_LOGIN_ATTEMPT',
          details: {
            reason: 'Incorrect password',
            metadata: { ip, userAgent }
          }
        }
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        instituteId: user.instituteId,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Write Login Audit Log
    try {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          userName: user.name || 'unknown',
          action: 'ADMIN_LOGIN',
          details: { 
            role: user.role,
            metadata: { ip, userAgent }
          },
        },
      });
      console.log(`[AUDIT LOG] Successful login for: ${user.email}`);
    } catch (auditError) {
      console.error('Failed to log admin login activity:', auditError);
    }

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        instituteId: user.instituteId,
        instituteName: user.institute?.name || null,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
