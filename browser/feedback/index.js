'use strict'
var ReconnectingWebSocket = require('reconnectingwebsocket');
var nProgress = require('nprogress');
var S = require('string');

module.exports = function (mikser) {
		var port = mikser.config.feedbackPort;
		var ws = new ReconnectingWebSocket('ws://' + location.host.split(':')[0] + ':' + port);

		if (localStorage.length) {
			// clear happens after all progress events
			console.log('CLEAR STORAGE !!!');
			localStorage.clear();
		}
		var messages = {
			error: [],
			warning: [],
			progress: []
		}
		// var progressStarted, lastPending;

		// function getPendingNumber(message) {
		// 	if (S(message).contains('Ramaining time:')) {
		// 		var pending = S(message).between('Pending:', 'Remaining time:').trim().s;
		// 	} else {
		// 		var pending = S(message).between('Pending:').trim().s;
		// 	}
		// 	return parseInt(pending);
		// }

		ws.onmessage = function(event) {
			var parsedData = JSON.parse(event.data);

			if (messages[parsedData.level]) {
				messages[parsedData.level].push(parsedData.message);
				console.log(typeof parsedData.level, typeof JSON.stringify(messages[parsedData.level]));
				// localStorage.setItem('hello', 'world');
				localStorage.setItem(parsedData.level, JSON.stringify(messages[parsedData.level]));
				console.log(localStorage.getItem(parsedData.level), 'value from getter');
			}

			// if (parsedData.level === 'progress') {
			// 	console.log(parsedData);
			// }

			// if (parsedData.level === 'info') {
			// 	console.log('%c' + parsedData.message, "color: #336600");
			// 	if (parsedData.message.indexOf('Generation time:') === 0) {
			// 		nProgress.done();
			// 	}
			// }

			if (parsedData.level === 'warning') {
				console.warn('%c' + parsedData.message, "color: #CC9900");
			}

			if (parsedData.level === 'error') {
				console.error('%c' + parsedData.message, "color: black");
			}
		}

}