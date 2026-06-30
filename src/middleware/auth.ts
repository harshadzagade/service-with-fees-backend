import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'met_registrar_jwt_secret_key_2026_xyz';
const prisma = new PrismaClient();

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string;
    role: string;
    instituteId?: string;
  };
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

export function authorizeRoles(...roles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      if (req.user) {
        // Log unauthorized attempt to auditLog
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            userEmail: req.user.email,
            userName: req.user.name || 'unknown',
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            details: {
              url: req.originalUrl,
              method: req.method,
              ip: req.ip || req.headers['x-forwarded-for'] || '',
              userAgent: req.headers['user-agent'] || '',
            }
          }
        }).catch((err) => {
          console.error('Failed to log unauthorized access attempt:', err);
        });
      }
      return res.status(403).json({ error: 'Unauthorized role access' });
    }
    next();
  };
}
