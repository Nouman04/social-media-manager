'use strict';

/**
 * Pipeline, deals, tickets, ticket categories and SLA policies.
 * Every route needs a signed-in member of the business named by business_uuid
 * (query for GET/DELETE, body for POST/PUT/PATCH). Records are addressed by uuid.
 */
const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');
const c = require('../controllers/crmController');

const guard = [authenticate, authorizeBusiness.byUuid];

// /api/v1/pipeline
const pipeline = express.Router();
pipeline.use(...guard);
pipeline.get('/stages', c.listStages);
pipeline.post('/stages', c.createStage);
pipeline.put('/stages/reorder', c.reorderStages); // before /stages/:uuid
pipeline.put('/stages/:uuid', c.updateStage);
pipeline.delete('/stages/:uuid', c.deleteStage);
pipeline.get('/summary', c.pipelineSummary);

// /api/v1/deals
const deals = express.Router();
deals.use(...guard);
deals.get('/', c.board);
deals.post('/', c.createDeal);
deals.get('/:uuid', c.getDeal);
deals.put('/:uuid', c.updateDeal);
deals.delete('/:uuid', c.deleteDeal);
deals.patch('/:uuid/move', c.moveDeal);
deals.get('/:uuid/activity', c.dealActivity);
deals.post('/:uuid/notes', c.addDealNote);

// /api/v1/tickets
const ticketsRouter = express.Router();
ticketsRouter.use(...guard);
ticketsRouter.get('/', c.listTickets);
ticketsRouter.get('/stats', c.ticketStats); // before /:uuid
ticketsRouter.post('/', c.createTicket);
ticketsRouter.post('/from-conversation', c.fromConversation);
ticketsRouter.get('/:uuid', c.getTicket);
ticketsRouter.put('/:uuid', c.updateTicket);
ticketsRouter.patch('/:uuid', c.updateTicket);
ticketsRouter.delete('/:uuid', c.deleteTicket);
ticketsRouter.get('/:uuid/timeline', c.timeline);
ticketsRouter.post('/:uuid/notes', c.addTicketNote);

// /api/v1/ticket-categories and /api/v1/sla-policies
const categories = express.Router();
categories.use(...guard);
categories.get('/', c.listCategories);
categories.post('/', c.createCategory);
categories.put('/:uuid', c.updateCategory);
categories.delete('/:uuid', c.deleteCategory);

const sla = express.Router();
sla.use(...guard);
sla.get('/', c.listSla);
sla.post('/', c.createSla);
sla.put('/:uuid', c.updateSla);
sla.delete('/:uuid', c.deleteSla);

module.exports = { pipeline, deals, tickets: ticketsRouter, categories, sla };
