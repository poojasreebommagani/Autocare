require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "autocare_db",
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

const asyncHandler = fn =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const safeUser = u => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role
});

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET || "development_only_change_me",
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

const auth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Please log in first." });
  }

  try {
    req.user = jwt.verify(
      token,
      process.env.JWT_SECRET || "development_only_change_me"
    );
    next();
  } catch {
    return res.status(401).json({
      error: "Session expired or invalid. Please log in again."
    });
  }
});

const allow = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      error: "You do not have permission to perform this action."
    });
  }
  next();
};

const positiveInt = n =>
  Number.isInteger(Number(n)) && Number(n) > 0;

const money = n =>
  Number.isFinite(Number(n)) && Number(n) >= 0;

app.get("/api/health", (req, res) =>
  res.json({ status: "ok", app: "AutoCare" })
);

app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const { name, email, phone = "", password } = req.body;

  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({
      error: "Name, email, and a password of at least 8 characters are required."
    });
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    const [result] = await pool.execute(
      "INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?, 'customer')",
      [name.trim(), email.trim().toLowerCase(), phone.trim(), hash]
    );

    const user = {
      id: result.insertId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone,
      role: "customer"
    };

    res.status(201).json({ user, token: tokenFor(user) });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "An account with this email already exists."
      });
    }
    throw e;
  }
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required."
    });
  }

  const [rows] = await pool.execute(
    "SELECT * FROM users WHERE email=? AND active=1",
    [email.trim().toLowerCase()]
  );

  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const user = safeUser(rows[0]);
  res.json({ user, token: tokenFor(user) });
}));

app.get("/api/me", auth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id,name,email,phone,role FROM users WHERE id=? AND active=1",
    [req.user.id]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "User not found." });
  }

  res.json({ user: rows[0] });
}));

app.get("/api/service-types", auth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT * FROM service_types WHERE active=1 ORDER BY name"
  );
  res.json(rows);
}));

app.get("/api/vehicles", auth, asyncHandler(async (req, res) => {
  const isStaff = ["staff", "mechanic", "admin"].includes(req.user.role);

  const sql = `
    SELECT v.*, u.name AS owner_name
    FROM vehicles v
    JOIN users u ON u.id=v.user_id
    ${isStaff ? "" : "WHERE v.user_id=?"}
    ORDER BY v.created_at DESC
  `;

  const [rows] = isStaff
    ? await pool.execute(sql)
    : await pool.execute(sql, [req.user.id]);

  res.json(rows);
}));

app.post("/api/vehicles", auth, allow("customer", "admin"), asyncHandler(async (req, res) => {
  const {
    registration_number,
    make,
    model,
    manufacture_year = null,
    fuel_type = "other",
    odometer_km = 0
  } = req.body;

  if (!registration_number?.trim() || !make?.trim() || !model?.trim()) {
    return res.status(400).json({
      error: "Registration number, make, and model are required."
    });
  }

  if (!positiveInt(odometer_km) && Number(odometer_km) !== 0) {
    return res.status(400).json({
      error: "Odometer must be zero or greater."
    });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO vehicles
       (user_id,registration_number,make,model,manufacture_year,fuel_type,odometer_km)
       VALUES (?,?,?,?,?,?,?)`,
      [
        req.user.id,
        registration_number.trim().toUpperCase(),
        make.trim(),
        model.trim(),
        manufacture_year || null,
        fuel_type,
        Number(odometer_km)
      ]
    );

    res.status(201).json({
      id: result.insertId,
      message: "Vehicle added successfully."
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "That registration number is already registered."
      });
    }
    throw e;
  }
}));

app.get("/api/bookings", auth, asyncHandler(async (req, res) => {
  const staffView = ["staff", "mechanic", "admin"].includes(req.user.role);

  let sql = `
    SELECT
      b.*,
      u.name AS customer_name,
      u.email AS customer_email,
      v.registration_number,
      v.make,
      v.model,
      st.name AS service_name,
      e.id AS estimate_id,
      e.labor_cost,
      e.parts_cost,
      e.service_cost,
      e.notes AS estimate_notes,
      e.status AS estimate_status,
      i.id AS invoice_id,
      i.total_amount,
      i.status AS invoice_status
    FROM bookings b
    JOIN users u ON u.id=b.user_id
    JOIN vehicles v ON v.id=b.vehicle_id
    JOIN service_types st ON st.id=b.service_type_id
    LEFT JOIN estimates e ON e.booking_id=b.id
    LEFT JOIN invoices i ON i.booking_id=b.id
  `;

  const params = [];

  if (!staffView) {
    sql += " WHERE b.user_id=?";
    params.push(req.user.id);
  }

  if (req.user.role === "mechanic") {
    sql += staffView
      ? " AND EXISTS (SELECT 1 FROM mechanic_assignments ma JOIN mechanics m ON m.id=ma.mechanic_id WHERE ma.booking_id=b.id AND m.user_id=?)"
      : "";
    params.push(req.user.id);
  }

  sql += " ORDER BY b.created_at DESC";

  const [rows] = await pool.execute(sql, params);
  res.json(rows);
}));

app.post("/api/bookings", auth, allow("customer", "admin"), asyncHandler(async (req, res) => {
  const {
    vehicle_id,
    service_type_id,
    booking_date,
    booking_time,
    issue_description = ""
  } = req.body;

  if (!positiveInt(vehicle_id) || !positiveInt(service_type_id) ||
      !booking_date || !booking_time) {
    return res.status(400).json({
      error: "Vehicle, service, date, and time are required."
    });
  }

  const [vehicles] = await pool.execute(
    "SELECT id FROM vehicles WHERE id=? AND user_id=?",
    [vehicle_id, req.user.id]
  );

  if (!vehicles.length && req.user.role !== "admin") {
    return res.status(403).json({
      error: "You can book service only for your own vehicle."
    });
  }

  const [services] = await pool.execute(
    "SELECT id FROM service_types WHERE id=? AND active=1",
    [service_type_id]
  );

  if (!services.length) {
    return res.status(400).json({ error: "Please select a valid service." });
  }

  const [result] = await pool.execute(
    `INSERT INTO bookings
     (user_id,vehicle_id,service_type_id,booking_date,booking_time,issue_description)
     VALUES (?,?,?,?,?,?)`,
    [
      req.user.id,
      vehicle_id,
      service_type_id,
      booking_date,
      booking_time,
      issue_description.trim()
    ]
  );

  res.status(201).json({
    id: result.insertId,
    message: "Service booking created."
  });
}));

const bookingStatuses = [
  "Pending", "Confirmed", "Inspection", "Awaiting Approval",
  "In Progress", "Quality Check", "Completed", "Invoiced",
  "Closed", "Cancelled"
];

app.patch("/api/bookings/:id/status", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!bookingStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid booking status." });
  }

  const [result] = await pool.execute(
    "UPDATE bookings SET status=? WHERE id=?",
    [status, req.params.id]
  );

  if (!result.affectedRows) {
    return res.status(404).json({ error: "Booking not found." });
  }

  res.json({ message: "Booking status updated." });
}));

app.post("/api/inspections", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const { booking_id, notes, findings = "" } = req.body;

  if (!positiveInt(booking_id) || !notes?.trim()) {
    return res.status(400).json({
      error: "Booking and inspection notes are required."
    });
  }

  const [result] = await pool.execute(
    "INSERT INTO inspections (booking_id,staff_id,notes,findings) VALUES (?,?,?,?)",
    [booking_id, req.user.id, notes.trim(), findings.trim()]
  );

  await pool.execute(
    "UPDATE bookings SET status='Inspection' WHERE id=? AND status IN ('Pending','Confirmed')",
    [booking_id]
  );

  res.status(201).json({ id: result.insertId, message: "Inspection saved." });
}));

app.get("/api/inspections/:bookingId", auth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT i.*,u.name AS staff_name
     FROM inspections i
     JOIN users u ON u.id=i.staff_id
     WHERE i.booking_id=?
     ORDER BY i.created_at DESC`,
    [req.params.bookingId]
  );

  res.json(rows);
}));
app.get("/api/mechanics", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT m.id,m.user_id,m.specialization,m.available,u.name,u.email
     FROM mechanics m
     JOIN users u ON u.id=m.user_id
     ORDER BY u.name`
  );

  res.json(rows);
}));

app.post("/api/mechanics", auth, allow("admin"), asyncHandler(async (req, res) => {
  const { user_id, specialization = "" } = req.body;

  if (!positiveInt(user_id)) {
    return res.status(400).json({ error: "Select a valid user." });
  }

  const [users] = await pool.execute(
    "SELECT id,role FROM users WHERE id=?",
    [user_id]
  );

  if (!users.length) {
    return res.status(404).json({ error: "User not found." });
  }

  await pool.execute(
    "UPDATE users SET role='mechanic' WHERE id=?",
    [user_id]
  );

  const [result] = await pool.execute(
    "INSERT INTO mechanics (user_id,specialization) VALUES (?,?)",
    [user_id, specialization.trim()]
  );

  res.status(201).json({
    id: result.insertId,
    message: "Mechanic profile created."
  });
}));

app.post("/api/assignments", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const { booking_id, mechanic_id } = req.body;

  if (!positiveInt(booking_id) || !positiveInt(mechanic_id)) {
    return res.status(400).json({
      error: "Select a valid booking and mechanic."
    });
  }

  try {
    await pool.execute(
      "INSERT INTO mechanic_assignments (booking_id,mechanic_id,assigned_by) VALUES (?,?,?)",
      [booking_id, mechanic_id, req.user.id]
    );

    await pool.execute(
      "UPDATE bookings SET status='Confirmed' WHERE id=? AND status='Pending'",
      [booking_id]
    );

    res.status(201).json({ message: "Mechanic assigned." });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "This mechanic is already assigned to this booking."
      });
    }
    throw e;
  }
}));

// UPDATED: Estimate route now saves the service charge.
app.post("/api/estimates", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const {
    booking_id,
    labor_cost = 0,
    parts_cost = 0,
    service_cost = 0,
    notes = ""
  } = req.body;

  if (
    !positiveInt(booking_id) ||
    !money(labor_cost) ||
    !money(parts_cost) ||
    !money(service_cost)
  ) {
    return res.status(400).json({
      error: "Enter a valid booking and non-negative costs."
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO estimates
       (booking_id,labor_cost,parts_cost,service_cost,notes,status,created_by)
       VALUES (?,?,?,?,?, 'Pending',?)
       ON DUPLICATE KEY UPDATE
         labor_cost=VALUES(labor_cost),
         parts_cost=VALUES(parts_cost),
         service_cost=VALUES(service_cost),
         notes=VALUES(notes),
         status='Pending',
         created_by=VALUES(created_by)`,
      [
        booking_id,
        Number(labor_cost),
        Number(parts_cost),
        Number(service_cost),
        notes.trim(),
        req.user.id
      ]
    );

    await conn.execute(
      "UPDATE bookings SET status='Awaiting Approval' WHERE id=?",
      [booking_id]
    );

    await conn.commit();

    res.status(201).json({
      id: result.insertId || null,
      labor_cost: Number(labor_cost),
      parts_cost: Number(parts_cost),
      service_cost: Number(service_cost),
      message: "Estimate saved and awaiting customer approval."
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

app.patch("/api/estimates/:id/decision", auth, asyncHandler(async (req, res) => {
  const { decision } = req.body;

  if (!["Approved", "Rejected"].includes(decision)) {
    return res.status(400).json({
      error: "Decision must be Approved or Rejected."
    });
  }

  const [rows] = await pool.execute(
    `SELECT e.id,e.booking_id,b.user_id
     FROM estimates e
     JOIN bookings b ON b.id=e.booking_id
     WHERE e.id=?`,
    [req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Estimate not found." });
  }

  const est = rows[0];

  if (
    req.user.role === "customer" &&
    Number(est.user_id) !== Number(req.user.id)
  ) {
    return res.status(403).json({
      error: "This estimate does not belong to you."
    });
  }

  if (!["customer", "staff", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Not permitted." });
  }

  if (req.user.role === "staff" && decision === "Approved") {
    return res.status(403).json({
      error: "Only the customer or admin may approve an estimate."
    });
  }

  await pool.execute(
    "UPDATE estimates SET status=? WHERE id=?",
    [decision, req.params.id]
  );

  await pool.execute(
    "UPDATE bookings SET status=? WHERE id=?",
    [
      decision === "Approved" ? "Confirmed" : "Cancelled",
      est.booking_id
    ]
  );

  res.json({ message: `Estimate ${decision.toLowerCase()}.` });
}));

app.get("/api/inventory", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT * FROM spare_parts ORDER BY part_name"
  );

  res.json(rows);
}));

app.post("/api/inventory", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const {
    part_name,
    sku,
    unit_price,
    stock_quantity,
    reorder_level = 5
  } = req.body;

  if (
    !part_name?.trim() ||
    !sku?.trim() ||
    !money(unit_price) ||
    !Number.isInteger(Number(stock_quantity)) ||
    Number(stock_quantity) < 0
  ) {
    return res.status(400).json({
      error: "Enter part name, SKU, valid price, and non-negative stock."
    });
  }

  try {
    const [r] = await pool.execute(
      `INSERT INTO spare_parts
       (part_name,sku,unit_price,stock_quantity,reorder_level)
       VALUES (?,?,?,?,?)`,
      [
        part_name.trim(),
        sku.trim(),
        Number(unit_price),
        Number(stock_quantity),
        Number(reorder_level)
      ]
    );

    res.status(201).json({
      id: r.insertId,
      message: "Spare part added."
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "SKU already exists." });
    }
    throw e;
  }
}));

app.patch("/api/inventory/:id", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const {
    part_name,
    unit_price,
    stock_quantity,
    reorder_level
  } = req.body;

  if (unit_price !== undefined && !money(unit_price)) {
    return res.status(400).json({ error: "Invalid price." });
  }

  if (
    stock_quantity !== undefined &&
    (!Number.isInteger(Number(stock_quantity)) || Number(stock_quantity) < 0)
  ) {
    return res.status(400).json({
      error: "Stock must be zero or greater."
    });
  }

  const [r] = await pool.execute(
    `UPDATE spare_parts
     SET part_name=COALESCE(?,part_name),
         unit_price=COALESCE(?,unit_price),
         stock_quantity=COALESCE(?,stock_quantity),
         reorder_level=COALESCE(?,reorder_level)
     WHERE id=?`,
    [
      part_name ?? null,
      unit_price ?? null,
      stock_quantity ?? null,
      reorder_level ?? null,
      req.params.id
    ]
  );

  if (!r.affectedRows) {
    return res.status(404).json({ error: "Part not found." });
  }

  res.json({ message: "Inventory updated." });
}));
// UPDATED: Invoice total includes labor, parts, and service charge.
app.post("/api/invoices", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const { booking_id, tax_rate = 0.18 } = req.body;

  if (
    !positiveInt(booking_id) ||
    !Number.isFinite(Number(tax_rate)) ||
    Number(tax_rate) < 0 ||
    Number(tax_rate) > 1
  ) {
    return res.status(400).json({
      error: "Provide a valid booking and tax rate between 0 and 1."
    });
  }

  const [ests] = await pool.execute(
    "SELECT * FROM estimates WHERE booking_id=? AND status='Approved'",
    [booking_id]
  );

  if (!ests.length) {
    return res.status(400).json({
      error: "An approved estimate is required before invoicing."
    });
  }

  const e = ests[0];

  const labor = Number(e.labor_cost || 0);
  const parts = Number(e.parts_cost || 0);
  const service = Number(e.service_cost || 0);

  // Subtotal includes all three charges.
  const subtotal = Math.round((labor + parts + service) * 100) / 100;

  // Tax is calculated on the complete subtotal.
  const tax = Math.round(subtotal * Number(tax_rate) * 100) / 100;

  // Final invoice total.
  const total = Math.round((subtotal + tax) * 100) / 100;

  const [r] = await pool.execute(
    `INSERT INTO invoices
     (booking_id,labor_cost,parts_cost,service_cost,tax_amount,total_amount,status)
     VALUES (?,?,?,?,?,?, 'Unpaid')
     ON DUPLICATE KEY UPDATE
       labor_cost=VALUES(labor_cost),
       parts_cost=VALUES(parts_cost),
       service_cost=VALUES(service_cost),
       tax_amount=VALUES(tax_amount),
       total_amount=VALUES(total_amount)`,
    [booking_id, labor, parts, service, tax, total]
  );

  await pool.execute(
    "UPDATE bookings SET status='Invoiced' WHERE id=?",
    [booking_id]
  );

  res.status(201).json({
    id: r.insertId || null,
    labor_cost: labor,
    parts_cost: parts,
    service_cost: service,
    subtotal,
    tax_amount: tax,
    total_amount: total,
    message: "Invoice created."
  });
}));

app.get("/api/invoices", auth, asyncHandler(async (req, res) => {
  const staffView = ["staff", "admin"].includes(req.user.role);

  const sql = `
    SELECT
      i.*,
      b.user_id,
      b.id AS booking_number,
      u.name AS customer_name,
      v.registration_number
    FROM invoices i
    JOIN bookings b ON b.id=i.booking_id
    JOIN users u ON u.id=b.user_id
    JOIN vehicles v ON v.id=b.vehicle_id
    ${staffView ? "" : "WHERE b.user_id=?"}
    ORDER BY i.issued_at DESC
  `;

  const [rows] = staffView
    ? await pool.execute(sql)
    : await pool.execute(sql, [req.user.id]);

  res.json(rows);
}));

app.post("/api/payments", auth, allow("staff", "admin"), asyncHandler(async (req, res) => {
  const {
    invoice_id,
    amount,
    method = "Cash",
    reference_number = ""
  } = req.body;

  if (
    !positiveInt(invoice_id) ||
    !Number.isFinite(Number(amount)) ||
    Number(amount) <= 0
  ) {
    return res.status(400).json({
      error: "Invoice and a positive payment amount are required."
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [inv] = await conn.execute(
      "SELECT * FROM invoices WHERE id=? FOR UPDATE",
      [invoice_id]
    );

    if (!inv.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Invoice not found." });
    }

    const [paidRows] = await conn.execute(
      "SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id=?",
      [invoice_id]
    );

    const paid = Number(paidRows[0].paid);
    const total = Number(inv[0].total_amount);
    const payment = Number(amount);

    if (payment + paid > total + 0.001) {
      await conn.rollback();
      return res.status(400).json({
        error: "Payment exceeds the remaining invoice balance."
      });
    }

    await conn.execute(
      `INSERT INTO payments
       (invoice_id,amount,method,reference_number,received_by)
       VALUES (?,?,?,?,?)`,
      [
        invoice_id,
        payment,
        method,
        reference_number.trim(),
        req.user.id
      ]
    );

    const newPaid = paid + payment;
    const status = newPaid >= total - 0.001 ? "Paid" : "Partially Paid";

    await conn.execute(
      "UPDATE invoices SET status=? WHERE id=?",
      [status, invoice_id]
    );

    if (status === "Paid") {
      await conn.execute(
        "UPDATE bookings SET status='Closed' WHERE id=?",
        [inv[0].booking_id]
      );
    }

    await conn.commit();

    res.status(201).json({
      message: "Payment recorded.",
      invoice_status: status,
      remaining_balance: Math.max(0, total - newPaid)
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

app.get("/api/payments/:invoiceId", auth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.*
     FROM payments p
     JOIN invoices i ON i.id=p.invoice_id
     JOIN bookings b ON b.id=i.booking_id
     WHERE p.invoice_id=?
     ${req.user.role === "customer" ? "AND b.user_id=?" : ""}
     ORDER BY p.paid_at DESC`,
    req.user.role === "customer"
      ? [req.params.invoiceId, req.user.id]
      : [req.params.invoiceId]
  );

  res.json(rows);
}));

app.post("/api/feedback", auth, allow("customer"), asyncHandler(async (req, res) => {
  const { booking_id, rating, comments = "" } = req.body;

  if (
    !positiveInt(booking_id) ||
    !Number.isInteger(Number(rating)) ||
    Number(rating) < 1 ||
    Number(rating) > 5
  ) {
    return res.status(400).json({
      error: "Choose a booking and rating from 1 to 5."
    });
  }

  const [b] = await pool.execute(
    "SELECT id,status FROM bookings WHERE id=? AND user_id=?",
    [booking_id, req.user.id]
  );

  if (!b.length) {
    return res.status(404).json({ error: "Booking not found." });
  }

  if (!["Completed", "Invoiced", "Closed"].includes(b[0].status)) {
    return res.status(400).json({
      error: "Feedback is available after service completion."
    });
  }

  try {
    const [r] = await pool.execute(
      "INSERT INTO feedback (booking_id,user_id,rating,comments) VALUES (?,?,?,?)",
      [booking_id, req.user.id, Number(rating), comments.trim()]
    );

    res.status(201).json({
      id: r.insertId,
      message: "Thank you for your feedback."
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "Feedback has already been submitted for this booking."
      });
    }
    throw e;
  }
}));

app.get("/api/admin/feedback", auth, allow("admin"), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT
       f.id,
       f.booking_id,
       f.rating,
       f.comments,
       f.created_at,
       u.name AS customer_name,
       u.email AS customer_email,
       st.name AS service_name
     FROM feedback f
     JOIN users u ON u.id=f.user_id
     JOIN bookings b ON b.id=f.booking_id
     JOIN service_types st ON st.id=b.service_type_id
     ORDER BY f.created_at DESC`
  );

  res.json(rows);
}));

app.get("/api/admin/summary", auth, allow("admin", "staff"), asyncHandler(async (req, res) => {
  const [[users]] = await pool.query(
    "SELECT COUNT(*) AS total_users FROM users"
  );
  const [[vehicles]] = await pool.query(
    "SELECT COUNT(*) AS total_vehicles FROM vehicles"
  );
  const [[bookings]] = await pool.query(
    "SELECT COUNT(*) AS total_bookings FROM bookings"
  );
  const [[open]] = await pool.query(
    "SELECT COUNT(*) AS open_bookings FROM bookings WHERE status NOT IN ('Closed','Cancelled')"
  );
  const [[revenue]] = await pool.query(
    "SELECT COALESCE(SUM(amount),0) AS received_revenue FROM payments"
  );
  const [[low]] = await pool.query(
    "SELECT COUNT(*) AS low_stock_parts FROM spare_parts WHERE stock_quantity <= reorder_level"
  );

  res.json({ ...users, ...vehicles, ...bookings, ...open, ...revenue, ...low });
}));

app.get("/api/admin/users", auth, allow("admin"), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id,name,email,phone,role,active,created_at FROM users ORDER BY created_at DESC"
  );

  res.json(rows);
}));

app.patch("/api/admin/users/:id/role", auth, allow("admin"), asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!["customer", "staff", "mechanic", "admin"].includes(role)) {
    return res.status(400).json({ error: "Invalid role." });
  }

  if (
    Number(req.params.id) === Number(req.user.id) &&
    role !== "admin"
  ) {
    return res.status(400).json({
      error: "You cannot remove your own admin role."
    });
  }

  const [r] = await pool.execute(
    "UPDATE users SET role=? WHERE id=?",
    [role, req.params.id]
  );

  if (!r.affectedRows) {
    return res.status(404).json({ error: "User not found." });
  }

  if (role === "mechanic") {
    await pool.execute(
      "INSERT IGNORE INTO mechanics (user_id,specialization) VALUES (?, '')",
      [req.params.id]
    );
  }

  res.json({ message: "User role updated." });
}));

app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: "Unexpected server error. Check the server terminal for details."
  });
});

// Export the Express app for Vercel serverless deployment.
// Keep app.listen for local development only.
if (require.main === module) {
  const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`AutoCare running on port ${PORT}`);
});
  

}

module.exports = app;