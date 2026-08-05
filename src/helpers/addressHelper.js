'use strict';

const { Address } = require('../../models');

/**
 * Helpers for the polymorphic `addresses` table.
 *
 * A row is identified by the pair (addressable_type, addressable_id) — e.g.
 * ('Business', 12). Every helper takes an optional `transaction` so callers can
 * keep the address write inside the same transaction as the parent record.
 */

/**
 * Create an address for a record. Returns null when `address` is empty, so
 * callers can pass an optional field straight through.
 */
const createAddress = async (addressableType, addressableId, address, options = {}) => {
  if (address === undefined || address === null || String(address).trim() === '') {
    return null;
  }

  return Address.create(
    {
      addressable_type: addressableType,
      addressable_id: addressableId,
      address: String(address).trim(),
    },
    { transaction: options.transaction }
  );
};

/**
 * Fetch the address row for a record (or null when it has none).
 */
const getAddress = async (addressableType, addressableId, options = {}) => {
  return Address.findOne({
    where: { addressable_type: addressableType, addressable_id: addressableId },
    transaction: options.transaction,
  });
};

/**
 * Create / update / remove the address for a record in one call.
 *  - non-empty string → creates or updates the row
 *  - null or ''       → deletes the existing row
 *  - undefined        → no-op (field was not sent by the client)
 */
const upsertAddress = async (addressableType, addressableId, address, options = {}) => {
  if (address === undefined) return undefined;

  const existing = await getAddress(addressableType, addressableId, options);

  if (address === null || String(address).trim() === '') {
    if (existing) await existing.destroy({ transaction: options.transaction });
    return null;
  }

  if (existing) {
    await existing.update({ address: String(address).trim() }, { transaction: options.transaction });
    return existing;
  }

  return createAddress(addressableType, addressableId, address, options);
};

/**
 * Delete the address row(s) for a record. Returns the number of rows removed.
 */
const deleteAddress = async (addressableType, addressableId, options = {}) => {
  return Address.destroy({
    where: { addressable_type: addressableType, addressable_id: addressableId },
    transaction: options.transaction,
  });
};

module.exports = {
  createAddress,
  getAddress,
  upsertAddress,
  deleteAddress,
};
