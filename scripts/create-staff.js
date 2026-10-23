// Usage: node scripts/create-staff.js "Full Name" email@example.com role  (prompts via env PASSWORD)
// Roles: super_admin, treasurer, secretary, branch_officer, viewer
require('dotenv').config();
const { Pool } = require('pg'), bcrypt = require('bcryptjs');
const [name, email, role] = process.argv.slice(2), pw = process.env.PASSWORD;
if (!name || !email || !role || !pw || pw.length < 10) { console.error('Usage: PASSWORD=<10+ chars> node scripts/create-staff.js "Name" email role'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('INSERT INTO staff_users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4)', [name, email, bcrypt.hashSync(pw, 12), role])
  .then(() => { console.log('Staff user created'); return pool.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
