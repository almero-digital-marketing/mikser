'use strict'

module.exports = function (mikser) {
	if (mikser.config.livereload) {
		var hostInfo = location.host.split(':');
		hostInfo.push(80);
		window.LiveReloadOptions = { 
			host: hostInfo[0], 
			port: hostInfo[1],
			snipver: 1
		};
		var livereload = require('livereload-js');
		window.addEventListener('beforeunload', function(e){
			LiveReload.shutDown();
		}, false);
	}
};