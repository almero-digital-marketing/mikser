'use strict'

var Promise = require('bluebird');
var path = require('path');
var extend = require('node.extend');
var cluster = require('cluster');
var S = require('string');
var fs = require("fs-extra-promise");
var indentString = require('indent-string');
var using = Promise.using;
var constants = require('./constants.js');
var _ = require('lodash');

function init(mikser) {
	var runtime = {};
	mikser.config = extend({
		claenUrlsPattern: 'index.html'
	}, mikser.config);
	var debug = mikser.debug('runtime');

	mikser.state.sitemap = mikser.state.sitemap || {};
	runtime.cache = {};

	var importInSitemap = function(document, broadcast) {
		if (document.meta.href) {
			if (document.meta.lang) {
				mikser.state.sitemap[document.meta.href] = mikser.state.sitemap[document.meta.href] || {};
				mikser.state.sitemap[document.meta.href][document.meta.lang] = document;
			}
			else {
				mikser.state.sitemap[document.meta.href] = document;
			}
			if (broadcast) {
				mikser.send({
					call: 'runtime.importInSitemap',
					document: document
				});
			}
		}
		return Promise.resolve();
	};

	var removeFromSitemap = function(document, broadcast) {
		if (document.meta.href) {
			if (document.meta.lang) {
				if (mikser.state.sitemap[document.meta.href]) {
					delete mikser.state.sitemap[document.meta.href][document.meta.lang];
				}
			}
			else {
				delete mikser.state.sitemap[document.meta.href];
			}
			if (broadcast) {
				mikser.send({
					call: 'runtime.removeFromSitemap',
					document: document
				});
			}
		}
		return Promise.resolve();
	};

	runtime.clearCache = function() {
		mikser.runtime.cache = {};
		if (cluster.isMaster) {
			mikser.send({
				call: 'runtime.clearCache'
			});
		}
		return Promise.resolve();
	};

	runtime.importInSitemap = function(document) {
		return importInSitemap(document, true);
	};

	runtime.removeFromSitemap = function(document) {
		return removeFromSitemap(document, true);
	};

	runtime.addLinks = function(document, database) {
		document.documentLinks = document.documentLinks || [];
		document.layoutLinks = document.layoutLinks || [];
		if (!document.documentLinks && !document.layoutLinks) return Promise.resolve();

		return Promise.map(document.documentLinks, (link) => {
			debug('Document link:', document._id + ' -> ' + link);
			return database.documentLinks.save({
				_id: document._id + '->' + link,
				from: document._id, 
				to: link
			}).then(() => {
				if (document.pageNumber) {
					let mainPageId = document._id.replace('.' + document.pageNumber, '');
					return database.collection('documentLinks').save({
						_id: mainPageId + '->' + link,
						from: mainPageId, 
						to: link
					});
				}
			});
		}).then(() => {
			return Promise.map(document.layoutLinks, (link) => {
				debug('Layout link:', document._id + ' -> ' + link);
				return database.collection('layoutLinks').save({
					_id: document._id + '->' + link,
					from: document._id, 
					to: link
				});
			});
		});
	};

	runtime.restoreLinks = function(links, database) {
		let documentId;
		if (links.documentLinks && links.documentLinks[0]) documentId = links.documentLinks[0].from;
		else if (links.layoutLinks && links.layoutLinks[0]) documentId = links.layoutLinks[0].from;
		if (!documentId) return Promise.resolve();
		return runtime.cleanLinks({
			_id: documentId
		}, database).then(() => {
			return Promise.join(() => {
				if (links.documentLinks) {
					return Promise.all(links.documentLinks.map((link) => {
						return database.documentLinks.save(link);
					}));
				}
			}, () => {
				if (links.layoutLinks) {
					return Promise.all(links.layoutLinks.map((link) => {
						return database.layoutLinks.save(link);
					}));
				}
			});
		});
	}

	runtime.cleanLinks = function(document, database) {
		let links = {};
		return database.documentLinks.find({
			from: document._id
		}).toArray().then((documentLinks) => {
			links.documentLinks = documentLinks;
			return database.layoutLinks.find({
				from: document._id
			}).toArray().then((layoutLinks) => {
				links.layoutLinks = layoutLinks;
			});
		}).then(() => {
			return database.documentLinks.remove({
				from: document._id
			}).then(() => {
				return database.layoutLinks.remove({
					from: document._id
				});
			});
		}).then(() => links);
	}

	runtime.followLinks = function(document, database, forcePaging) {
		return database.collection('documentLinks').find({
			to: document._id
		}).toArray().then((links) => {
			return Promise.map(links, (link) => {
				return database.documents.findOne({_id: link.from}).then((fromDocument) => {
					return database.documents.find({
						source: fromDocument.source
					}).toArray().then((otherPages) => {
						return Promise.map(otherPages, (otherPage) => {
							return mikser.renderqueue.enqueueDocument(otherPage._id, constants.RENDER_STRATEGY_STANDALONE);
						});
					});
				});
			});
		});
	}

	runtime.findHref = function(context, href, lang) {
		if (!href) return href;
		let document = context.document;
		if (href == '/' && document.relativeBase) return document.relativeBase;

		let refDocument;
		let url = href;
		href = href || document.meta.href;
		lang = lang || document.meta.lang;

		// Href parameter might take multiple types, it can be an absolute url string,
		// it can be a href formated string linking to a document or a document object 
		if (href._id) {
			refDocument = href;
		}
		else {
			if (S(href).startsWith('http')) return href;
			if (lang) {
				let hrefLangs = mikser.state.sitemap[href];
				if (hrefLangs) {
					refDocument = hrefLangs[lang];
				}
			}
			else {
				refDocument = mikser.state.sitemap[href];
			}
		}
		if (refDocument) {
			url = refDocument.url;
			if (!url) return refDocument;
		}

		// If we are lookig for a relative path to a resource that has been shared
		// remove replication path from the url
		let documentUrl = document.url;
		for (let share of mikser.config.shared) {
			share = S(share).ensureLeft('/').replaceAll('\\','/').ensureRight('/').s;
			if (S(documentUrl).startsWith(share)) {
				documentUrl = documentUrl.replace(share, '/');
			}
			if (S(url).startsWith(share)) {
				url = url.replace(share, '/');
			}
		}

		url = '.' + S(path.relative(path.dirname(documentUrl), path.dirname(url))).replaceAll('\\','/').ensureLeft('/').ensureRight('/').s
			+ S(path.basename(url)).replaceAll('\\','/').chompLeft('/').s;
		let relativeUrl = {
			link: url
		}
		if (refDocument) {
			relativeUrl = refDocument;
			relativeUrl.link = url;
			if (refDocument._id == document._id) {
				relativeUrl.link = document.url.split('/').pop();
			}
		}
		else {
			Object.defineProperty(relativeUrl, 'meta', {
				get: function() {
					let error = "[runtime] Can't find ";
					if (lang) {
						error += 'hreflang (' + lang + '): ';
					}
					else {
						error += 'href: ';
					}
					error += href;
					mikser.diagnostics.log(context, 'error', error);
					return {};
				}
			});
		}
		if (mikser.config.cleanUrls) {
			let clean = new RegExp(mikser.config.claenUrlsPattern,"gi");
			relativeUrl.link = relativeUrl.link.replace(clean, '');
		}
		relativeUrl.toString = function() {
			return this.link;
		}
		return relativeUrl;
	}

	runtime.findHrefLang = function (context, href) {
		href = href || context.document.meta.href;
		return mikser.state.sitemap[href];
	}

	runtime.fromCache = function(name, loadData) {
		if (runtime.cache[name]) {
			let data = runtime.cache[name];
			return Promise.resolve(runtime.cache[name]);
		}
		return loadData().then((data) => {
			//runtime.cache[name] = data;
			return Promise.resolve(data);
		})
	}
 
	runtime.findPlugin = function(plugin) {
		let privatePlugin = plugin;
		if (mikser.config) {
			plugin = plugin || mikser.config[plugin];
			privatePlugin = path.join(mikser.config.pluginsFolder, S(plugin).ensureRight('.js').s);
		}
		if (!fs.existsSync(privatePlugin)) {
			let buildinPlugin = path.join(__dirname, '../plugins', S(plugin).ensureRight('.js').s);
			if (fs.existsSync(buildinPlugin)) {
				plugin = buildinPlugin;
			}
			else {
				plugin = 'mikser-' + plugin;
			}
		}
		else {
			plugin = privatePlugin;
		}
		return plugin;
	}


	return new Promise((resolve, reject) => {
		mikser.runtime = runtime;
		if (cluster.isMaster) {
			mikser.cli
				.option('-k, --keep', 'keep the runtime clean')
				.init();
			mikser.options.keepRuntime = mikser.cli.runtime;

			runtime.markDirty = function() {
				fs.ensureFileSync(path.join(mikser.config.runtimeFolder, 'dirty'));
			};

			runtime.markClean = function() {
				fs.removeSync(path.join(mikser.config.runtimeFolder, 'dirty'));	
			};

			runtime.isDirty = function() {
				return fs.existsSync(path.join(mikser.config.runtimeFolder, 'dirty'));
			};

			if (!mikser.options.keepRuntime && runtime.isDirty()) {
				console.log('Cleaning dirty state');
				fs.emptyDirSync(mikser.config.outputFolder);
				runtime.markClean();
			}

			// If version update clean output and runtime state
			fs.mkdirsSync(mikser.config.runtimeFolder);
			let currentPackge = path.join(__dirname,'../package.json');
			let currentVersion = require(currentPackge).version;
			mikser.cli.version(currentVersion);
			let recentPackage = path.join(mikser.config.runtimeFolder, 'recent.json');
			if (fs.existsSync(recentPackage)) {
				let recentVersion = require(recentPackage).version;
				if (recentVersion != currentVersion) {
					console.log('Cleaning runtime state');
					fs.emptyDirSync(mikser.config.runtimeFolder);
					fs.emptyDirSync(mikser.config.outputFolder);
					fs.copySync(currentPackge, recentPackage);
				}
			}
			else {
				fs.copySync(currentPackge, recentPackage);
			}

			mikser.receive({
				'runtime.importInSitemap': (message) => importInSitemap(message.document, true),
				'runtime.removeFromSitemap': (message) => removeFromSitemap(message.document, true),
			});
		} else {
			mikser.receive({
				'runtime.importInSitemap': (message) => importInSitemap(message.document, false),
				'runtime.removeFromSitemap': (message) => removeFromSitemap(message.document, false),
				'runtime.clearCache': (message) => runtime.clearCache()
			});			
		}
		resolve(mikser);
	});
}	
module.exports = init;