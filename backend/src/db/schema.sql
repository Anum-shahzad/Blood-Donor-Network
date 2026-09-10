-- Blood Donor & Emergency Request Network — core schema
-- Run this against a fresh MySQL database before starting the backend.

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('donor', 'requester', 'admin') NOT NULL,
  phone VARCHAR(30),
  city VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_users_email (email)
);

CREATE TABLE IF NOT EXISTS donor_profiles (
  user_id INT PRIMARY KEY,
  blood_group ENUM('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+') NOT NULL,
  last_donation_date DATE NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_blood_group_verified BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_donor_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_donor_matching (blood_group, is_available)
);

CREATE TABLE IF NOT EXISTS requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requester_id INT NOT NULL,
  blood_group ENUM('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+') NOT NULL,
  units_needed INT NOT NULL DEFAULT 1,
  hospital_name VARCHAR(190) NOT NULL,
  city VARCHAR(100) NOT NULL,
  urgency ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  required_by DATETIME NULL,
  status ENUM('pending', 'verified', 'matched', 'fulfilled', 'expired', 'cancelled')
    NOT NULL DEFAULT 'pending',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_requests_requester
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_requests_matching (blood_group, city, status)
);

CREATE TABLE IF NOT EXISTS request_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  donor_id INT NOT NULL,
  status ENUM('notified', 'accepted', 'declined') NOT NULL DEFAULT 'notified',
  responded_at TIMESTAMP NULL,
  CONSTRAINT fk_responses_request
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_responses_donor
    FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_request_donor (request_id, donor_id)
);
