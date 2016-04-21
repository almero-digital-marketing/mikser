'use strict'
var ReconnectingWebSocket = require('reconnectingwebsocket');
module.exports = function (mikser) {
		var port = mikser.config.feedbackPort;
		var ws = new ReconnectingWebSocket('ws://' + location.host.split(':')[0] + ':' + port);

		ws.onmessage = function(event) {
			console.log(JSON.parse(event.data));
		}

}