'use strict'
var cluster = require('cluster');
var Promise = require("bluebird");
var hasha = require('hasha');
var JSON5 = require('json5');

module.exports = function(mikser) {
	mikser.observer = {};

	mikser.observer.close = function(entity) {
		return Promise.join(
			mikser.database.collection('entitiesObserver').remove({_id: entity._id}),
			mikser.database.collection('dataObserver').remove({_id: entity._id})
		);
	}

	mikser.observer.observeEntities = function(entity, subject) {
		return mikser.database.collection('entitiesObserver').save({
			_id: entity.collection + entity,
			subject: subject
		});
	}

	mikser.observer.observeData = function(entity, subject, data) {
		subject 
		return mikser.database.collection('entitiesObserver').save({
			_id: entity.collection + entity,
			subject: subject,
			checksum: hasha(JSON5.stringify(subject), {algorithm: 'md5'})
		});
	}

	if (cluster.isMaster) {
		function observe(entity) {
			return Promise.resolve();
		} 

		mikser.on('mikser.manager.importDocument', observe);
		mikser.on('mikser.manager.importLayout', observe);
		mikser.on('mikser.manager.importView', observe);
	}
	return Promise.resolve(mikser);
}