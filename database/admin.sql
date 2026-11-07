USE autocare_db;

UPDATE users
SET role = 'admin'
WHERE email = 'pooja@gmail.com';

SELECT id, name, email, role
FROM users
WHERE email = 'pooja@gmail.com';