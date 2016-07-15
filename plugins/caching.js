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

	function downloadFile(source, destination, options) {
		return new Promise((resolve, reject) => {
			request.get(source, options).on('response', (response) => {
				if (response.statusCode !== 200) {
					let err = new Error(`Download failed[${response.statusCode}]: ${options.url}, ${response.statusMessage}`);
					err.origin = 'cache';
					reject(err);
					return;
				}
				let file = createOutputStream(destination).on('finish', () => {
					file.close(resolve);
				});
				response.pipe(file).on('error', (err) => {
					fs.removeAsync(destination).finally(() => next(err));
				});				
			}).on('error', function(err) {
				reject(err);
			});
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

	function cacheFile(source, destination, options) {
		let cacheInfo = extend({}, defaultInfo);
		if (typeof destination != 'string') {
			options = destination;
			destination = undefined;
		}
		cacheInfo.options = options || {};

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
					cacheInfo.destination = mikser.utils.resolveDestination(destination, context.entity.destination);
				} else {
					cacheInfo.destination = path.join(mikser.options.workingFolder, destination);
				}
			}
			else {
				cacheInfo.destination = destination;
			}
		} else {
			cacheInfo.destination = mikser.utils.predictDestination(source);
			cacheInfo.destination = mikser.utils.resolveDestination(cacheInfo.destination, context.entity.destination);
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
				if (isUrl(cacheInfo.source)) {
					if (!cacheInfo.fromCache) {
						return fs.existsAsync(cacheInfo.destination).then((exists) => {
							if (exists) {
								return fs.unlinkAsync(cacheInfo.destination);
							}
						}).then(() => {
							debug('Downloading:', cacheInfo.source);
							return downloadFile(cacheInfo.source, cacheInfo.destination, cacheInfo.options)
								.tap(() => console.log('Saved:', cacheInfo.destination));
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
		context.cache = function(source, destination, options) {
			let cache = cacheFile(source, destination, options);
			context.process(cache.process);
			return cache.cacheInfo;
		}
	}

	let plugin = {
		cache: function(source, destination, options) {
			let cache = cacheFile(source, destination, options);
			return cache.process.apply(null).return(cache.cacheInfo);
		}
	}

	return plugin;
}