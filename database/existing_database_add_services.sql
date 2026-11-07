USE autocare_db;

-- Adds service options to an existing AutoCare database without duplicating names.
INSERT IGNORE INTO service_types (name, description, base_price, duration_minutes, active) VALUES
('Exterior Foam Wash', 'Exterior foam wash and dirt removal', 400, 45, 1),
('Interior Deep Cleaning', 'Deep cleaning of seats, carpets and dashboard', 2500, 180, 1),
('Full Car Detailing', 'Complete interior and exterior detailing', 4500, 240, 1),
('Paint Correction', 'Paint polishing to reduce minor swirl marks', 3500, 180, 1),
('Ceramic Coating', 'Paint protection with ceramic coating', 12000, 360, 1),
('Paint Protection Film (PPF)', 'Paint protection film installation', 25000, 480, 1),
('Headlight Restoration', 'Cleaning and polishing cloudy headlights', 1200, 60, 1),
('AC Inspection and Service', 'Air conditioning inspection and servicing', 1800, 90, 1),
('Wheel Alignment', 'Wheel alignment and steering inspection', 800, 45, 1),
('Wheel Balancing', 'Wheel balancing to reduce vibration', 600, 45, 1),
('Battery Inspection', 'Battery health and charging system check', 500, 30, 1),
('Engine Bay Cleaning', 'Cleaning and detailing of the engine bay', 1000, 60, 1);

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
