'use strict'

module.exports = function (mikser) {
	if (mikser.config.livereload) {
		window.LiveReloadOptions = { 
			host: location.host.split(':')[0], 
			port: mikser.config.livereloadPort,
			snipver: 1
		};
		require('livereload-js');
	}
};