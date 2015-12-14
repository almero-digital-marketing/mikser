'use strict'

var Queue = require('bluebird-queue');
var Promise = require('bluebird');
var cluster = require('cluster');
var S = require('string');
var extend = require('node.extend');
var using = Promise.using;
var constants = require('./constants.js');
var path = require('path');

function init(mikser) {

	var renderqueue = {};
	var debug = mikser.debug('renderqueue');
	var renderStart = 0;
	var renderEnd = 0;
	var rendered = 0;
	var pending = false;

	renderqueue.enqueueAll = function() {
		console.log('Enqueue all documents');
		return using(mikser.database.connect(), (database) => {
			return database.documents.find({destination: { $ne: false }},{ _id:1 }).toArray().then((documents) => {
				return Promise.map(documents, (document) => {
					return renderqueue.enqueueDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
				});
			});
		});
	}

	renderqueue.enqueueDocument = function (documentId, strategy) {
		if ((!mikser.options.renderInclude || (mikser.options.renderInclude && S(documentId).startsWith(mikser.options.renderInclude))) &&
			(!mikser.options.renderExclude || (mikser.options.renderExclude && !S(documentId).startsWith(mikser.options.renderExclude)))) {
			if (cluster.isMaster) {
				pending = true;
				if (renderqueue.documentsHistory[documentId] >= strategy) {
					return Promise.resolve(false);
				}
				renderqueue.documentsHistory[documentId] = strategy;
				mikser.server.refresh(documentId);
				let renderDocument = function(cursor, documentId) {
					debug('Processing['+ cursor +']: ' + documentId);
					return mikser.broker.call('mikser.renderengine.renderDocument', mikser.workers[cursor], documentId, strategy).then(() => {
						delete renderqueue.errors[documentId];
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
						renderqueue.errors[documentId] = error;
					}).finally(() => {
						rendered++;
						debug('Document dequeued: ' + documentId);
						process.stdout.write('Rendered: ' + S(rendered).padRight(10) + '\x1b[0G');
					});
				};
				let action = renderDocument.bind(null, renderqueue.cursor, documentId);
				renderqueue.queue.add(action);
				debug('Document enqueued: ' + documentId);
				if (++renderqueue.cursor === mikser.config.workers) renderqueue.cursor = 0;
				return Promise.resolve(true);
			} else {
				return mikser.broker.call('mikser.renderqueue.enqueueDocument', documentId, strategy);
			}
		}
		return Promise.resolve(false);
	};

	renderqueue.enqueueLayout = function (layoutId, state) {
		if (cluster.isMaster) {
			state = state || { depth: 1, log: [], queue: [] };
			if (!renderqueue.layoutsHistory[layoutId]) {
				renderqueue.layoutsHistory[layoutId] = state;
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
									return renderqueue.enqueueLayout(layout._id, affectedState);
								}
								return Promise.resolve();
							});
						}
						return affected;
					});
				});
			}).then(() => {
				if(state.depth == 1) {
					console.log('Layouts enqueued');
					for(let log of state.log) {
						console.log(log);
					}
					return Promise.map(state.queue, (document) => {
						return renderqueue.enqueueDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);						
					}).then(() => {
						return Promise.resolve(true);
					});
				}
				return Promise.resolve(true);
			});
		} else {
			return broker.call('mikser.renderqueue.enqueueLayout', layoutId);
		}
	};

	renderqueue.enqueuePlugin = function (pluginId) {
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
								return renderqueue.enqueueLayout(layout._id);
							}
						}
						return Promise.resolve();
					});
				});
			});
		} else {
			return broker.call('mikser.renderqueue.enqueuePlugin', pluginId);
		}
	};

	if (cluster.isMaster) {
		mikser.cli
			.option('-r, --render-include <path>', 'enables rendering only for documents inside path')
			.option('-R, --render-exclude <path>', 'enables rendering only for documents outside path')
			.init();
		mikser.options.renderInclude = mikser.cli.renderInclude;
		mikser.options.renderExclude = mikser.cli.renderExclude;

		renderqueue.documentsHistory = {};
		renderqueue.layoutsHistory = {};
		renderqueue.errors = {};
		renderqueue.cursor = 0;

		renderqueue.queue = new Queue({concurrency: mikser.config.workers * 2});

		renderqueue.enqueueErrors = function() {
			var errors = [];
			for (let documentId in renderqueue.errors) {
				errors.push(renderqueue.enqueueDocument(documentId, constants.RENDER_STRATEGY_STANDALONE));
			}
			return Promise.all(errors);
		}

		renderqueue.process = function () {
			return mikser.startWorkers().then(() => {
				if (renderqueue.processing) return renderqueue.processing;
				if (!pending) {
					console.log('Rendered: 0');
					return mikser.stopWorkers();
				}
				renderqueue.processing = mikser.debug.resetWatch().then(() => {
					mikser.runtime.markDirty();
					renderStart = Math.floor(Date.now() / 1000);					
					return renderqueue.enqueueErrors();
				}).then(() => {
					rendered = 0;
					return renderqueue.queue.start().finally(() => {
						pending = false;
						renderEnd = Math.floor(Date.now() / 1000);
						let flushed = mikser.diagnostics.flush();
						for (let runtimeErrorId of flushed) {
							if (!renderqueue.errors[runtimeErrorId]) {
								let runtimeError = {
									message: 'Runtime error',
									flushed: true
								};
								renderqueue.errors[runtimeErrorId] = runtimeError;
							}
						}
						console.log('Render time:', renderEnd - renderStart);
						console.log('Rendered:', rendered);
						let errorCount = Object.keys(renderqueue.errors).length;
						if (errorCount == 0) {
							mikser.runtime.markClean();
						}
						else {
							for (let errorId in renderqueue.errors) {
								let error = renderqueue.errors[errorId];
								if (!error.flushed) {
									console.log('-', errorId, error.message);
								}
							}
							console.log('Errors:', errorCount);
						}
						mikser.emit('mikser.renderqueue.renderFinished');
						return mikser.runtime.clearCache().then(() => {
							renderqueue.documentsHistory = {};
							renderqueue.layoutsHistory = {};

							delete renderqueue.processing;
							return mikser.stopWorkers();
						});
					});
				});
				return renderqueue.processing;
			});
		};
	}

	mikser.renderqueue = renderqueue;
	return Promise.resolve(mikser);
}	
module.exports = init;