'use strict'
var cluster = require('cluster');
var Promise = require("bluebird");
var hasha = require('hasha');
var JSON5 = require('json5');
var constants = require('./constants.js');

module.exports = function(mikser) {
	mikser.observer = {
	};
	var debug = mikser.debug('observer');

	function normalize(data) {
		return data.map((document) => document.meta);
	}

	mikser.observer.close = function(entity) {
		return Promise.join(
			mikser.database.collection('entitiesObserver').remove({
				entity: {
					_id: entity._id,
					collection: entity.collection
				}
			}),
			mikser.database.collection('dataObserver').remove({
				entity: {
					_id: entity._id,
					collection: entity.collection
				}
			})
		);
	}

	mikser.observer.observeEntities = function(entity, liveLinks) {
		if (!liveLinks || !liveLinks.length) return Promise.resolve();
		debug('Entity:', entity.collection + entity._id, '->', liveLinks.map((item) => item.lang + ':' + item.link).join(','));
		return mikser.database.collection('entitiesObserver').save({
			entity: {
				_id: entity._id,
				collection: entity.collection
			},
			liveLinks: liveLinks,
			links: liveLinks.map((item) => item.link)
		});
	}

	mikser.observer.observeData = function(entity, queryInfo, data) {
		debug('Data:', entity.collection + entity._id, JSON5.stringify(queryInfo));
		return mikser.database.collection('dataObserver').save({
			queryInfo: JSON5.stringify(queryInfo),
			entity: {
				_id: entity._id,
				collection: entity.collection
			},
			checksum: hasha(JSON5.stringify(data.map((document) => {
				return {
					meta: document.meta,
					content: document.content					
				}
			})), {algorithm: 'md5'})
		});
	}

	if (cluster.isMaster) {
		function inspectEntity(entity) {
			return mikser.database.collection('entitiesObserver').find({
				links: { $in: [entity.meta.href] }
			}).toArray().then((observations) => {
				return Promise.map(observations, (observation) => {
					if (observation.liveLinks.find((item) => item.lang == entity.meta.lang)) {
						debug('Entity observed:', entity.collection + entity._id, '->', observation._id);
						return mikser.emit('mikser.observer.observe', observation.entity).then(() => {
							if (observation.entity.collection == 'documents') {
								return mikser.scheduler.scheduleDocument(observation.entity._id, constants.RENDER_STRATEGY_STANDALONE);
							}							
						});
					}
				});
			});
		}

		function inspectData() { 
			return mikser.database.collection('dataObserver').distinct('queryInfo').then((observations) => { 
				debug('Data observers:', observations); 
				return Promise.map(observations, (observation) => { 
					let queryInfo = JSON5.parse(observation); 
					return mikser.database.findDocuments(queryInfo.query, queryInfo.orderBy).then((data) => { 
						let checksum = hasha(JSON5.stringify(data.map((document) => { 
							return { 
								meta: document.meta, 
								content: document.content                 
							} 
						})), {algorithm: 'md5'}); 
						return mikser.database.collection('dataObserver').find({ 
							queryInfo: observation, 
							checksum: { $ne: checksum } 
						}).toArray().then((changes) => { 
							return Promise.map(changes, (change) => { 
								debug('Data observed:', change.entity.collection + change.entity._id); 
								return mikser.emit('mikser.observer.observe', change.entity).then(() => { 
									if (change.entity.collection == 'documents') { 
										return mikser.scheduler.scheduleDocument(change.entity._id, constants.RENDER_STRATEGY_STANDALONE); 
									}
								}); 
							}); 
						}); 
					}); 
				}); 
		  	}); 
		}
		
		mikser.observer.inspect = function() {
			return Promise.resolve().then(() => {
				return mikser.database.findDocuments({'meta.live' : true}).then((documents) => {
					return Promise.map(documents, (document) => {
						return mikser.scheduler.scheduleDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
					});
				})				
			}).then(() => {
				return mikser.database.findLayouts({'meta.live' : true}).then((layouts) => {
					return Promise.map(layouts, (layout) => {
						return mikser.scheduler.scheduleLayout(layout._id);
					});
				})				
			}).then(() => {
				for (let documentId in mikser.scheduler.documentsHistory) {
					if (mikser.scheduler.documentsHistory[documentId] == constants.RENDER_STRATEGY_FORCE) {
						return inspectData();					
					}
				}				
			});
		}

		var inspectEntitiesInitialized;
		mikser.observer.start = function() {
			if (!inspectEntitiesInitialized) {
				mikser.on('mikser.manager.importDocument', inspectEntity);
				mikser.on('mikser.manager.importLayout', inspectEntity);
				mikser.on('mikser.manager.importView', inspectEntity);
				inspectEntitiesInitialized = true;
			}				
		}
	}
	return Promise.resolve(mikser);
}