var express = require('express')

module.exports = function(mikser) {
	var router = express.Router();
	router.get('/config', function(req, res) {
	  res.json(mikser.config);
	});
	return router;
}