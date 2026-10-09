'use strict';

const { Plan, PlanFeature, sequelize } = require('../../models');
const {
  planCreateSchema,
  planUpdateSchema,
} = require('../validations/planValidation');
const stripe = process.env.STRIPE_SECRET ? require('stripe')(process.env.STRIPE_SECRET) : null;

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  CREATE PLAN
  // ══════════════════════════════════════════════════════════════════════════

  createPlan: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { error, value } = planCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const { features, ...planData } = value;

      // Automatically create Stripe Product and Price if not provided
      if (process.env.STRIPE_SECRET && !planData.stripe_product_id && !planData.stripe_price_id) {
        try {
          const product = await stripe.products.create({
            name: planData.name,
            description: planData.description || undefined,
          });

          const price = await stripe.prices.create({
            product: product.id,
            unit_amount: Math.round(planData.price * 100), // Stripe expects cents
            currency: planData.currency || 'usd',
            recurring: {
              interval: planData.interval || 'month',
            },
          });

          planData.stripe_product_id = product.id;
          planData.stripe_price_id = price.id;
        } catch (stripeErr) {
          console.error('[planController.createPlan] Stripe Creation Error:', stripeErr);
          // If stripe fails, we can either throw error or just continue without Stripe IDs.
          // Since billing is core, we should probably fail.
          await t.rollback();
          return res.status(502).json({ success: false, message: 'Failed to create plan on Stripe', error: stripeErr.message });
        }
      }

      const plan = await Plan.create(planData, { transaction: t });

      if (features && features.length > 0) {
        const featureRows = features.map(f => ({
          plan_id: plan.id,
          feature_name: f.feature_name,
          feature_value: f.feature_value,
        }));
        await PlanFeature.bulkCreate(featureRows, { transaction: t });
      }

      await t.commit();

      const created = await Plan.findByPk(plan.id, {
        include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
      });

      return res.status(201).json({
        success: true,
        message: 'Plan created successfully',
        plan: created,
      });
    } catch (err) {
      await t.rollback();
      console.error('[planController.createPlan] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  LIST PLANS
  // ══════════════════════════════════════════════════════════════════════════

  getPlans: async (req, res) => {
    try {
      const { is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === '1';

      const plans = await Plan.findAll({
        where,
        include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
      });

      return res.status(200).json({ success: true, plans });
    } catch (err) {
      console.error('[planController.getPlans] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  GET PLAN BY ID
  // ══════════════════════════════════════════════════════════════════════════

  getPlanById: async (req, res) => {
    try {
      const plan = await Plan.findByPk(req.params.id, {
        include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
      });

      if (!plan) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      return res.status(200).json({ success: true, plan });
    } catch (err) {
      console.error('[planController.getPlanById] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  UPDATE PLAN
  // ══════════════════════════════════════════════════════════════════════════

  updatePlan: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { error, value } = planUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const plan = await Plan.findByPk(req.params.id, { transaction: t });
      if (!plan) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      const { features, ...planData } = value;

      if (Object.keys(planData).length > 0) {
        // Stripe Update Logic
        if (process.env.STRIPE_SECRET && plan.stripe_product_id) {
          try {
            // Update product if name, description, or active status changed
            if (
              (planData.name !== undefined && planData.name !== plan.name) ||
              (planData.description !== undefined && planData.description !== plan.description) ||
              (planData.is_active !== undefined && planData.is_active !== plan.is_active)
            ) {
              await stripe.products.update(plan.stripe_product_id, {
                name: planData.name !== undefined ? planData.name : undefined,
                description: planData.description !== undefined ? planData.description : undefined,
                active: planData.is_active !== undefined ? planData.is_active : undefined,
              });
            }

            // Stripe Prices are immutable. If price-related fields change, we must create a new Price.
            const priceChanged = (planData.price !== undefined && planData.price !== plan.price);
            const currencyChanged = (planData.currency !== undefined && planData.currency !== plan.currency);
            const intervalChanged = (planData.interval !== undefined && planData.interval !== plan.interval);

            if (priceChanged || currencyChanged || intervalChanged) {
              // Archive old price
              if (plan.stripe_price_id) {
                await stripe.prices.update(plan.stripe_price_id, { active: false });
              }

              // Create new price
              const newPrice = await stripe.prices.create({
                product: plan.stripe_product_id,
                unit_amount: Math.round((planData.price !== undefined ? planData.price : plan.price) * 100),
                currency: planData.currency || plan.currency,
                recurring: {
                  interval: planData.interval || plan.interval,
                },
              });
              planData.stripe_price_id = newPrice.id;
            }
          } catch (stripeErr) {
            console.error('[planController.updatePlan] Stripe Update Error:', stripeErr);
            await t.rollback();
            return res.status(502).json({ success: false, message: 'Failed to update plan on Stripe', error: stripeErr.message });
          }
        }

        await plan.update(planData, { transaction: t });
      }

      // If features array is provided, replace all existing features
      if (features !== undefined) {
        await PlanFeature.destroy({ where: { plan_id: plan.id }, transaction: t });
        if (features.length > 0) {
          const featureRows = features.map(f => ({
            plan_id: plan.id,
            feature_name: f.feature_name,
            feature_value: f.feature_value,
          }));
          await PlanFeature.bulkCreate(featureRows, { transaction: t });
        }
      }

      await t.commit();

      const updated = await Plan.findByPk(plan.id, {
        include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
      });

      return res.status(200).json({
        success: true,
        message: 'Plan updated successfully',
        plan: updated,
      });
    } catch (err) {
      await t.rollback();
      console.error('[planController.updatePlan] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  DELETE PLAN
  // ══════════════════════════════════════════════════════════════════════════

  deletePlan: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const plan = await Plan.findByPk(req.params.id, { transaction: t });
      if (!plan) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      // Archive on Stripe
      if (process.env.STRIPE_SECRET && plan.stripe_product_id) {
        try {
          await stripe.products.update(plan.stripe_product_id, { active: false });
        } catch (stripeErr) {
          console.error('[planController.deletePlan] Stripe Archive Error:', stripeErr);
          // We can warn but continue, or fail. We'll fail to be safe.
          await t.rollback();
          return res.status(502).json({ success: false, message: 'Failed to archive plan on Stripe', error: stripeErr.message });
        }
      }

      // Soft archive in our database instead of hard deleting
      plan.is_active = false;
      await plan.save({ transaction: t });

      await t.commit();

      return res.status(200).json({ success: true, message: 'Plan archived successfully' });
    } catch (err) {
      await t.rollback();
      console.error('[planController.deletePlan] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },
};
