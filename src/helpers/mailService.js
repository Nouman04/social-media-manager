const nodemailer = require('nodemailer');

const createTransport = () => {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT || '587'),
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
      user: process.env.MAIL_USER || '',
      pass: process.env.MAIL_PASS || '',
    },
  });
};

const send2FACodeEmail = async (email, code, subject = 'Your 2FA Authentication Code') => {
  const mailOptions = {
    from: process.env.MAIL_FROM || '"SMM Support" <no-reply@smm.com>',
    to: email,
    subject: subject,
    text: `Your 2FA verification code is: ${code}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #333;">Security Verification Code</h2>
        <p style="font-size: 16px; color: #555;">Use the following 6-digit verification code to complete your request:</p>
        <div style="font-size: 28px; font-weight: bold; color: #4CAF50; letter-spacing: 4px; padding: 12px 0;">${code}</div>
        <p style="font-size: 14px; color: #888;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
      </div>
    `,
  };

  try {
    const transporter = createTransport();
    const info = await transporter.sendMail(mailOptions);
    console.log(`[MailService] Email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.warn(`[MailService] Could not send email to ${email}. Code was: ${code}`, error.message);
    return null;
  }
};

/**
 * Send a business invitation link.
 *
 * The link carries the invited user's uuid and a single-use token; opening it
 * lets them set a password, which activates and verifies their account.
 *
 * @param {string} email        - Invitee's email address.
 * @param {string} link         - Fully-built invitation URL.
 * @param {string} businessName - Business they are being invited to.
 * @param {string} inviterName  - Who sent the invitation.
 * @param {number} expiresHours - How long the link stays valid.
 */
const sendInvitationEmail = async (email, link, businessName, inviterName, expiresHours = 48) => {
  const mailOptions = {
    from: process.env.MAIL_FROM || '"SMM Support" <no-reply@smm.com>',
    to: email,
    subject: `You have been invited to join ${businessName}`,
    text: `${inviterName} invited you to join ${businessName}. `
        + `Set your password using this link: ${link} (expires in ${expiresHours} hours).`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #333;">You're invited to join ${businessName}</h2>
        <p style="font-size: 16px; color: #555;">
          ${inviterName} has invited you to join <strong>${businessName}</strong>.
          Click below to set your password and activate your account.
        </p>
        <p style="padding: 16px 0;">
          <a href="${link}" style="background: #4CAF50; color: #fff; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-size: 16px;">Accept Invitation</a>
        </p>
        <p style="font-size: 13px; color: #888;">Or paste this into your browser:<br>${link}</p>
        <p style="font-size: 14px; color: #888;">
          This invitation expires in ${expiresHours} hours. If it expires, you can request a new one.
        </p>
      </div>
    `,
  };

  try {
    const transporter = createTransport();
    const info = await transporter.sendMail(mailOptions);
    console.log(`[MailService] Invitation sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.warn(`[MailService] Could not send invitation to ${email}. Link was: ${link}`, error.message);
    return null;
  }
};

module.exports = {
  send2FACodeEmail,
  sendInvitationEmail,
};
