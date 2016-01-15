'use strict'

var Queue = require('bluebird-queue');
var Promise = require('bluebird');
var cluster = require('cluster');
var S = require('string');
var extend = require('node.extend');
var using = Promise.using;
var constants = require('./constants.js');
var path = require('path');

module.exports = function(mikser) {

	var scheduler = {
		pending: false
	};
	var debug = mikser.debug('scheduler');
	var renderStart = 0;
	var renderEnd = 0;
	var rendered = 0;

	scheduler.enqueueAll = function() {
		console.log('Enqueue all documents');
		return using(mikser.database.connect(), (database) => {
			return database.documents.find({destination: { $ne: false }},{ _id:1 }).toArray().then((documents) => {
				return Promise.map(documents, (document) => {
					return scheduler.enqueueDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
				});
			});
		});
	}

	scheduler.enqueueDocument = function (documentId, strategy) {
		if ((!mikser.options.renderInclude || (mikser.options.renderInclude && S(documentId).startsWith(mikser.options.renderInclude))) &&
			(!mikser.options.renderExclude || (mikser.options.renderExclude && !S(documentId).startsWith(mikser.options.renderExclude)))) {
			if (cluster.isMaster) {
				if (scheduler.processing && strategy >= constants.RENDER_STRATEGY_FORCE) {
					delete scheduler.documentsHistory[documentId];
				}
				if (scheduler.documentsHistory[documentId] >= strategy) {
					return Promise.resolve(false);
				}
				if (scheduler.documentsHistory[documentId] == undefined) mikser.server.refresh(documentId);
				scheduler.pending = true;
				scheduler.documentsHistory[documentId] = strategy;
				let renderDocument = function(cursor, documentId) {
					debug('Processing['+ cursor +']: ' + documentId);
					return mikser.broker.call('mikser.generator.renderDocument', mikser.workers[cursor], documentId, strategy).then(() => {
						delete scheduler.errors[documentId];
					}).catch((err) => {
						let error = err;
						if (typeof error == 'string'){
							error = {
								message: err, 
								toString: function() {
									return message;
								}
							}
							if (err.stack) error.message = err.stack.toString();
						}
						if (mikser.diagnostics.inspect(documentId)) {
							error.flushed = true;
						}
						scheduler.errors[documentId] = error;
					}).finally(() => {
						rendered++;
						debug('Document dequeued: ' + documentId);
						process.stdout.write('Rendered: ' + S(rendered).padRight(10) + '\x1b[0G');
					});
				};
				let action = renderDocument.bind(null, scheduler.cursor, documentId);
				scheduler.queue.add(action);
				debug('Document enqueued: ' + documentId);
				if (++scheduler.cursor === mikser.config.workers) scheduler.cursor = 0;
				return Promise.resolve(true);
			} else {
				return mikser.broker.call('mikser.scheduler.enqueueDocument', documentId, strategy);
			}
		}
		return Promise.resolve(false);
	};

	scheduler.enqueueLayout = function (layoutId, state) {
		if (cluster.isMaster) {
			state = state || { depth: 1, log: [], queue: [] };
			if (!scheduler.layoutsHistory[layoutId]) {
				scheduler.layoutsHistory[layoutId] = state;
				state.log.push(S('  ').times(state.depth).s + layoutId);
			}
			return using(mikser.database.connect(), (database) => {
				return database.documents.find({
					'meta.layout': layoutId,
					'pageNumber': 0
				}).toArray().then((documents) => {
					Array.prototype.push.apply(state.queue, documents);
					return Promise.resolve();
				}).then(() => {
					return database.layoutLinks.find({
						to: layoutId
					}).toArray().then((links) => {
						let documents = links.map((link) => {
							return {_id: link.from}
						});
						Array.prototype.push.apply(state.queue, documents);
						return Promise.resolve();
					});
				}).then(() => {
					let addToQueue = function(layout) {
						if (layout.meta.layout == layoutId) return true;
						if (layout.meta.blocks) {
							for(var blockName in layout.meta.blocks) {
								if (layout.meta.blocks[blockName] == layoutId) return true;
							}
						}
						return false;
					};
					return database.layouts.find({ 
						$or : [
							{'meta.layout': layoutId},
							{'meta.blocks': { $exists: true }}
						]
					}).toArray().then((layouts) => {
						let affected = Promise.resolve();
						for (let layout of layouts) {
							affected = affected.then(() => {
								if (addToQueue(layout)) {
									let affectedState = extend({}, state);
									affectedState.depth++;
									return scheduler.enqueueLayout(layout._id, affectedState);
								}
								return Promise.resolve();
							});
						}
						return affected;
					});
				});
			}).then(() => {
				if(state.depth == 1) {
					if (state.log.length) {						
						console.log('Layouts enqueued');
						for(let log of state.log) {
							console.log(log);
						}
					}
					return Promise.map(state.queue, (document) => {
						if (scheduler.processing) {
							delete scheduler.documentsHistory[document._id];
						}
						return scheduler.enqueueDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);						
					}).then(() => {
						return Promise.resolve(true);
					});
				}
				return Promise.resolve(true);
			});
		} else {
			return broker.call('mikser.scheduler.enqueueLayout', layoutId);
		}
	};

	scheduler.enqueuePlugin = function (pluginId) {
		if (cluster.isMaster) {
			return using(mikser.database.connect(), (database) => {
				return database.layouts.find({'meta.plugins': { $exists: true }}).toArray().then((layouts) => {
					return Promise.map(layouts, (layout) => {
						if (!layout.meta || !layout.meta.plugins) return Promise.resolve();
						for (let name of layout.meta.plugins) {
							let plugin = mikser.runtime.findPlugin(name);
							plugin = path.normalize(plugin);
							let localPlugin = path.join(mikser.config.pluginsFolder, pluginId);
							if (plugin == localPlugin) {
								return scheduler.enqueueLayout(layout._id);
							}
						}
						return Promise.resolve();
					});
				});
			});
		} else {
			return broker.call('mikser.scheduler.enqueuePlugin', pluginId);
		}
	};

	if (cluster.isMaster) {
		mikser.cli
			.option('-r, --render-include <path>', 'enables rendering only for documents inside path')
			.option('-R, --render-exclude <path>', 'enables rendering only for documents outside path')
			.init();
		mikser.options.renderInclude = mikser.cli.renderInclude;
		mikser.options.renderExclude = mikser.cli.renderExclude;

		scheduler.documentsHistory = {};
		scheduler.layoutsHistory = {};
		scheduler.errors = {};
		scheduler.cursor = 0;

		scheduler.queue = new Queue({concurrency: mikser.config.workers * 2});

		scheduler.enqueueErrors = function() {
			var errors = [];
			for (let documentId in scheduler.errors) {
				errors.push(scheduler.enqueueDocument(documentId, constants.RENDER_STRATEGY_STANDALONE));
			}
			return Promise.all(errors);
		}

		scheduler.process = function () {
			if (!scheduler.pending) return Promise.resolve();
			return mikser.startWorkers().then(() => {
				if (scheduler.processing) return scheduler.processing;
				if (!scheduler.pending) {
					console.log('Rendered: 0');
					return mikser.stopWorkers();
				}
				scheduler.processing = mikser.debug.resetWatch().then(() => {
					mikser.runtime.markDirty();
					renderStart = Math.floor(Date.now() / 1000);					
					return scheduler.enqueueErrors();
				}).then(() => {
					rendered = 0;
					return scheduler.queue.start().finally(() => {
						scheduler.pending = false;
						renderEnd = Math.floor(Date.now() / 1000);
						let flushed = mikser.diagnostics.flush();
						for (let runtimeErrorId of flushed) {
							if (!scheduler.errors[runtimeErrorId]) {
								let runtimeError = {
									message: 'Runtime error',
									flushed: true
								};
								scheduler.errors[runtimeErrorId] = runtimeError;
							}
						}
						console.log('Render time:', renderEnd - renderStart);
						console.log('Rendered:', rendered);
						let errorCount = Object.keys(scheduler.errors).length;
						if (errorCount == 0) {
							mikser.runtime.markClean();
						}
						else {
							for (let errorId in scheduler.errors) {
								let error = scheduler.errors[errorId];
								if (!error.flushed) {
									console.log('-', errorId, error.message);
								}
							}
							console.log('Errors:', errorCount);
						}
						return mikser.emit('mikser.scheduler.renderFinished').then(() => {
							return mikser.runtime.clearCache().then(() => {
								scheduler.documentsHistory = {};
								scheduler.layoutsHistory = {};

								return mikser.stopWorkers().then(mikser.tools.build).then(() => {
									delete scheduler.processing;
								});
							});							
						})
					});
				});
				return scheduler.processing;
			});
		};
	}

	mikser.scheduler = scheduler;
	return Promise.resolve(mikser);
}