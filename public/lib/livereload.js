'use strict'

var Promise = require('bluebird');

module.exports = function(mikser) {
	if (mikser.config.livereload) {
		window.LiveReloadOptions = { 
			host: location.host.split(':')[0], 
			port: mikser.config.serverPort,
			snipver: 1
		};
		require('livereload-js');		
	}
	return Promise.resolve(mikser);
}
