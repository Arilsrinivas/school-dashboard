import { platformPool } from '../apps/api/src/db/pool.js';

async function clean() {
  console.log('Purging demo school and demo accounts...');
  
  // 0. Remove subscriptions and support requests for target schools first
  await platformPool.query(
    "DELETE FROM subscriptions WHERE school_id IN (SELECT id FROM schools WHERE school_id = 'CS-SCH-0001' OR contact_email LIKE '%kidzland.edu%' OR contact_email = 'arilsrinivas8@gmail.com')"
  );
  await platformPool.query(
    "DELETE FROM support_access_requests WHERE school_id IN (SELECT id FROM schools WHERE school_id = 'CS-SCH-0001' OR contact_email LIKE '%kidzland.edu%' OR contact_email = 'arilsrinivas8@gmail.com')"
  );

  // 1. Delete all demo schools (cascades to all memberships, classes, students, teachers, marks, fees, etc.)
  const deletedSchools = await platformPool.query(
    "DELETE FROM schools WHERE school_id = 'CS-SCH-0001' OR contact_email LIKE '%kidzland.edu%' OR contact_email = 'arilsrinivas8@gmail.com' RETURNING id, school_id, name"
  );
  console.log(`Deleted ${deletedSchools.rowCount} demo school(s):`, deletedSchools.rows);

  // 2. Delete all demo users
  const deletedUsers = await platformPool.query(
    "DELETE FROM users WHERE email LIKE '%kidzland.edu%' OR email = 'arilsrinivas8@gmail.com' RETURNING id, email, name"
  );
  console.log(`Deleted ${deletedUsers.rowCount} demo user(s):`, deletedUsers.rows);

  // 3. Clean any orphaned support requests
  await platformPool.query("DELETE FROM support_access_requests WHERE school_id NOT IN (SELECT id FROM schools)");

  console.log('✓ All demo data purged from database successfully.');
  process.exit(0);
}

clean().catch(err => {
  console.error('Failed to clean demo data:', err);
  process.exit(1);
});
