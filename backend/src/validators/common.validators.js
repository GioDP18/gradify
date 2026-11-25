import { param } from 'express-validator';

export const idParam = (name = 'id') =>
  param(name).isMongoId().withMessage('That item was not found.');
