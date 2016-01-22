'use strict'
let Promise = require('bluebird');
var _ = require('lodash');

module.exports = function (mikser, context) {
	let debug = mikser.debug('versions');
	let versions;
	if (context.document.meta && context.document.meta.versions) {
		versions = context.document.meta.versions;
	}
	else if (context.layout.meta && context.layout.meta.versions) {
		versions = context.layout.meta.versions;
	}

	if (versions) {
		context.version = function(name) {
			if (context.document.canonical) {
				return context.document.canonical + '/' + name;
			} else {				
				return context.document.meta.href + '/' + name;
			}
		}

		return Promise.map(_.keys(versions), (name) => {
			let version = _.cloneDeep(context.document);
			version._id += "." + name;
			version.meta.href = context.document.meta.href + '/' + name;
			if (mikser.config.cleanUrls) {
				version.destination = version.destination.replace('index.html', name + '/index.html');
			} else {
				let dir = path.dirname(version.destination);
				let basename = path.basename(version.destination);
				basename = basename.replace('.', '.' + name + '.');
				version.destination = path.join(dir, basename);
			}
			version.meta.layout = versions[name];
			version.canonical = context.document.meta.href;
			version.url = mikser.manager.getUrl(version.destination);
			return mikser.runtime.importDocument(version, context.strategy, context.database);
		});
	} else {
		return Promise.resolve();
	}
}