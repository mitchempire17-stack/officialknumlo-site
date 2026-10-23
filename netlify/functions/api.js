// Runs the Express API as a Netlify Function. All /api/* requests are routed here by netlify.toml.
const serverless = require('serverless-http');
const express = require('express');
const app = require('../../server');
const outer = express();
// Netlify may hand us /api/x or /.netlify/functions/api/x; normalise both to /api/x
outer.use((req, res, next) => {
  let u = req.url.replace(/^\/\.netlify\/functions\/api/, '');
  if (!u.startsWith('/api')) u = '/api' + (u.startsWith('/') ? '' : '/') + u;
  req.url = u; next();
});
outer.use(app);
exports.handler = serverless(outer);
