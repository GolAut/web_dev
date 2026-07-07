
const express = require("express");
const app = express();
app.use(express.json());

// Echo back what URL we received
app.all("*", (req, res) => {
  res.json({ 
    method: req.method, 
    url: req.url, 
    path: req.path,
    headers: req.headers 
  });
});

module.exports = app;
