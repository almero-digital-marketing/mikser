'use strict'
var ReconnectingWebSocket = require('reconnectingwebsocket');
var nProgress = require('nprogress');
var S = require('string');
var $ = require('jquery');

nProgress.configure({ trickle: false, showSpinner: false });

module.exports = function (mikser) {

	mikser.loadResource('/mikser/node_modules/nprogress/nprogress.css');
	mikser.loadResource('/mikser/browser/feedback/style.css');

	var port = mikser.config.feedbackPort;
	var ws = new ReconnectingWebSocket('ws://' + location.host.split(':')[0] + ':' + port);

	var styles = {
		warning: [
			'color: #cc7a00',
			'font-weight: bold',
		].join(';'),
		error: [
			'color: red',
			'font-weight: bold',
		].join(';')
	}

	// if type is not passed, pending is returned
	function extractNumber(message, type) {
		if (type === 'processed') {
			var processed = S(message).between('Processed:', 'Pending:').trim().s;
			return Number(processed);
		}
		if (S(message).contains('Remaining time:')) {
			var pending = S(message).between('Pending:', 'Remaining time:').trim().s;
			// console.log(pending, 'FUCK');
		} else {
			var pending = S(message).between('Pending:').trim().s;
			// console.log(pending, 'No Remaining Time');
		}
		return Number(pending);
	}

	function handleMessage(data) {

		if (data.level === 'error') {
			currentState = data.level;
			console.log('%c' + data.message, styles[data.level]);
		}
		else if (data.level === 'warning') {
			if (currentState !== 'error') {
				currentState = data.level;
			}
			console.warn('%c' + data.message, styles[data.level]);
		}
		$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning').addClass('mikser-feedback-' + currentState);
	}

	if (localStorage.length) {
		var storedMessages = localStorage.getItem('mikser-feedback-messages');
		if (storedMessages) {
			storedMessages = JSON.parse(storedMessages);
			storedMessages.forEach(handleMessage);
		}
	}

	$('#nprogress').addClass('error');
	var messages = [];
	var currentProgress = 0;
	var currentMomemnt = new Date().getTime();
	var currentState;

	ws.onmessage = function(event) {
		var parsedData = JSON.parse(event.data);

		if (parsedData.message === 'render-started') {
			if (localStorage.length) {
				localStorage.clear();
			}
			messages = [];
		}

		if (parsedData.level === 'progress') {
			var pending = extractNumber(parsedData.message, 'pending');
			var processed = extractNumber(parsedData.message, 'processed');
			var progress = processed / (pending + processed);
			progress = Number(progress.toFixed(2));

			if (currentState) {
				$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning').addClass('mikser-feedback-' + currentState);
			}

			if ((currentProgress != progress) && (new Date().getTime() - currentMomemnt > 400)) {
				currentProgress = progress;
				currentMomemnt = new Date().getTime();
				nProgress.set(currentProgress);
			}
		}

		if (parsedData.level === 'warning') {
			messages.push({ 
				message: parsedData.message,
				level: parsedData.level 
			});
			localStorage.setItem('mikser-feedback-messages', JSON.stringify(messages));
			handleMessage(parsedData);
		}

		if (parsedData.level === 'error') {
			messages.push({ 
				message: parsedData.message,
				level: parsedData.level 
			});
			localStorage.setItem('mikser-feedback-messages', JSON.stringify(messages));
			handleMessage(parsedData);
		}

		if (parsedData.message === 'render-finished') {
			nProgress.done();
			currentProgress = 0;
			currentState = undefined;
			setTimeout(function() {
				$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning');
			}, 400);
		}
	}

}