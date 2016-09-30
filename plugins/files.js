'use strict'
let glob = require('glob');
let path = require('path');
let fs = require('fs-extra-promise');
let rp = require('request-promise');

module.exports = function (mikser, context) {

	context.glob = function (pattern, globFolder) {
		let globFolders = [mikser.config.filesFolder, mikser.config.sharedFolder];
		let result = [];

		function getStats(cwd, urlFlag) {
			glob.sync(pattern, {cwd: cwd}).forEach((file) => {
				let source = path.join(cwd, file)
				let stats = fs.statSync(source);
				if (urlFlag) {
					let destination = mikser.utils.predictDestination(source);
					destination = mikser.utils.resolveDestination(destination, context.entity.destination);
					stats.url = mikser.utils.getUrl(destination);
				} else {
					stats.url = mikser.utils.getUrl(file);
				}
				stats.toString = function() {
					return stats.url;
				}
				result.push(stats);
			});
		}

		console.log(globFolder);
		if (globFolder) {
			let cwd = path.join(mikser.options.workingFolder, globFolder);
			console.log(cwd);
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

		let source = mikser.utils.findSource(file);
		if (optional && !fs.existsSync(source)) return '';
		let content = fs.readFileSync(source, {
			encoding: encoding
		});
		return content;
	}

	context.write = function(file, content) {
		context.process(() => {
			return fs.createFileAsync(file).then(() => {
				return fs.writeFileAsync(file, content);							
			});
		});
	}

	context.stat = function (file) {
		let source = mikser.utils.findSource(file);
		if (source) {
			let stats = fs.statSync(source);
			let destination = mikser.utils.predictDestination(source);
			destination = mikser.utils.resolveDestination(destination, context.entity.destination);
			let url = mikser.utils.getUrl(destination);
			if (url) {
				stats.url = url;
			}
			return stats;
		}
	}

	context.embed = function(source) {
		if (isUrl(source)) {
			return context.async(rp(source, {encoding: null}).then((data) => 'base64,' + data.toString('base64')));
		} else {
			let source = mikser.utils.findSource(source);
			return context.async(fs.readFileAsync(source).then((data) => 'base64,' + data.toString('base64')));
		}
	}

}