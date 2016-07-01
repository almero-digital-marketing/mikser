'use strict'
var $ = require('jquery');
var ReconnectingWebSocket = require('reconnectingwebsocket');
var nProgress = require('nprogress');
var S = require('string');
var aw = require('ansi-webkit');

nProgress.configure({ trickle: false, showSpinner: false });

module.exports = function (mikser) {
	mikser.loadResource('/mikser/feedback/style.css');
	
	var port = mikser.config.feedbackPort;
	var ws = new ReconnectingWebSocket('ws://' + location.host.split(':')[0] + ':' + mikser.config.serverPort + '/feedback');
	var lastMessage;

	var styles = {
		warning: [
			'color: #FCC300',
		].join(';'),
		error: [
			'color: #EE3C43',
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
		if (data.entityId) {
			if (data.level === 'error') {
				currentState = data.level;
			}
			else if (data.level === 'warning') {
				if (currentState !== 'error') {
					currentState = data.level;
				}
			}
		}
		if (data.message != lastMessage) {
			console.log('%cMikser: ' + data.message, styles[data.level]);
			lastMessage = data.message;
		}
		if (data.layoutId) {
			console.log('%c  ' + data.entityId + ' -> ' + data.layoutId, styles[data.level]);
		} else if (data.entityId) {
			console.log('%c  ' + data.entityId, styles[data.level]);
		}
		if (data.entityId) {
			counters[data.level]++;
			$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning').addClass('mikser-feedback-' + currentState);			
		}
	}

	function handleRunMessage(data) {
		if (data.message) {
			console.log.apply(console, aw.parse(data.message));
		}		
		if (data.code !== 0) {
			mikser.plugins.notification.server('Command failed: <strong>' + data.command + '</strong>');
		}
	}

	function showSummary() {
		var messageSulfix = '';
		var message = 'Mikser generation finished.';
		if (counters.error) {
			messageSulfix += ' Errors: <strong>' + counters.error + '</strong>';
		}
		if (counters.warning) {
			messageSulfix += ' Warnings: <strong>' + counters.warning + '</strong>';
		}

		if (counters.warning || counters.error) {
			mikser.plugins.notification.server(message + messageSulfix);
		}
	}

	var currentProgress = 0;
	var currentMomemnt = new Date().getTime();
	var currentState;
	var counters = {
		error: 0,
		warning: 0,
		reset: function(counter) {
			if (counter && this[counter]) {
				this[counter] = 0;
			} else {
				var self = this;
				Object.keys(this).forEach(function(key){
					if (typeof self[key] === 'number') self[key] = 0;
				});
			}
		}
	}

	ws.onmessage = function(event) {
		var parsedData = JSON.parse(event.data);

		if (parsedData.source === 'tools') {
			if (parsedData.history) {
				parsedData.history.forEach(handleRunMessage);
			} else {
				handleRunMessage(parsedData);
			}
		}
		else if (parsedData.source === 'scheduler') {
			if (parsedData.status === 'started') {
				counters.reset();
				console.log('Mikser: Generation started.');
				$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning');
			}
			else if (parsedData.status === 'finished') {
				console.log('Mikser: Generation finished. Errors: '+ counters.error, 'Warnings: ' + counters.warning);
				showSummary();
				nProgress.done();
				currentProgress = 0;
				currentState = undefined;
				setTimeout(function() {
					$('#nprogress').removeClass('mikser-feedback-error mikser-feedback-warning');
				}, 400);
			}
		}
		else if (parsedData.source === 'diagnostics') {
			if (parsedData.level === 'history') {
				parsedData.history.forEach(handleMessage);
				if (parsedData.finished) showSummary();
			}
			else if (parsedData.level === 'warning') {
				handleMessage(parsedData);
			}
			else if (parsedData.level === 'error') {
				handleMessage(parsedData);
			}
		}
		else if (parsedData.source === 'queue') {
			if (parsedData.status === 'progress') {
				var pending = extractNumber(parsedData.message, 'pending');
				var processed = extractNumber(parsedData.message, 'processed');
				var progress = processed / (pending + processed);
				progress = Number(progress.toFixed(2));

				if (currentState && !$('#nprogress').hasClass('mikser-feedback-warning') && !$('#nprogress').hasClass('mikser-feedback-error')) {
					$('#nprogress').addClass('mikser-feedback-' + currentState);
				}

				if ((currentProgress != progress) && (new Date().getTime() - currentMomemnt > 400)) {
					currentProgress = progress;
					currentMomemnt = new Date().getTime();
					nProgress.set(currentProgress);
				}
			}
		}
	}
}