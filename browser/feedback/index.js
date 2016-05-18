'use strict'
var ReconnectingWebSocket = require('reconnectingwebsocket');
var nProgress = require('nprogress');
var S = require('string');

module.exports = function (mikser) {
		var port = mikser.config.feedbackPort;
		var ws = new ReconnectingWebSocket('ws://' + location.host.split(':')[0] + ':' + port);
		var progressStarted, lastPending;

		function getPendingNumber(message) {
			if (S(message).contains('Ramaining time:')) {
				var pending = S(message).between('Pending:', 'Remaining time:').trim().s;
			} else {
				var pending = S(message).between('Pending:').trim().s;
			}
			return parseInt(pending);
		}

		ws.onmessage = function(event) {
			event = JSON.parse(event.data);

			if (event.level === 'progress') {

				if (!progressStarted) {
					progressStarted = true;
					lastPending = getPendingNumber(event.message) + 1;
					nProgress.start();
				}

				var currentPending = getPendingNumber(event.message);
				if (currentPending < lastPending) {
					nProgress.inc();
				}
				lastPending = currentPending;
			}


			if (event.level === 'info') {
				console.log(event.message, 'ulala mamet');
				console.log('%c' + event.message, "color: #336600");
				if (event.message.indexOf('Generation time:') === 0) {
					nProgress.done();
				}
			}

			if (event.level === 'warning') {
				console.warn('%c' + event.message, "color: #CC9900");
			}

			if (event.level === 'error') {
				console.error('%c' + event.message, "color: black");
			}
		}

}