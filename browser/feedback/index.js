'use strict'
var ReconnectingWebSocket = require('reconnectingwebsocket');
var nProgress = require('nprogress');
var S = require('string');
var $ = require('jquery');
var aw = require('ansi-webkit');
require('snackbarjs');

nProgress.configure({ trickle: false, showSpinner: false });

module.exports = function (mikser) {

	mikser.loadResource('/mikser/node_modules/nprogress/nprogress.css');
	mikser.loadResource('/mikser/browser/feedback/style.css');
	mikser.loadResource('/mikser/node_modules/snackbarjs/dist/snackbar.min.css');
	mikser.loadResource('/mikser/node_modules/snackbarjs/themes-css/material.css');

	var port = mikser.config.feedbackPort;
	var ws = new ReconnectingWebSocket('ws://' + location.host.split(':')[0] + ':' + port);

	var styles = {
		warning: [
			'color: #FCC300',
			'font-weight: bold',
		].join(';'),
		error: [
			'color: #EE3C43',
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
		} else {
			var pending = S(message).between('Pending:').trim().s;
		}
		return Number(pending);
	}

	function handleMessage(data) {
		if (data.level === 'error') {
			currentState = data.level;
		}
		else if (data.level === 'warning') {
			if (currentState !== 'error') {
				currentState = data.level;
			}
		}
		console.log('%c Mikser: ' + data.message, styles[data.level]);
		counters[data.level]++;
		$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning').addClass('mikser-feedback-' + currentState);
	}

	function showSummary() {
		var messageSulfix = '';
		if (counters.error) {
			messageSulfix += ' Errors: <strong>' + counters.error + '</strong>';
		}
		if (counters.warning) {
			messageSulfix += ' Warnings: <strong>' + counters.warning + '</strong>';
		}

		if (counters.warning || counters.error) {
			$.snackbar({
				content: 'Mikser finished.' + messageSulfix,
				htmlAllowed: true,
				timeout: 10 * 1000
			});
		}
	}

	var currentProgress = 0;
	var currentMomemnt = new Date().getTime();
	var currentState;
	var counters = {
		error: 0,
		warning: 0,
	}

	ws.onmessage = function(event) {
		var parsedData = JSON.parse(event.data);

		if (parsedData.run) {
			console.log(parsedData, '???????????');
		}

		// console.log(parsedData.message);
		// console.log.apply(console, aw.parse(parsedData.message));
		// return;

		if (parsedData.status === 'started') {
			counters = {
				error: 0,
				warning: 0,
			};
			console.log('%c Mikser: ' + parsedData.status, 'color: green');
		}
		else if (parsedData.status === 'progress') {
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
		else if (parsedData.level === 'history') {
			parsedData.history.forEach(handleMessage);
			if (parsedData.finished) showSummary();
		}
		else if (parsedData.level === 'warning') {
			handleMessage(parsedData);
		}
		else if (parsedData.level === 'error') {
			handleMessage(parsedData);
		}
		else if (parsedData.status === 'finished') {
			console.log('Mikser:', parsedData.status, ' errors: '+ counters.error, 'warnings: ' + counters.warning);
			showSummary();
			nProgress.done();
			currentProgress = 0;
			currentState = undefined;
			setTimeout(function() {
				$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning');
			}, 400);
		}

	}
}