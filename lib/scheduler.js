'use strict'

var Promise = require('bluebird');
var Queue = require('promise-queue');
Queue.configure(Promise);
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
		return mikser.database.documents.find({destination: { $ne: false }},{ _id:1, render:1 }).toArray().then((documents) => {
			return Promise.map(documents, (document) => {
				if (document.render !== false) {
					return scheduler.scheduleDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
				}
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
					var renderDocument;
					let useWorker = cursor != undefined && mikser.workers.length;
					if (useWorker) {
						debug('Processing['+ cursor +']: ' + documentId);
						renderDocument = mikser.broker.call('mikser.generator.renderDocument', mikser.workers[cursor], documentId, strategy);						
					} else {
						debug('Processing: ' + documentId);
						renderDocument = mikser.generator.renderDocument(documentId, strategy);
					}
					return renderDocument.then(() => {
						delete scheduler.errors[documentId];
						return mikser.emit('mikser.scheduler.renderedDocument', documentId);
					}).catch((err) => {
						mikser.diagnostics.log('error', err);
						scheduler.errors[documentId] = err;							
					}).then(() => {
						debug('Document dequeued: ' + documentId);
					});
				};
	
				let emit = mikser.database.findDocument({_id: documentId}).then((document) => {
					return mikser.emit('mikser.scheduler.scheduleDocument', document, strategy);
				})
				return emit.then(() => {
					mikser.server.isHot('documents', documentId).then((hot) => {
						let action = renderDocument.bind(null, documentId, ++scheduler.cursor % mikser.config.workers);
						if (hot) {
							debug('Document unshifted: ' + documentId);
							mikser.queue.unshift(documentId, action());					
						} else {
							debug('Document enqueued: ' + documentId);
							mikser.queue.push(documentId, action);					
						}
						return Promise.resolve(true);
					});
				});
			} else {
				return mikser.broker.call('mikser.scheduler.scheduleDocument', documentId, strategy);
			}
		}
		return Promise.resolve(false);
	};

	scheduler.scheduleLayout = function (layoutId, state) {
		if (cluster.isMaster) {
			let emit = Promise.resolve();
			if (!state) {
				emit = mikser.database.findLayout({_id: layoutId}).then((layout) => {
					return mikser.emit('mikser.scheduler.scheduleLayout', layout);
				})
			}
			state = state || { depth: 1, log: [], documents: [], views: [] };
			if (!scheduler.layoutsHistory[layoutId]) {
				scheduler.layoutsHistory[layoutId] = state;
				state.log.push(S('  ').times(state.depth).s + layoutId);
			}
			return emit.then(() => {
				return mikser.database.documents.find({
					'meta.layout': layoutId,
					'pageNumber': 0
				}).toArray().then((documents) => {
					Array.prototype.push.apply(state.documents, documents);
					return Promise.resolve();
				}).then(() => {
					return mikser.database.layoutLinks.find({
						to: layoutId
					}).toArray().then((links) => {
						let documents = links.map((link) => {
							return {_id: link.from}
						});
						Array.prototype.push.apply(state.documents, documents);
						return Promise.resolve();
					});
				})	
			}).then(() => {
				return mikser.database.views.find({
					'meta.layout': layoutId,
				}).toArray().then((views) => {
					Array.prototype.push.apply(state.views, views);
					return Promise.resolve();
				});			
			}).then(() => {
				let addToQueue = function(layout) {
					if (layout.meta.layout == layoutId) return true;
					if (layout.meta.partials) {
						for(var name in layout.meta.partials) {
							if (layout.meta.partials[name] == layoutId) return true;
						}
					}
					if (layout.meta.blocks) {
						for(var name in layout.meta.blocks) {
							if (layout.meta.blocks[name] == layoutId) return true;
						}
					}
					return false;
				};
				return mikser.database.layouts.find({ 
					$or : [
						{'meta.layout': layoutId},
						{'meta.partials': { $exists: true }},
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
			}).then(() => {
				if(state.depth == 1) {
					if (state.log.length) {						
						console.log('Layouts enqueued');
						for(let log of state.log) {
							console.log(log);
						}
					}
					return Promise.map(state.documents, (document) => {
						if (scheduler.processing) {
							delete scheduler.documentsHistory[document._id];
						}
						return scheduler.scheduleDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);						
					}).then(() => {
						return Promise.map(state.views, (view) => {
							return mikser.emit('mikser.scheduler.viewInvalidated', view._id);
						});
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
			return mikser.database.layouts.find({'meta.plugins': { $exists: true }}).toArray().then((layouts) => {
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
			if (!scheduler.pending) {
				console.log('Rendered: 0');
				return Promise.resolve(false);
			}
			return mikser.startWorkers().then(() => {
				if (scheduler.processing) return scheduler.processing;

				scheduler.processing = mikser.debug.resetWatch().then(() => {
					mikser.runtime.markDirty();
					return scheduler.enqueueErrors();
				}).then(() => {
					return mikser.observer.inspect();
				}).then(() => {
					return mikser.emit('mikser.scheduler.renderStarted');
				}).then(() => {
					return mikser.queue.start().finally(() => {
						let errorCount = Object.keys(scheduler.errors).length;
						if (errorCount == 0) {
							mikser.runtime.markClean();
						}
						else {
							mikser.diagnostics.log('error','Generation errors:', errorCount);
						}							

						scheduler.pending = false;
						return mikser.runtime.clearCache().then(() => {
							scheduler.documentsHistory = {};
							scheduler.layoutsHistory = {};

							return mikser.stopWorkers().then(mikser.tools.build).then(() => {
								delete scheduler.processing;
								setTimeout(() => {
									mikser.emit('mikser.scheduler.renderFinished');
								}, 1000);
								return Promise.resolve(true);
							});
						});	
					});
				});
				return scheduler.processing;
			});
		};
	}

	mikser.scheduler = scheduler;
	return Promise.resolve(mikser);
}