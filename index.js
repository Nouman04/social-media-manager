require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const passport = require("passport");
const initializePassport = require("./src/config/passportConfig");
const realtime = require("./src/helpers/realtime");

const twoFactorAuthRoutes = require("./src/routes/twoFactorAuthRoutes");
const rbacRoutes = require("./src/routes/rbacRoutes");
const businessRoutes = require("./src/routes/businessRoutes");
const businessUserRoutes = require("./src/routes/businessUserRoutes");
const whatsappRoutes = require("./src/routes/whatsappRoutes");
const instagramRoutes = require("./src/routes/instagramRoutes");

const app = express();
const PORT = process.env.NODE_PORT || process.env.PORT || 5000;

initializePassport(passport);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(passport.initialize());

// ── Serve locally saved media files (downloaded from Meta)
app.use('/public', express.static(path.join(__dirname, 'src/public')));

app.use("/auth", twoFactorAuthRoutes);
app.use("/rbac", rbacRoutes);
app.use("/business", businessRoutes);
app.use("/business-users", businessUserRoutes);
app.use("/api/v1/whatsapp", whatsappRoutes);
app.use("/api/v1/instagram", instagramRoutes);

app.get("/", (req, res) => {
  res.json({ success: true, message: "SMM API Server Running" });
});

// Meta App Dashboard's Privacy Policy / Terms of Service URL fields point here.
app.get("/privacy-policy", (req, res) => {
  res.sendFile(path.join(__dirname, "src/public/privacy-policy.html"));
});
app.get("/terms-of-service", (req, res) => {
  res.sendFile(path.join(__dirname, "src/public/terms-of-service.html"));
});
app.get("/data-deletion", (req, res) => {
  res.sendFile(path.join(__dirname, "src/public/data-deletion.html"));
});

// Socket.IO needs the underlying HTTP server, so create it explicitly
// rather than letting app.listen() build one internally.
const server = http.createServer(app);
realtime.init(server);

server.listen(PORT, () => {
  console.log(`SMM App is listening at port: ${PORT}`);
});

module.exports = app;
