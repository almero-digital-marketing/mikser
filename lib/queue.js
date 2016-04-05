'use strict'

var Promise = require('bluebird');
var moment = require('moment');
var S = require('string');
var _ = require('lodash');

module.exports = function(mikser) {
	mikser.queue = {
		concurrency: mikser.config.workers * 3,
		processed: 0,
		pending: 0,
		remainingTime: 0,
		averageTime: 0
	};

	let debug = mikser.debug('queue');
	let started = false;
	let concurent = 0;
	let queue = [];
	let startTime = new Date().getTime();

	function dequeue() {
		debug('Concurent:', concurent, 'Left:', queue.length);
		if (!queue.length) return;
		while(concurent < mikser.queue.concurrency && queue.length) {
			concurent++;
			let action = queue.shift().action;
			if (_.isFunction(action)) action = action();
			action.finally(() => {
				mikser.queue.processed++;
				concurent--;
				mikser.queue.pending = queue.length + concurent;
				if (mikser.queue.processed > mikser.queue.concurrency * 3) {
					let currentTime = new Date().getTime();
					mikser.queue.averageTime = Math.round((currentTime - startTime) / mikser.queue.processed);
					mikser.queue.remainingTime = mikser.queue.averageTime * mikser.queue.pending; 
					debug('Elapsed time:', currentTime - startTime, 'Average time:', mikser.queue.averageTime, 'Remaining time:', mikser.queue.remainingTime);				
				}

				let status = 
					'Processed: ' + mikser.queue.processed;
				if (mikser.queue.pending) {
					status += ' Pending: ' + mikser.queue.pending;
				}
				if (mikser.queue.averageTime && mikser.queue.pending > mikser.queue.concurrency) {
					let duration = moment.duration(mikser.queue.remainingTime);
					status += ' Remaining time: ' + 
						S(duration.hours()).padLeft(2, '0') + ':' +
						S(duration.minutes()).padLeft(2, '0') + ':' +
						S(duration.seconds()).padLeft(2, '0');
				}

				if (mikser.options.debug) {
					debug(status);
				} else if (!mikser.queue.pending) {
					mikser.diagnostics.log(status);
				} else {
					mikser.diagnostics.progress(status);
				}

				dequeue();
			});
		}
	}

	mikser.queue.start = function() {
		if (!queue.length) return Promise.resolve();
		if (started) return started;

		mikser.queue.processed = 0;
		mikser.queue.pending = queue.length;
		mikser.queue.remainingTime = 0;
		mikser.queue.averageTime = 0;

		started = new Promise((resolve, reject) => {
			startTime = new Date().getTime();
			dequeue();
			let interval = setInterval(() => {
				if (!mikser.queue.pending) {
					clearInterval(interval);
					let endTime = new Date().getTime();
					let duration = moment.duration(endTime - startTime);

					mikser.diagnostics.log('info','Generation time:', 
						S(duration.hours()).padLeft(2, '0') + ':' +
						S(duration.minutes()).padLeft(2, '0') + ':' +
						S(duration.seconds()).padLeft(2, '0'));
					resolve();
					started = false;
				}
			}, 1000);
		});
		return started;
	}

	mikser.queue.drain = function() {
		debug.log('Draining queue');
		queue = [];
		mikser.queue.pending = 0;
	}

	mikser.queue.push = function(documentId, action) {
		queue.push({
			action: action,
			documentId: documentId
		});
	}

	mikser.queue.unshift = function(documentId, action) {
		queue.unshift({
			action: action,
			documentId: documentId
		});
	}

	mikser.queue.isPending = function(documentId) {
		for(let item of queue) {
			if(item.documentId == documentId) return true;
		}
		return false;
	}

	return Promise.resolve(mikser);
}