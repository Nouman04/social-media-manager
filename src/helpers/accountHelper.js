'use strict';

/**
 * Pick the connected account (WhatsappDetail / InstagramDetail /
 * MessengerDetail) a request acts through.
 *
 * A business may connect several accounts per platform. With an account_id
 * that exact account is used — scoped to the business, so an id belonging to
 * another tenant is simply not found. Without one, a business that has a
 * single active account keeps working as before; with several the caller
 * must say which, rather than us guessing and sending from the wrong number.
 *
 * @param {Model}  Model      - The platform's *Detail model.
 * @param {number} businessId
 * @param {number} [accountId]
 * @param {string} label      - Platform name for error messages.
 * @returns {Promise<Model>}
 */
const resolveAccount = async (Model, businessId, accountId, label) => {
  const where = { business_id: businessId, is_active: true };
  if (accountId) where.id = accountId;

  const rows = await Model.findAll({ where, limit: 2 });

  if (rows.length === 0) {
    const err = new Error(
      accountId
        ? `${label} account ${accountId} is not connected to business_id=${businessId}`
        : `No active ${label} credentials found for business_id=${businessId}`
    );
    err.statusCode = 404;
    throw err;
  }

  if (rows.length > 1) {
    const err = new Error(
      `business_id=${businessId} has more than one connected ${label} account — pass account_id to choose one.`
    );
    err.statusCode = 400;
    throw err;
  }

  return rows[0];
};

/**
 * Every account a business has connected on one platform, newest first, with
 * the access token stripped — for the account picker.
 */
const listAccounts = async (Model, businessId) => {
  const rows = await Model.findAll({
    where: { business_id: businessId },
    order: [['created_at', 'DESC']],
  });
  return rows.map((row) => {
    const plain = row.toJSON();
    delete plain.access_token;
    return plain;
  });
};

module.exports = { resolveAccount, listAccounts };
