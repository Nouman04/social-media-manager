require('dotenv').config();
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const { User } = require('../../models');

const initializePassport = (passport) => {
  passport.use(
    new JwtStrategy(
      {
        secretOrKey: process.env.NODE_SECRET_KEY || 'smm_secret_key',
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      },
      async function (payload, next) {
        try {
          const user = await User.findByPk(payload.id);
          if (!user) {
            return next(null, false);
          }
          return next(null, user);
        } catch (err) {
          return next(err, false);
        }
      }
    )
  );
};

module.exports = initializePassport;
