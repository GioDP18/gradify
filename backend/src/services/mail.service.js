/**
 * Outgoing email over SMTP. Optional: without SMTP_HOST nothing is sent and callers get a plain
 * message to show the user. Failures are logged here with their technical cause; the user only
 * ever sees the short messages below.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

let transport = null;
let testTransport = null;

/** Tests swap in a fake transport ({ sendMail }) so no real email is sent. Pass null to remove it. */
export function setMailTransportForTests(fake) {
  testTransport = fake;
}

export const isMailConfigured = () => Boolean(testTransport || env.mail);

function getTransport() {
  if (testTransport) return testTransport;
  if (!transport) {
    const { host, port, secure, user, pass } = env.mail;
    transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      // A slow mail server must not hold a request (or a serverless function) open for minutes.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transport;
}

/** Sends one message. Throws an ApiError with a user-safe message when it cannot be sent. */
export async function sendMail({ to, subject, text, html, replyTo }) {
  if (!isMailConfigured()) {
    throw ApiError.unavailable('Sending email is not set up yet. Copy the link and send it to the student yourself.');
  }
  try {
    await getTransport().sendMail({ from: env.mail?.from ?? 'Gradify <no-reply@gradify.invalid>', to, subject, text, html, replyTo });
  } catch (error) {
    logger.error('Email could not be sent:', error.message);
    throw new ApiError(502, 'EMAIL_FAILED', 'The email could not be sent. Try again, or copy the link and send it yourself.');
  }
}

/** Makes text safe to place inside an HTML email. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
