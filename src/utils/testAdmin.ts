
async function testAdmin() {
  console.log('Testing Admin Master Endpoints...');
  const baseUrl = 'http://localhost:5000/api';
  
  try {
    // 1. Log in as Superadmin
    console.log('Logging in as superadmin...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'superadmin@met.edu',
        password: 'admin123'
      })
    });
    
    if (!loginRes.ok) {
      throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
    }
    
    const loginData = await loginRes.json() as any;
    const token = loginData.token;
    console.log('Login successful. Token obtained:', token.substring(0, 20) + '...');
    
    // 2. Fetch institutes config
    console.log('Fetching admin institutes...');
    const instRes = await fetch(`${baseUrl}/admin/institutes`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!instRes.ok) {
      throw new Error(`Fetch institutes failed with status ${instRes.status}: ${await instRes.text()}`);
    }
    const insts = await instRes.json() as any[];
    console.log('Institutes fetched successfully. Count:', insts.length);
    console.log('Sample institute:', insts[0]);

    // 3. Fetch programmes
    console.log('Fetching admin programmes...');
    const progRes = await fetch(`${baseUrl}/admin/programmes`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!progRes.ok) {
      throw new Error(`Fetch programmes failed with status ${progRes.status}: ${await progRes.text()}`);
    }
    const progs = await progRes.json() as any[];
    console.log('Programmes fetched successfully. Count:', progs.length);

    // 4. Fetch services
    console.log('Fetching admin services...');
    const srvRes = await fetch(`${baseUrl}/admin/services`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!srvRes.ok) {
      throw new Error(`Fetch services failed with status ${srvRes.status}: ${await srvRes.text()}`);
    }
    const srvs = await srvRes.json() as any[];
    console.log('Services fetched successfully. Count:', srvs.length);

    console.log('\n[SUCCESS] All configuration endpoints responded successfully!');
  } catch (error: any) {
    console.error('\n[FAIL] Test admin call failed.');
    console.error(error.message);
  }
}

testAdmin();
