'use strict'
let glob = require('glob');
let path = require('path');
let fs = require('fs-extra');

module.exports = function (mikser, context) {

	context.glob = function (pattern, globFolder) {
		let globFolders = [mikser.config.filesFolder, mikser.config.sharedFolder];
		let result = [];

		function getStats(cwd, urlFlag) {
			glob.sync(pattern, {cwd: cwd}).forEach((file) => {
				let source = path.join(cwd, file)
				let stats = fs.statSync(source);
				if (urlFlag) {
					let destination = mikser.filemanager.predictDestination(source);
					destination = mikser.filemanager.resolveDestination(destination, context.document.destination);
					stats.url = mikser.filemanager.getUrl(destination);
				}
				result.push(stats);
			});
		}

		if (globFolder) {
			let cwd = path.join(mikser.options.workingFolder, globFolder);
			getStats(cwd, false);
		} else {
			for (let cwd of globFolders) {
				getStats(cwd, true);
			}
		}

		return result;
	}

	context.file = function (file, encoding, optional) {
		if (typeof encoding == 'boolean') {
			optional = encoding;
			encoding = undefined;
		}
		optional = optional || false;
		encoding = encoding || 'utf8';

		let source = mikser.filemanager.findSource(file);
		if (optional && !fs.existsSync(source)) return '';
		let content = fs.readFileSync(source, {
			encoding: encoding
		});
		return content;
	}

	context.stat = function (file) {
		let source = mikser.filemanager.findSource(file);
		if (source) {
			let stats = fs.statSync(source);
			let destination = mikser.filemanager.predictDestination(source);
			destination = mikser.filemanager.resolveDestination(destination, context.document.destination);
			let url = mikser.filemanager.getUrl(destination);
			if (url) {
				stats.url = url;
			}
			return stats;
		}
	}

}