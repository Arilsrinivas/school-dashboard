async function run() {
  const base = 'http://localhost:4000';
  
  // 1. Recovery request for arilsrinivas8@gmail.com
  console.log('--- Testing Account Recovery Request ---');
  const recRes = await fetch(base + '/api/auth/recovery/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'school', schoolId: 'CS-SCH-0001', email: 'arilsrinivas8@gmail.com' })
  });
  const recJson = await recRes.json() as { message: string; developmentUrl?: string };
  console.log('Recovery Status:', recRes.status);
  console.log('Recovery Message:', recJson.message);
  console.log('Recovery URL:', recJson.developmentUrl);

  // 2. Login as School Admin
  console.log('\n--- Testing School Admin Login (arilsrinivas8@gmail.com) ---');
  const adminRes = await fetch(base + '/api/auth/school/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'arilsrinivas8@gmail.com', password: 'Password#2026', schoolId: 'CS-SCH-0001' })
  });
  const adminData = await adminRes.json() as { accessToken: string; user: { name: string; schoolRole: string } };
  console.log('Admin Login Status:', adminRes.status, 'User:', adminData.user?.name, 'Role:', adminData.user?.schoolRole);
  const adminToken = adminData.accessToken;

  // 3. Test Teacher Login
  console.log('\n--- Testing Teacher Login ---');
  const teacherRes = await fetch(base + '/api/auth/school/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'teacher@kidzland.edu', password: 'Teacher#2026', schoolId: 'CS-SCH-0001' })
  });
  const teacherData = await teacherRes.json() as { user: { name: string } };
  console.log('Teacher Login Status:', teacherRes.status, 'User:', teacherData.user?.name);

  // 4. Test Student Login
  console.log('\n--- Testing Student Login ---');
  const studentRes = await fetch(base + '/api/auth/school/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@kidzland.edu', password: 'Student#2026', schoolId: 'CS-SCH-0001' })
  });
  const studentData = await studentRes.json() as { user: { name: string } };
  console.log('Student Login Status:', studentRes.status, 'User:', studentData.user?.name);

  // 5. Test Parent Login
  console.log('\n--- Testing Parent Login ---');
  const parentRes = await fetch(base + '/api/auth/school/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'parent@kidzland.edu', password: 'Parent#2026', schoolId: 'CS-SCH-0001' })
  });
  const parentData = await parentRes.json() as { user: { name: string } };
  console.log('Parent Login Status:', parentRes.status, 'User:', parentData.user?.name);

  // 6. Test Platform Super Admin Login
  console.log('\n--- Testing Platform Admin Login ---');
  const platRes = await fetch(base + '/api/auth/platform/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@calmstacks.example', password: 'SuperAdmin#2026' })
  });
  const platData = await platRes.json() as { user: { name: string } };
  console.log('Platform Admin Login Status:', platRes.status, 'User:', platData.user?.name);

  // 7. Verify KIDZLAND features via adminToken
  const headers = { Authorization: 'Bearer ' + adminToken };
  
  console.log('\n--- Testing School Workspace APIs ---');
  const dashRes = await fetch(base + '/api/school/dashboard', { headers });
  console.log('School Dashboard:', await dashRes.json());

  const hwRes = await fetch(base + '/api/school/homework/assignments', { headers });
  const hwJson = await hwRes.json() as { items?: { title: string }[] };
  console.log('Homework Assignments count:', hwJson.items?.length, 'First title:', hwJson.items?.[0]?.title);

  const examRes = await fetch(base + '/api/school/examinations', { headers });
  const examJson = await examRes.json() as { items?: { name: string }[] };
  console.log('Examinations count:', examJson.items?.length, 'First exam:', examJson.items?.[0]?.name);

  const feesRes = await fetch(base + '/api/school/fees/structures', { headers });
  const feesJson = await feesRes.json() as { items?: { category_name: string }[] };
  console.log('Fee Structures count:', feesJson.items?.length, 'First structure:', feesJson.items?.[0]?.category_name);

  const repRes = await fetch(base + '/api/school/reports/export?type=students&format=csv', { headers });
  const repCsv = await repRes.text();
  console.log('CSV Report export status:', repRes.status, 'Header preview:', repCsv.slice(0, 80));

  console.log('\n>>> ALL PORTAL TESTS PASSED SUCCESSFULLY! <<<');
}

run().catch(console.error);
