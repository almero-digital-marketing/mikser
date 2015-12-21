'use strict';
let path = require('path');
let fs = require('fs-extra-promise');
let request = require('request');
let extend = require('node.extend');
let moment = require('moment');
let Promise = require('bluebird');

module.exports = function (mikser, context) {
	let debug = mikser.debug('caching');
	let defaultInfo = {
		credentials: mikser.config.caching ? mikser.config.caching.credentials : null,
		isOptional: false,
		expire: function (duration, as) {
			duration = duration || 0;
			as = as || 'seconds';
			this.timeout = {duration: duration, as: as};
			updateCache(this);
			return this;
		},
		optional: function () {
			this.isOptional = true;
			updateCache(this);
			return this;
		}
	}

	function isUrl (path) {
		return /^http[s]?:\/\//.test(path);
	}

	function download (destination, options, next) {
		debug('Downloading:', options.url)
		let readStream = request(options);
		readStream.on('error', next);
		readStream.on('response', (response) => {
			if (response.statusCode === 200) {
				let writeStream = fs.createOutputStream(destination);
				writeStream.on('error', next);
				writeStream.on('finish', next);
				readStream.pipe(writeStream);
			}
			else {
				mikser.diagnostics.log(context, 'warning', `[cache] Invalid status code: ${options.url}, ${response.statusCode}, ${response.statusMessage}`);
				next();
			}
		});
	}

	function updateCache (cacheInfo) {
		if (!fs.existsSync(cacheInfo.destination)) {
			cacheInfo.fromCache = false;
			return;
		}
		if (isUrl(cacheInfo.source)) {
			if (!cacheInfo.timeout) {
				cacheInfo.fromCache = true;
			} else {
				let fileExpireDate = moment(fs.statSync(cacheInfo.destination).mtime).add(cacheInfo.timeout.duration, cacheInfo.timeout.as);
				cacheInfo.fromCache = fileExpireDate.isBefore(moment());
			}
		} else {
			if (!cacheInfo.timeout) {
				cacheInfo.fromCache = true;
				return;
			}
			let source = mikser.manager.findSource(cacheInfo.source);
			if (!source) {
				cacheInfo.fromCache = false;
			} else {
				let destinationMoment = moment(fs.statSync(cacheInfo.destination).mtime);
				let sourceMoment = moment(fs.statSync(source).mtime).add(cacheInfo.timeout);
				cacheInfo.fromCache = destinationMoment.isAfter(sourceMoment);
			}
		}
	}

	function deleteFile (file) {
		return fs.existsAsync(file).then((exists) => {
			if (exists) {
				return fs.unlinkAsync(file);
			}
			return Promise.resolve();
		});
	}

	context.cache = function (source, destination) {

		let cacheInfo = extend({}, defaultInfo);

		if (!source) {
			let err = new Error('Undefined source');
			err.origin = 'cache';
			throw err;
		}

		if (destination) {
			if (destination.indexOf(mikser.options.workingFolder) != 0) {
				cacheInfo.destination = mikser.manager.resolveDestination(destination, context.document.destination);
			}
			else {
				cacheInfo.destination = destination;
			}
		} else {
			cacheInfo.destination = mikser.manager.predictDestination(source);
			cacheInfo.destination = mikser.manager.resolveDestination(cacheInfo.destination, context.document.destination);
		}

		if (!mikser.manager.isPathToFile(cacheInfo.destination)) {
			cacheInfo.destination = path.join(destination, path.basename(source));
		}

		cacheInfo.source = source;
		updateCache(cacheInfo);
		cacheInfo.toString = () => mikser.manager.getUrl(cacheInfo.destination);

		context.pending = context.pending.then(() => {
			updateCache(cacheInfo);
			if (isUrl(source)) {
				if (!cacheInfo.fromCache) {
					let opts = {
						method: 'GET',
						encoding: null,
						url: source,
						auth: cacheInfo.credentials || {}
					};

					let downloadAsync = Promise.promisify(download);
					return fs.existsAsync(cacheInfo.destination).then((exists) => {
						if (exists) {
							return fs.unlinkAsync(cacheInfo.destination);
						}
					}).then(() => {
						return downloadAsync(cacheInfo.destination, opts);
					});
				}
			}
			else {
				if (!cacheInfo.fromCache) {
					let sourcePath = mikser.manager.findSource(source);
					return fs.existsAsync(sourcePath).then((exists) => {
						if (exists) {
							return deleteFile(cacheInfo.destination).then(() => {
								debug(sourcePath.replace(mikser.options.workingFolder, ''), '->', cacheInfo.destination.replace(mikser.options.workingFolder, ''));
								return fs.copyAsync(sourcePath, cacheInfo.destination, {preserveTimestamps: false});
							});
						}
						else if (!cacheInfo.isOptional) {
							mikser.diagnostics.log(context, 'error', `[cache] File not found at: ${source}`);
						}
						return Promise.resolve();
					});
				}
			}
		});
		return cacheInfo;
	}
}