'use strict';

const asyncContext = require('../helpers/asyncContext');

module.exports = (req, res, next) => {
  asyncContext.run(new Map(), () => {
    const store = asyncContext.getStore();
    store.set('req', req);
    next();
  });
};
