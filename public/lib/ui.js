'use strict'

var Promise = require('bluebird');

module.exports = function(mikser) {
	if (mikser.config.ui != false) {
		var style = document.createElement("link");
		style.type = "text/css";
		style.rel = "stylesheet";
		style.href = "/mikser/styles/style.css";
		document.getElementsByTagName("head")[0].appendChild(style);		
	}
	return Promise.resolve(mikser);
}