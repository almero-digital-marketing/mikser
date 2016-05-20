'use strict'
var cluster = require('cluster');
var Promise = require("bluebird");
var hasha = require('hasha');
var JSON5 = require('json5');
var constants = require('./constants.js');

module.exports = function(mikser) {
	mikser.observer = {};
	var debug = mikser.debug('observer');

	mikser.observer.close = function(entity) {
		return Promise.join(
			mikser.database.collection('entitiesObserver').remove({_id: entity.collection + entity._id}),
			mikser.database.collection('dataObserver').remove({_id: entity.collection + entity._id})
		);
	}

	mikser.observer.observeEntities = function(entity, subject) {
		if (!subject || !subject.length) return Promise.resolve();
		debug('Entity:', entity.collection + entity._id, '->', subject.map((item) => item.lang + ':' + item.link).join(','));
		return mikser.database.collection('entitiesObserver').save({
			_id: entity.collection + entity._id,
			entity: {
				_id: entity._id,
				collection: entity.collection
			},
			subject: subject,
			links: subject.map((item) => item.link)
		});
	}

	mikser.observer.observeData = function(entity, subject, data) {
		// return mikser.database.collection('dataObserver').save({
		// 	_id: entity.collection + entity._id,
		// 	subject: JSON5.stringify(subject),
		// 	entity: {
		// 		_id: entity._id,
		// 		collection: entity.collection
		// 	},
		// 	checksum: hasha(JSON5.stringify(data), {algorithm: 'md5'})
		// });
		return Promise.resolve();
	}

	if (cluster.isMaster) {
		var cache = {};
		function observe(entity) {
			return mikser.database.collection('entitiesObserver').find({
				links: { $in: [entity.meta.href] }
			}).toArray().then((observations) => {
				return Promise.map(observations, (observation) => {
					if (observation.subject.find((item) => item.lang == entity.meta.lang)) {
						debug('Entity observed:', entity.collection + entity._id, '->', observation._id);
						return mikser.emit('mikser.observer.observe', observation.entity).then(() => {
							if (observation.entity.collection == 'documents') {
								return mikser.scheduler.scheduleDocument(observation.entity._id, constants.RENDER_STRATEGY_STANDALONE);
							}							
						});
					}
				});
			}).then(() => {
			});
		} 

		var started;
		mikser.on('mikser.scheduler.renderFinished', () => {
			if (!started) {
				mikser.on('mikser.manager.importDocument', observe);
				mikser.on('mikser.manager.importLayout', observe);
				mikser.on('mikser.manager.importView', observe);
				started = true;				
			}
		});
	}
	return Promise.resolve(mikser);
}