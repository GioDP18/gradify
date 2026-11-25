import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';

/** Any other upload failure: the library's reason is logged, the user gets a short message. */
function uploadFailed(req, error) {
  logger.warn(`[${req.id}] Upload rejected:`, error.code, error.message);
  return ApiError.badRequest('Upload failed. Please try again.');
}

const MAX_CSV_BYTES = 1024 * 1024; // 1 MB ≈ 10,000+ student rows

/** Accepts one CSV file in memory (field name "file"). Files never touch the disk. */
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    // Browsers report CSV under several MIME types (Excel on Windows: application/vnd.ms-excel),
    // so the extension is the reliable check; content is validated by the CSV parser.
    if (/\.csv$/i.test(file.originalname)) cb(null, true);
    else cb(ApiError.badRequest('Only .csv files can be imported'));
  },
}).single('file');

export function uploadCsv(req, res, next) {
  csvUpload(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The CSV file must be 1 MB or smaller'));
      return next(uploadFailed(req, error));
    }
    if (error) return next(error);
    if (!req.file) return next(ApiError.badRequest('Choose a CSV file to import.'));
    return next();
  });
}

const MAX_AVATAR_BYTES = 1024 * 1024; // the browser sends ~10–30 KB; this is a backstop

/** Accepts one profile photo in memory (field name "avatar"). The content is checked by the service. */
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0 },
}).single('avatar');

export function uploadAvatar(req, res, next) {
  avatarUpload(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The photo must be 1 MB or smaller'));
      return next(uploadFailed(req, error));
    }
    if (error) return next(error);
    if (!req.file) return next(ApiError.badRequest('Choose a photo to upload.'));
    return next();
  });
}
