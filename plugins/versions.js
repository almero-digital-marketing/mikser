'use strict'
let Promise = require('bluebird');
var _ = require('lodash');
let path  = require('path');

module.exports = function (mikser, context) {
	let debug = mikser.debug('versions');
	let versions;
	if (context.entity.meta && context.entity.meta.versions) {
		versions = context.entity.meta.versions;
	}
	else if (context.layout.meta && context.layout.meta.versions) {
		versions = context.layout.meta.versions;
	}

	if (versions) {
		context.version = function(name) {
			if (context.entity.canonical) {
				return context.entity.canonical + '/' + name;
			} else {				
				return context.entity.meta.href + '/' + name;
			}
		}


		return Promise.map(_.keys(versions), (name) => {
			let version = _.cloneDeep(context.entity);
			delete version.meta.versions;
			version._id += "." + name;
			version.meta.href = context.entity.meta.href + '/' + name;
			if (mikser.config.cleanUrls) {
				version.destination = version.destination.replace('index.html', name + '/index.html');
			} else {
				let dir = path.dirname(version.destination);
				let basename = path.basename(version.destination);
				basename = basename.replace('.', '.' + name + '.');
				version.destination = path.join(dir, basename);
			}
			version.meta.layout = versions[name];
			version.canonical = context.entity.meta.href;
			version.url = mikser.utils.getUrl(version.destination);
			debug('Adding', '[' + name + ']', 'version for:', context.entity._id);
			return mikser.runtime.importDocument(version, context.strategy, context.database);
		});
	} else {
		return Promise.resolve();
	}
}