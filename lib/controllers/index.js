var express = require('express');
var config = require('./config');

module.exports = function(mikser) {
	var router = express.Router();
	router.use('/mikser', config(mikser));
	return router;
}