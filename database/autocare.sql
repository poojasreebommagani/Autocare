CREATE DATABASE IF NOT EXISTS autocare_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE autocare_db;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(30),
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','staff','mechanic','admin') NOT NULL DEFAULT 'customer',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  registration_number VARCHAR(30) NOT NULL UNIQUE,
  make VARCHAR(80) NOT NULL,
  model VARCHAR(80) NOT NULL,
  manufacture_year SMALLINT,
  fuel_type ENUM('petrol','diesel','electric','hybrid','cng','other') DEFAULT 'other',
  odometer_km INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vehicle_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS service_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500),
  base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_minutes INT NOT NULL DEFAULT 60,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  service_type_id INT NOT NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  issue_description TEXT,
  status ENUM('Pending','Confirmed','Inspection','Awaiting Approval','In Progress','Quality Check','Completed','Invoiced','Closed','Cancelled') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_booking_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_booking_service FOREIGN KEY (service_type_id) REFERENCES service_types(id)
);

CREATE TABLE IF NOT EXISTS inspections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  staff_id INT NOT NULL,
  notes TEXT NOT NULL,
  findings TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inspection_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_inspection_staff FOREIGN KEY (staff_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mechanics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  specialization VARCHAR(120),
  available TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_mechanic_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mechanic_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  mechanic_id INT NOT NULL,
  assigned_by INT NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_mechanic (booking_id, mechanic_id),
  CONSTRAINT fk_assignment_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_mechanic FOREIGN KEY (mechanic_id) REFERENCES mechanics(id),
  CONSTRAINT fk_assignment_staff FOREIGN KEY (assigned_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS estimates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE,
  labor_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  service_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_estimate_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_estimate_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS spare_parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  part_name VARCHAR(120) NOT NULL,
  sku VARCHAR(60) NOT NULL UNIQUE,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock_quantity INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 5,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  part_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_part (booking_id, part_id),
  CONSTRAINT fk_booking_part_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_part_part FOREIGN KEY (part_id) REFERENCES spare_parts(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE,
  labor_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  service_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('Unpaid','Partially Paid','Paid') NOT NULL DEFAULT 'Unpaid',
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoice_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('Cash','Card','UPI','Bank Transfer','Test Gateway') NOT NULL DEFAULT 'Cash',
  reference_number VARCHAR(120),
  received_by INT NOT NULL,
  paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_receiver FOREIGN KEY (received_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL,
  comments VARCHAR(1000),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_feedback_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_feedback_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT IGNORE INTO service_types (name, description, base_price, duration_minutes) VALUES
('General Service', 'Routine vehicle inspection and maintenance', 1500, 120),
('Oil Change', 'Engine oil and oil filter replacement', 900, 45),
('Brake Service', 'Brake inspection and maintenance', 1800, 90),
('Engine Diagnostics', 'Computer-assisted engine diagnosis', 1200, 60),
('AC Service', 'Air conditioning inspection and servicing', 1600, 90),
('Tyre Service', 'Tyre inspection, rotation, and balancing', 1000, 60),
('Battery Check', 'Battery health and charging-system check', 500, 30);

-- Additional AutoCare services. INSERT IGNORE avoids duplicate service names.
INSERT IGNORE INTO service_types (name, description, base_price, duration_minutes) VALUES
('Exterior Foam Wash', 'Exterior foam wash and dirt removal', 400, 45),
('Interior Deep Cleaning', 'Deep cleaning of seats, carpets and dashboard', 2500, 180),
('Full Car Detailing', 'Complete interior and exterior detailing', 4500, 240),
('Paint Correction', 'Paint polishing to reduce minor swirl marks', 3500, 180),
('Ceramic Coating', 'Paint protection with ceramic coating', 12000, 360),
('Paint Protection Film (PPF)', 'Paint protection film installation', 25000, 480),
('Headlight Restoration', 'Cleaning and polishing cloudy headlights', 1200, 60),
('AC Inspection and Service', 'Air conditioning inspection and servicing', 1800, 90),
('Wheel Alignment', 'Wheel alignment and steering inspection', 800, 45),
('Wheel Balancing', 'Wheel balancing to reduce vibration', 600, 45),
('Battery Inspection', 'Battery health and charging system check', 500, 30),
('Engine Bay Cleaning', 'Cleaning and detailing of the engine bay', 1000, 60);



-- Extra workshop services included in the enhanced version.

-- Extra workshop services (safe to run more than once).
INSERT IGNORE INTO service_types (name, description, base_price, duration_minutes, active) VALUES
('Engine Oil and Filter Change', 'Engine oil replacement with oil filter change', 1200, 50, 1),
('Brake Pad Replacement', 'Brake pad replacement and braking performance check', 2800, 90, 1),
('Coolant Flush', 'Cooling system flush and fresh coolant refill', 1600, 75, 1),
('Transmission Fluid Change', 'Transmission fluid inspection and replacement', 3200, 120, 1),
('Suspension Inspection', 'Suspension, shock absorber and steering inspection', 900, 60, 1),
('Tyre Replacement', 'Tyre fitting, pressure check and balancing', 700, 45, 1),
('Wiper Blade Replacement', 'Replacement of worn front or rear wiper blades', 450, 20, 1),
('Dent Removal', 'Minor dent repair assessment and paintless dent removal', 2500, 120, 1),
('Windshield Glass Treatment', 'Glass cleaning and water-repellent treatment', 900, 45, 1),
('Hybrid and EV Diagnostics', 'Basic hybrid/electric vehicle system diagnostics', 2200, 90, 1),
('Pickup and Drop-off', 'Local vehicle pickup and delivery coordination', 600, 60, 1),
('Pre-purchase Vehicle Inspection', 'Multi-point condition inspection before buying a vehicle', 1800, 90, 1);
