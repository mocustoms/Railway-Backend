/**
 * Shared uploads root for all file uploads (photos, logos, documents).
 * Use UPLOAD_PATH env var to point to a Railway Volume or other partition for persistence.
 *
 * - Local: UPLOAD_PATH not set → backend/uploads
 * - Railway Volume: set UPLOAD_PATH=/data (mount volume at /data) → photos persist across deploys
 */
const path = require('path');
const config = require('../../env');

const backendRoot = path.join(__dirname, '..', '..');

function getUploadsRoot() {
  const raw = (config.UPLOAD_PATH || 'uploads').replace(/\/$/, '');
  return path.isAbsolute(raw) ? raw : path.join(backendRoot, raw);
}

/** Subdirs under uploads root (same as diagnose script). */
const UPLOAD_SUBDIRS = {
  products: 'products',
  profilePictures: 'profile-pictures',
  customerDeposits: 'customer-deposits',
  companyLogos: 'company-logos',
  productBrandNameLogos: 'product-brand-name-logos',
  productManufacturerLogos: 'product-manufacturer-logos',
  productModelLogos: 'product-model-logos',
  salesAgentPhotos: 'sales-agent-photos',
  temp: 'temp',
};

function getUploadDir(subdirKey) {
  const subdir = UPLOAD_SUBDIRS[subdirKey] || subdirKey;
  return path.join(getUploadsRoot(), subdir);
}

module.exports = { getUploadsRoot, getUploadDir, UPLOAD_SUBDIRS };
