'use strict'
var ReconnectingWebSocket = require('reconnectingwebsocket');
var nProgress = require('nprogress');
var S = require('string');

module.exports = function (mikser) {
		var port = mikser.config.feedbackPort;
		var ws = new ReconnectingWebSocket('ws://' + location.host.split(':')[0] + ':' + port);
		var messages = {
			error: [],
			warning: [],
			progress: []
		}

		ws.onmessage = function(event) {
			var parsedData = JSON.parse(event.data);

			if (parsedData.message === 'render-started') {
				console.log('--> started');
				if (localStorage.length) localStorage.clear();
				messages.error = [];
				messages.warning = [];
				messages.progress = [];
			}

			messages[parsedData.level].push(parsedData.message);
			localStorage.setItem(parsedData.level, JSON.stringify(messages[parsedData.level]));

			if (parsedData.message === 'render-finished') {
				console.log('-->', 'finished');
			}

			if (parsedData.level === 'warning') {
				console.warn('%c' + parsedData.message, "background: #e6e600; color: black");
			}

			if (parsedData.level === 'error') {
				console.error('%c' + parsedData.message, "background: #e62e00; color: black");
			}
		}

}