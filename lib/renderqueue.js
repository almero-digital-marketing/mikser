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

	renderqueue.enqueueAll = function() {
		console.log('Enqueue all documents');
		return using(mikser.database.connect(), (database) => {
			return database.documents.find({destination: { $ne: false }},{ _id:1 }).toArray().then((documentIds) => {
				let renderDocuments = documentIds.map((document) => {
					return renderqueue.enqueueDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
				});
				return Promise.all(renderDocuments);
			});
		});
	}

	renderqueue.enqueueDocument = function (documentId, strategy, finished) {
		if ((!mikser.options.renderInclude || (mikser.options.renderInclude && S(documentId).startsWith(mikser.options.renderInclude))) &&
			(!mikser.options.renderExclude || (mikser.options.renderExclude && !S(documentId).startsWith(mikser.options.renderExclude)))) {
			if (cluster.isMaster) {
				if (!renderqueue.processing) mikser.debug.resetWatch();
				if (renderqueue.pendingDocuments[documentId]) return Promise.resolve(false);

				let shouldRender = false;
				let alreadyIn = renderqueue.queue[documentId] != undefined;
				if (strategy >= constants.RENDER_STRATEGY_FORCE) {
					renderqueue.queue[documentId] = strategy;
					if (!renderqueue.history[documentId]) {
						renderqueue.history[documentId] = constants.RENDER_STRATEGY_FULL;
					}
					debug('Force: ' + documentId);
					shouldRender = true;	
				}
				else if (!renderqueue.history[documentId]) {
					renderqueue.history[documentId] = strategy;
					renderqueue.queue[documentId] = strategy;	
					debug('Not in history: ' + documentId);
					shouldRender = true;	
				}
				else if (strategy > renderqueue.history[documentId] && 
					renderqueue.history[documentId] != constants.RENDER_STRATEGY_DONE) {
					debug('Not done and important: ' + documentId);
					renderqueue.history[documentId] = strategy;
					renderqueue.queue[documentId] = strategy;
					shouldRender = true;	
				}
				if (shouldRender) {
					let pending = Object.keys(renderqueue.queue).length;
					if (pending == 1) {
						rendered = 0;
						mikser.runtime.markDirty();
						renderStart = Math.floor(Date.now() / 1000);
					}
					let enqueuePromise = function(cursor, documentId) {
						renderqueue.history[documentId] = constants.RENDER_STRATEGY_DONE;
						debug('Processing['+ cursor +']: ' + documentId);
						if (!renderqueue.queue[documentId]) {
							debug('Skip render: ' + documentId);
							if (finished) finished(err);
							return Promise.resolve(documentId);
						}
						return new Promise((resolve, reject) => {
							mikser.diagnostics.start(documentId);
							renderqueue.pendingDocuments[documentId] = function(err) {
								mikser.diagnostics.end(documentId);
								
								if (finished) finished(err);
								delete renderqueue.queue[documentId];
								delete renderqueue.pendingDocuments[documentId];
								debug('Document dequeued: ' + documentId);
								let pending = Object.keys(renderqueue.queue).length;
								rendered++;
								
								if (err) {
									let error = err;
									if (typeof error == 'string'){
										error = {
											message: err, 
											toString: function() {
												return message;
											}
										}									
									}
									if (mikser.diagnostics.inspect(documentId)) {
										error.flushed = true;
									}
									renderqueue.errors[documentId] = error;
								}
								else if (renderqueue.errors[documentId]) {
									delete renderqueue.errors[documentId];
								}

								if (pending == 0) {
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

									renderqueue.clearHistory();
									renderqueue.onComplete();
								}
								else {
									process.stdout.write('Pending: ' + S(pending).padRight(10) + '\x1b[0G');
								}
								resolve(documentId);
							};
							mikser.send({
								call: 'renderengine.renderDocument',
								documentId: documentId,
								strategy: renderqueue.queue[documentId]
							}, cursor);
						});
					};
					let queue = renderqueue.workerQueue;
					let action = enqueuePromise.bind(null, renderqueue.cursor, documentId);
					if (strategy > constants.RENDER_STRATEGY_FULL) {
						queue = renderqueue.priorityQueue;
					}
					if (renderqueue.processing) {
						queue.addNow(action);
					}
					else {
						queue.add(action);
					}
					debug('Document enqueued: ' + documentId);
					if (++renderqueue.cursor === mikser.config.workers) renderqueue.cursor = 0;
					return Promise.resolve(true);
				}
				else {
					return Promise.resolve(false);				
				}
			}
			else {
				mikser.send({ 
					call: 'renderqueue.enqueueDocument',
					documentId: documentId,
					strategy: strategy
				});
			}
		}
		return Promise.resolve();
	};

	renderqueue.enqueueLayout = function (layoutId, state) {
		if (cluster.isMaster) {
			state = state || { depth: 1, log: [], queue: [] };
			if (!renderqueue.historyLayouts[layoutId]) {
				renderqueue.historyLayouts[layoutId] = state;
				state.log.push(S('  ').times(state.depth).s + layoutId);
			}
			return using(mikser.database.connect(), (database) => {
				return database.documents.find({
					'meta.layout': layoutId
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
					state.queue.sort((a, b) => {
						let ai = mikser.server.history.indexOf(a.url);
						let bi = mikser.server.history.indexOf(b.url);
						if (ai > bi) {
							return -1;
						}
						if (ai < bi) {
							return 1;
						}
						return 0;
					});
					let renderDocuments = state.queue.map((document) => {
						return renderqueue.enqueueDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
					});
					console.log('Layouts enqueued');
					for(let log of state.log) {
						console.log(log);
					}
					return Promise.all(renderDocuments).then(() => {
						return layoutId;
					});
				}
				return Promise.resolve(true);		
			});
		}
		else {
			mikser.send({ 
				call: 'renderqueue.enqueueLayout',
				layoutId: layoutId
			});
		}
		return Promise.resolve();
	};

	renderqueue.enqueuePlugin = function (pluginId) {
		return using(mikser.database.connect(), (database) => {
			return database.layouts
				.find({'meta.plugins': { $exists: true }}).toArray()
				.then((layouts) => {
					let renderLayouts = layouts.map((layout) => {
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
					return Promise.all(renderLayouts);
				});
		}).then(() => {
			return Promise.resolve(true);		
		});
	};

	return new Promise((resolve, reject) => {
		if (cluster.isMaster) {
			mikser.cli
				.option('-r, --render-include <path>', 'enables rendering only for documents inside path')
				.option('-R, --render-exclude <path>', 'enables rendering only for documents outside path')
				.init();
			mikser.options.renderInclude = mikser.cli.renderInclude;
			mikser.options.renderExclude = mikser.cli.renderExclude;

			renderqueue.queue = {};
			renderqueue.history = {};
			renderqueue.historyLayouts = {};
			renderqueue.pendingDocuments = {};
			renderqueue.errors = {};
			renderqueue.cursor = 0;
			renderqueue.onComplete = () => {};
			renderqueue.onError = () => {};

			renderqueue.workerQueue = new Queue({concurrency: mikser.config.workers});
			renderqueue.priorityQueue = new Queue({concurrency: mikser.config.workers});

			renderqueue.clearHistory = function() {
				renderqueue.history = {};
				renderqueue.historyLayouts = {};
			}

			renderqueue.enqueueErrors = function() {
				var errors = [];
				for (let documentId in renderqueue.errors) {
					errors.push(renderqueue.enqueueDocument(documentId, constants.RENDER_STRATEGY_STANDALONE));
				}
				return Promise.all(errors);
			}

			renderqueue.process = function () {
				return mikser.startWorkers().then(() => {
					let pending = Object.keys(renderqueue.queue).length;
					if (renderqueue.processing || !pending) {
						if (!pending) {
							console.log('Rendered: 0');
							return mikser.stopWorkers();
						}
						return Promise.resolve();
					}
					return renderqueue.enqueueErrors().then(() => {
						if (!renderqueue.processing) {
							console.log('Processing queue');
							renderqueue.processing = new Promise((resolve, reject) => {
								renderqueue.onComplete = resolve;
								renderqueue.onError = reject;
							});
							Promise.all([
								renderqueue.priorityQueue.start(), 
								renderqueue.workerQueue.start()
							]).catch((err) => {
								renderqueue.onError(err);
							})
							return renderqueue.processing.finally(() => {
								mikser.runtime.clearCache();
								delete renderqueue.processing;
								renderqueue.onComplete = () => {};
								renderqueue.onError = () => {};
								mikser.stopWorkers();
							});					
						}
					});
				});
			};

			mikser.receive({
				'renderqueue.enqueueDocument': (message) => renderqueue.enqueueDocument(message.documentId, message.strategy),
				'renderqueue.enqueueLayout': (message) => renderqueue.enqueueLayout(message.layoutId),
				'renderengine.documentRendered': (message) => {
					if (renderqueue.pendingDocuments[message.documentId]) 
						renderqueue.pendingDocuments[message.documentId](message.error);
				}
			});
		}

		mikser.renderqueue = renderqueue;
		resolve(mikser);
	});
}	
module.exports = init;