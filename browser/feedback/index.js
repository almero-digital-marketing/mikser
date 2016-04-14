'use strict'

module.exports = function (mikser) {
	if (mikser.config.feedback) {
		var port = mikser.config.feedbackPort;
		var ws = new WebSocket('ws://' + location.host.split(':')[0] + ':' + port);

		ws.onmessage = function(event) {
			var info = JSON.parse(event.data);
			console.log(info, '???????????');
		}

	}
}