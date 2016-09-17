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
		document.addEventListener('LiveReloadConnect', function(e){
			if (mikser.options.entityId) {
				LiveReload.connector.socket.send(JSON.stringify({
					command: 'details', 
					entityId: mikser.options.entityId, 
					entityCollection: mikser.options.entityCollection
				}));
			}
		});

		window.addEventListener('beforeunload', function(e){
			LiveReload.shutDown();
		}, false);
	}
};