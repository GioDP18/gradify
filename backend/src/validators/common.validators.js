import { param } from 'express-validator';

export const idParam = (name = 'id') =>
  param(name).isMongoId().withMessage(`${name} must be a valid ID`);
