'use strict'

var Promise = require('bluebird');
var cluster = require('cluster');
var S = require('string');
var extend = require('node.extend');
var using = Promise.using;
var constants = require('./constants.js');
var path = require('path');
var _ = require('lodash');

module.exports = function(mikser) {

	var scheduler = {
		pending: false
	};
	var debug = mikser.debug('scheduler');

	scheduler.scheduleAllDocuments = function() {
		console.log('Enqueue all documents');
		return using(mikser.database.connect(), (database) => {
			return database.documents.find({destination: { $ne: false }},{ _id:1 }).toArray().then((documents) => {
				return Promise.map(documents, (document) => {
					return scheduler.scheduleDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
				});
			});
		});
	}

	scheduler.scheduleDocument = function (documentId, strategy) {
		if ((!mikser.options.renderInclude || (mikser.options.renderInclude && documentId.indexOf(mikser.options.renderInclude) > -1)) &&
			(!mikser.options.renderExclude || (mikser.options.renderExclude && documentId.indexOf(mikser.options.renderExclude) < 0))) {
			if (cluster.isMaster) {
				if (scheduler.processing && strategy >= constants.RENDER_STRATEGY_FORCE) {
					delete scheduler.documentsHistory[documentId];
				}
				if (scheduler.documentsHistory[documentId] >= strategy) {
					return Promise.resolve(false);
				}
				
				scheduler.pending = true;
				scheduler.documentsHistory[documentId] = strategy;
				let renderDocument = function(documentId, cursor) {
					debug('Processing['+ cursor +']: ' + documentId);
					var renderDocument;
					if (cursor != undefined) {
						renderDocument = mikser.broker.call('mikser.generator.renderDocument', mikser.workers[cursor], documentId, strategy);						
					} else {
						renderDocument = mikser.generator.renderDocument(documentId, strategy);
					}
					return renderDocument.then(() => {
						delete scheduler.errors[documentId];
						return mikser.emit('mikser.scheduler.renderedDocument', documentId);
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
						debug('Document dequeued: ' + documentId);
					});
				};

				let action = renderDocument.bind(null, documentId, ++scheduler.cursor % mikser.config.workers);
				if (mikser.plugins.livereload && mikser.plugins.livereload.isLive(documentId)) {
					mikser.queue.unshift(documentId, action());					
				} else {
					mikser.queue.push(documentId, action);					
				}
				debug('Document enqueued: ' + documentId);
				return Promise.resolve(true);
			} else {
				return mikser.broker.call('mikser.scheduler.scheduleDocument', documentId, strategy);
			}
		}
		return Promise.resolve(false);
	};

	scheduler.scheduleLayout = function (layoutId, state) {
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
									return scheduler.scheduleLayout(layout._id, affectedState);
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
						return scheduler.scheduleDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);						
					}).then(() => {
						return Promise.resolve(true);
					});
				}
				return Promise.resolve(true);
			});
		} else {
			return broker.call('mikser.scheduler.scheduleLayout', layoutId);
		}
	};

	scheduler.schedulePlugin = function (pluginId) {
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
								return scheduler.scheduleLayout(layout._id);
							}
						}
						return Promise.resolve();
					});
				});
			});
		} else {
			return broker.call('mikser.scheduler.schedulePlugin', pluginId);
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

		scheduler.enqueueErrors = function() {
			var errors = [];
			for (let documentId in scheduler.errors) {
				errors.push(scheduler.scheduleDocument(documentId, constants.RENDER_STRATEGY_STANDALONE));
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
				// mikser.watcher.stop();
				// mikser.watcher.stop('reload');
				scheduler.processing = mikser.debug.resetWatch().then(() => {
					mikser.runtime.markDirty();
					return scheduler.enqueueErrors();
				}).then(() => {
					return mikser.queue.start().finally(() => {
						scheduler.pending = false;
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
							mikser.diagnostics.log('error','Generation errors:', errorCount);
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