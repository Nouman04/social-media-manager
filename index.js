require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const passport = require("passport");
const initializePassport = require("./src/config/passportConfig");

const twoFactorAuthRoutes = require("./src/routes/twoFactorAuthRoutes");
const rbacRoutes = require("./src/routes/rbacRoutes");
const businessRoutes = require("./src/routes/businessRoutes");

const app = express();
const PORT = process.env.NODE_PORT || process.env.PORT || 5000;

initializePassport(passport);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(passport.initialize());

app.use("/auth", twoFactorAuthRoutes);
app.use("/rbac", rbacRoutes);
app.use("/business", businessRoutes);

app.get("/", (req, res) => {
  res.json({ success: true, message: "SMM API Server Running" });
});

app.listen(PORT, () => {
  console.log(`SMM App is listening at port: ${PORT}`);
});

module.exports = app;
