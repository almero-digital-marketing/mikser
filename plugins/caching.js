'use strict';
let path = require('path');
let fs = require('fs-extra-promise');
let request = require('request');
let extend = require('node.extend');
let moment = require('moment');
let Promise = require('bluebird');
let createOutputStream = require('create-output-stream');
let _ = require('lodash');

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

	function downloadFile(destination, options, next) {
		debug('Downloading:', options.url);
		let success = false;

		let readStream = request(options, (err, response) => {
			if (err) {
				mikser.diagnostics.log(this, 'error', `[cache] Download error: ${err.message}`);
				next();
			}

			if (response.statusCode !== 200) {
				mikser.diagnostics.log(this, 'error', `[cache] Invalid status code: ${options.url}, ${response.statusCode}, ${response.statusMessage}`);
				next();
			} else {
				success = true;
			}
		});

		let writeStream = createOutputStream(destination);
		writeStream.on('error', next);
		writeStream.on('finish', () => {
			if (!success) {
				fs.remove(destination, next);
			} else {
				debug(`Saved: ${destination}`)
				next();
			}
		});
		readStream.pipe(writeStream);
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
			let source = mikser.utils.findSource(cacheInfo.source);
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

	function cacheFile(entity, source, destination) {
		let cacheInfo = extend({}, defaultInfo);

		if (!source) {
			let err = new Error('Undefined source');
			err.origin = 'cache';
			throw err;
		}

		if (!destination && !context) {
			let err = new Error('Undefined destination');
			err.origin = 'cache';
			throw err;
		}

		if (destination) {
			if (destination.indexOf(mikser.options.workingFolder) !== 0) {
				if (context) {
					cacheInfo.destination = mikser.utils.resolveDestination(destination, entity.destination);
				} else {
					cacheInfo.destination = path.join(mikser.options.workingFolder, destination);
				}
			}
			else {
				cacheInfo.destination = destination;
			}
		} else {
			cacheInfo.destination = mikser.utils.predictDestination(source);
			cacheInfo.destination = mikser.utils.resolveDestination(cacheInfo.destination, entity.destination);
		}

		if (!mikser.utils.isPathToFile(cacheInfo.destination)) {
			cacheInfo.destination = path.join(destination, path.basename(source));
		}

		cacheInfo.source = source;
		updateCache(cacheInfo);
		cacheInfo.toString = () => mikser.utils.getUrl(cacheInfo.destination);

		return {
			process: () => {
				updateCache(cacheInfo);
				if (isUrl(source)) {
					if (!cacheInfo.fromCache) {
						let opts = {
							method: 'GET',
							encoding: null,
							url: source,
						};

						if (cacheInfo.credentials) {
							opts.auth = cacheInfo.credentials;
						}

						let downloadAsync = Promise.promisify(downloadFile);
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
						let sourcePath = mikser.utils.findSource(source);
						return fs.existsAsync(sourcePath).then((exists) => {
							if (exists) {
								return deleteFile(cacheInfo.destination).then(() => {
									debug(sourcePath.replace(mikser.options.workingFolder, ''), '->', cacheInfo.destination.replace(mikser.options.workingFolder, ''));
									return fs.copyAsync(sourcePath, cacheInfo.destination, {preserveTimestamps: false});
								});
							}
							else if (!cacheInfo.isOptional) {
								mikser.diagnostics.log(this, 'error', `[cache] File not found at: ${source}`);
							}
							return Promise.resolve();
						});
					}
				}
			},
			cacheInfo: cacheInfo
		}
	}

	if (context){
		context.cache = function(source, destination) {
			let cache = cacheFile(context.entity, source, destination);
			context.process(cache.process);
			return cache.cacheInfo;
		}
	}

	let plugin = {
		cache: function(source, destination) {
			let cache = cacheFile(context.entity, source, destination);
			return cache.process.apply(null).return(cache.cacheInfo);
		}
	}

	return plugin;
}