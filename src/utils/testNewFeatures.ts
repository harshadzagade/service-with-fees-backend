import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const baseUrl = 'http://localhost:5000/api';

async function runTests() {
  console.log('--- STARTING INTEGRATION TESTS FOR NEW EXTENSIONS ---');
  
  try {
    // 1. Log in as Superadmin
    console.log('1. Logging in as superadmin...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'superadmin@met.edu',
        password: 'admin123',
      }),
    });
    
    if (!loginRes.ok) throw new Error('Superadmin login failed');
    const { token, user: adminUser } = await loginRes.json() as any;
    console.log('   Logged in successfully! Token obtained.');

    // 2. Verify ADMIN_LOGIN log exists
    console.log('2. Verifying login log in AuditLog...');
    const recentLogsRes = await fetch(`${baseUrl}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!recentLogsRes.ok) throw new Error('Failed to fetch audit logs');
    const logs = await recentLogsRes.json() as any[];
    
    const loginLog = logs.find(l => l.action === 'ADMIN_LOGIN' && l.userEmail === 'superadmin@met.edu');
    if (!loginLog) {
      throw new Error('ADMIN_LOGIN was not logged in the database.');
    }
    console.log('   Verified! Login logged: ', loginLog);

    // 3. Create a test admin user
    console.log('3. Creating test user account...');
    const createRes = await fetch(`${baseUrl}/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Temporary Test Admin',
        email: 'temp.admin@met.edu',
        password: 'tempPassword123',
        role: 'INSTITUTE_ADMIN',
        instituteId: adminUser.instituteId || 'be2f1533-1a18-404a-8456-9667a81992fe', // use Engineering id from seed
      }),
    });
    if (!createRes.ok) throw new Error(`Create user failed: ${await createRes.text()}`);
    const tempUser = await createRes.json() as any;
    console.log(`   User created successfully. ID: ${tempUser.id}`);

    // 4. Update the test admin user details
    console.log('4. Updating user details via PUT /users/:id...');
    const updateRes = await fetch(`${baseUrl}/admin/users/${tempUser.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Updated Test Admin Name',
        email: 'temp.admin@met.edu',
        role: 'INSTITUTE_ADMIN',
        instituteId: tempUser.instituteId,
      }),
    });
    if (!updateRes.ok) throw new Error(`Update user failed: ${await updateRes.text()}`);
    console.log('   User details updated successfully.');

    // 5. Reset the user's password
    console.log('5. Resetting password for test user via PUT /users/:id/reset-password...');
    const resetRes = await fetch(`${baseUrl}/admin/users/${tempUser.id}/reset-password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        password: 'newSecretPassword123',
      }),
    });
    if (!resetRes.ok) throw new Error('Password reset failed');
    console.log('   Password reset successfully.');

    // 6. Log in as the new user using the new password
    console.log('6. Logging in as the updated test user...');
    const newLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'temp.admin@met.edu',
        password: 'newSecretPassword123',
      }),
    });
    if (!newLoginRes.ok) throw new Error(`Login failed for updated user: ${await newLoginRes.text()}`);
    const { token: userToken } = await newLoginRes.json() as any;
    console.log('   Login successful for updated user using new password!');

    // 7. Update own profile
    console.log('7. Updating own profile details via PUT /profile...');
    const profileRes = await fetch(`${baseUrl}/admin/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        name: 'Final Scoped Admin User',
        email: 'temp.admin@met.edu',
        password: 'finalPassword321', // change password again
      }),
    });
    if (!profileRes.ok) throw new Error('Self profile update failed');
    console.log('   Profile self-update completed successfully.');

    // 8. Delete the temporary test user
    console.log('8. Cleaning up: deleting test user account...');
    const deleteRes = await fetch(`${baseUrl}/admin/users/${tempUser.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!deleteRes.ok) throw new Error('Failed to delete user');
    console.log('   User deleted successfully.');

    // 9. Verify the final AuditLog table content
    console.log('9. Checking audit logs for operations...');
    const finalLogsRes = await fetch(`${baseUrl}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalLogs = await finalLogsRes.json() as any[];
    
    const requiredActions = [
      'CREATE_USER',
      'UPDATE_USER',
      'RESET_PASSWORD',
      'UPDATE_PROFILE',
      'DELETE_USER',
    ];

    for (const action of requiredActions) {
      const match = finalLogs.find(l => l.action === action);
      if (match) {
        console.log(`   [PASS] Found audit log for action: ${action}`);
      } else {
        throw new Error(`[FAIL] Audit log not found for action: ${action}`);
      }
    }

    console.log('\n--- ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ---');
  } catch (error: any) {
    console.error('\n--- INTEGRATION TESTS FAILED ---');
    console.error(error.message);
    
    // Attempt cleanup if created user is left over
    try {
      const user = await prisma.user.findUnique({ where: { email: 'temp.admin@met.edu' } });
      if (user) {
        await prisma.user.delete({ where: { id: user.id } });
        console.log('Cleaned up leftover user.');
      }
    } catch {}
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
