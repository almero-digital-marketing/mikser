'use strict'

var Promise = require('bluebird');
var minimatch = require("minimatch");
var S = require('string');
var path = require('path');
var fs = require('fs-extra-promise');
var extend = require('node.extend');
var _ = require('lodash');

module.exports = function(mikser) {
	var utils = {
		extensions: {
			default: '.html'
		}
	};
	mikser.config = extend({
		extensions: {},
	}, mikser.config);

	if (mikser.config.extensions) utils.extensions = _.defaultsDeep(mikser.config.extensions, utils.extensions);

	utils.findSource = function (source) {
		let sourceFilePath = '';
		if (fs.existsSync(path.join(mikser.config.filesFolder, source))) {
			sourceFilePath = path.join(mikser.config.filesFolder, source);
		}
		else if (fs.existsSync(path.join(mikser.config.documentsFolder, source))) {
			sourceFilePath = path.join(mikser.config.documentsFolder, source);
		}
		else if (fs.existsSync(path.join(mikser.config.sharedFolder, source))) {
			sourceFilePath = path.join(mikser.config.sharedFolder, source);
		}
		else if (fs.existsSync(path.join(mikser.options.workingFolder, source))) {
			sourceFilePath = path.join(mikser.options.workingFolder, source);
		}
		else if (fs.existsSync(source)) {
			sourceFilePath = source;
		}
		return sourceFilePath;
	}

	utils.isPathToFile = function (destination) {
		let endingChar = destination.slice(-1);
		if (endingChar === '\\' || endingChar === '/') return false;
		if (fs.existsSync(destination) && fs.isDirectorySync(destination)) return false;
		let extName = path.extname(destination);
		// if this is not a directory or it is not ending on / || \, we check for file extension
		return (extName !== '' && extName !== '.');
	}

	utils.isNewer = function (source, destination) {
		if (!fs.existsSync(destination)) return true;
		let destinationMtime = fs.statSync(destination).mtime;

		if (!Array.isArray(source)) {
			var sources = [sources];
		} else {
			var sources = source;
		}

		for (let file of sources) {
			if (fs.statSync(file).mtime > destinationMtime) return true;
		}
		return false;
	}

	utils.resolveDestination = function (destination, anchor) {
		let destinationFolder = path.dirname(anchor);
		let share = utils.getShare(anchor);
		if (path.isAbsolute(destination)) {
			destination = destination.replace(mikser.config.outputFolder, '');
			if (share && destination.indexOf(share) != 0) {
				destinationFolder = path.join(mikser.config.outputFolder, share);
			}
			else {
				destinationFolder = mikser.config.outputFolder;
			}
		}
		return path.join(destinationFolder, destination);
	}

	utils.predictDestination = function (file, info) {
		// file is absolute path for root /home/user/path/to/file
		if (file.indexOf(mikser.config.documentsFolder) === 0 && 
			minimatch(file, mikser.config.documentsPattern)) {
			if (!info) info = mikser.parser.parse(file);
			if (info.meta && info.meta.destination && info.meta.render !== false) {
				return path.join(mikser.config.outputFolder, info.meta.destination);
			}
			// if current file is in documentsFolder, remove that path
			file = file.replace(mikser.config.documentsFolder, '').substring(1);
			let dir = path.dirname(file);
			let basename = path.basename(file);
			let sourceExt = path.extname(basename);
			let destinationExt = sourceExt;

			if (info.markup) {
				destinationExt = mikser.config.extensions.default;
			} else {
				destinationExt = mikser.utils.extensions[sourceExt] || destinationExt;
			}

			basename = basename.substr(0, basename.indexOf(".")) + destinationExt;
			let destination = path.join(mikser.config.outputFolder, dir, basename);
			if (mikser.config.cleanUrls && !S(destination).endsWith('index.html')) {
				destination = path.join(destination.replace('.html', ''), 'index.html');
			}
			if (info.meta) {
				if (info.meta.render === false) {
					return false;
				}
				if (info.meta && info.meta.layout == undefined) {
					return false;
				}		
			}
			return destination;
		}
		else {
			let destinationBase = mikser.config.outputFolder;
			file = path.normalize(file);
			// in case file is just file name
			if (file.indexOf(path.sep) === -1 ||
				file.split(path.sep).length === 2 && file.indexOf(path.sep) === 0) {
				return path.join(destinationBase, file);
			}
			// create absolute path for the comparison
			let absoluteSource = path.isAbsolute(file) ? file : (path.sep + file);
			if (absoluteSource.indexOf(mikser.options.workingFolder) === 0) {
				absoluteSource = absoluteSource.substr(mikser.options.workingFolder.length, absoluteSource.length);
			}

			let dirToCheck = path.join(mikser.options.workingFolder, absoluteSource.split(path.sep).slice(0,2).join(path.sep));
			let skip = 0;
			if (fs.existsSync(dirToCheck)) skip = 1;
			return path.join(destinationBase, absoluteSource.split(path.sep).slice(skip + 1).join(path.sep));
		}
	};

	utils.getUrl = function (destination) {
		let url;
		if (destination && destination.indexOf(mikser.config.outputFolder) === 0) {
			url = destination.substring(mikser.config.outputFolder.length).split(path.sep).join('/');
			if (mikser.config.cleanUrls && !S(url).endsWith('index.html')) {
				url = document.url.replace('.html', '/index.html');
			}
		}
		return url;
	}

	utils.getShare = function(destination) {
		let relativeBase = destination.replace(mikser.config.outputFolder, '');
		relativeBase = S(relativeBase).replaceAll('\\','/').s;
		for (let share of mikser.config.shared) {
			let normalizedShare = S(share).replaceAll('\\','/').ensureLeft('/').s;
			if (relativeBase.indexOf(normalizedShare) == 0) {
				return share;
			}
		}
	}

	utils.getDomainUrl = function(destination) {
		if (!mikser.config.serverDomains) return destination;
		if (mikser.config.serverDomains === true) {
			let share = utils.getShare(destination);
			return destination.replace(share, '').replace('//','/');
		} else {
			for(let domain in mikser.config.serverDomains) {
				let domainFolder = mikser.config.serverDomains[domain];
				if (destination.indexOf(domainFolder) > -1) {
					return destination.replace(domainFolder, '').replace('//','/');
				}
			}
		}
	}

	utils.getHostUrl = function(destination, domain) {
		if (mikser.config.serverDomains === true) {
			return '/' + domain + S(destination).ensureLeft('/');
		} else {
			let domainFolder = mikser.config.serverDomains[domain];
			return S(domainFolder).ensureLeft('/') + S(destination).ensureLeft('/');
		}
	}

	utils.getNormalizedUrl = function(url) {
		let normalizedUrl = url.split('#')[0].split('?')[0];
		if (S(normalizedUrl).endsWith('/')) {
			normalizedUrl = normalizedUrl + 'index.html';
		}
		if (mikser.config.serverDomains) {
			let parts = decodeURI(normalizedUrl).split('/');
			let domain = parts[2].split(':')[0];
			parts = parts.slice(3);
			parts.unshift(domain);
			normalizedUrl = parts.join('/');
		} else {
			normalizedUrl = decodeURI(normalizedUrl).split('/').slice(3).join('/');
		}
		return S(normalizedUrl).ensureLeft('/').s;
	}

	utils.getLayoutId = function(layoutId) {

		let metafileSource = path.join(mikser.config.layoutsFolder, layoutId);
		let metafileDir = path.dirname(metafileSource);
		let metafileBasename = path.basename(metafileSource);
		let metafileExt = path.extname(metafileBasename);
		let metafileName = metafileBasename.replace(metafileExt, '');

		if (fs.existsSync(metafileSource)) {
			if (fs.statSync(metafileSource).isDirectory()) return;
		}

		let fileMatches = fs.readdirSync(metafileDir);
		fileMatches = fileMatches.filter((fileName) => {
			if (fileName === metafileBasename) return false;
			return fileName.replace(path.extname(fileName), '') === metafileName;
		});
		if (!fileMatches.length) return;

		for (let file of fileMatches) {
			let engine = mikser.generator.findEngine(file);
			if (engine) return layoutId.replace(metafileExt, path.extname(file));
		}
	}

	utils.getDocumentId = function(documentId) {

		let metafileSource = path.join(mikser.config.documentsFolder, documentId);
		let metafileDir = path.dirname(metafileSource);
		let metafileBasename = path.basename(metafileSource);
		let metafileExt = path.extname(metafileBasename);
		let metafileName = metafileBasename.replace(metafileExt, '');

		if (fs.existsSync(metafileSource)) {
			if (fs.statSync(metafileSource).isDirectory()) return;
		}

		let fileMatches = fs.readdirSync(metafileDir);
		fileMatches = fileMatches.filter((fileName) => {
			if (fileName === metafileBasename) return false;
			if (fs.statSync(path.join(metafileDir, fileName)).isDirectory()) return false;
			return fileName.replace(path.extname(fileName), '') === metafileName;
		});
		if (!fileMatches.length) return;

		for (let file of fileMatches) {
			let engine = mikser.parser.findEngine(file);
			if (!engine) return documentId.replace(metafileExt, path.extname(file));
		}
	}

	mikser.utils = utils;
	return Promise.resolve(mikser);	
}