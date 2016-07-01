'use strict'

var Promise = require('bluebird');
var path = require('path');
var extend = require('node.extend');
var cluster = require('cluster');
var S = require('string');
var fs = require("fs-extra-promise");
var using = Promise.using;
var constants = require('./constants.js');
var _ = require('lodash');

module.exports = function(mikser) {
	var runtime = {};
	mikser.config = extend({
		claenUrlsPattern: 'index.html'
	}, mikser.config);
	var debug = mikser.debug('runtime');
	runtime.cache = {};

	mikser.state.entities = mikser.state.entities || {};
	mikser.state.sitemap = mikser.state.sitemap || {};
	mikser.state.urlmap = mikser.state.urlmap || {};

	runtime._link = function(entity) {
		if (cluster.isMaster) debug('Import in sitemap: M', entity._id);
		else debug('Import in sitemap: W['+ mikser.workerId +']', entity._id);

		mikser.state.entities[entity.collection] = mikser.state.entities[entity.collection] || {};
		return runtime._unlink(entity).then(() => {
			mikser.state.entities[entity.collection][entity._id] = entity;

			mikser.state.urlmap[entity.url] = {
				entityId: entity._id,
				collection: entity.collection
			}

			if (entity.meta.href) {
				if (entity.meta.lang) {
					mikser.state.sitemap[entity.meta.href] = mikser.state.sitemap[entity.meta.href] || {};
					let previous = mikser.state.sitemap[entity.meta.href][entity.meta.lang];
					if (previous && (previous.entityId != entity._id || previous.collection != entity.collection)) {
						mikser.diagnostics.log('warning', 'Entity with equal href:', previous.collection, previous.entityId, 'and', entity.collection, entity._id);
					}
					mikser.state.sitemap[entity.meta.href][entity.meta.lang] = {
						entityId: entity._id,
						collection: entity.collection
					}
				}
				else {
					let previous = mikser.state.sitemap[entity.meta.href];
					if (previous && (previous.entityId != entity._id || previous.collection != entity.collection)) {
						mikser.diagnostics.log('warning', 'Entity with equal href:', previous.collection, previous.entityId, 'and', entity.collection, entity._id);
					}
					mikser.state.sitemap[entity.meta.href] = {
						entityId: entity._id,
						collection: entity.collection
					}
				}
			}
			return mikser.emit('mikser.runtime.link', entity);
		});
	};

	runtime._unlink = function(entity) {
		if (cluster.isMaster) debug('Remove from sitemap: M', entity._id);
		else debug('Remove from sitemap: W['+ mikser.workerId +']', entity._id);

		let previous = mikser.state.entities[entity.collection][entity._id];
		delete mikser.state.entities[entity.collection][entity._id];
		if (previous) delete mikser.state.urlmap[previous.url];

		for (let href of _.keys(mikser.state.sitemap)) {
			if (mikser.state.sitemap[href].entityId) {
				if (mikser.state.sitemap[href].entityId == entity._id) {
					delete mikser.state.sitemap[href];
				}
			}
			else {
				for (let lang of _.keys(mikser.state.sitemap[href])) {
					if (mikser.state.sitemap[href][lang].entityId == entity._id) {
						delete mikser.state.sitemap[href][lang];
					}
				}
				if (!_.keys(mikser.state.sitemap[href]).length) {
					delete mikser.state.sitemap[href];
				}
			}
		}
		return mikser.emit('mikser.runtime.unlink', entity);
	};

	runtime._clearCache = function() {
		if (cluster.isMaster) debug('Clear cache: M');
		else debug('Clear cache: W['+ mikser.workerId +']');

		mikser.runtime.cache = {};
		return Promise.resolve();
	}

	runtime.clearCache = function() {
		return mikser.broker.broadcast('mikser.runtime._clearCache');
	};

	runtime.link = function(entity) {
		return mikser.broker.broadcast('mikser.runtime._link', entity);
	};

	runtime.unlink = function(entity) {
		return mikser.broker.broadcast('mikser.runtime._unlink', entity);
	};

	runtime.importDocument = function(document, strategy) {
		if (strategy != constants.RENDER_STRATEGY_PREVIEW) {
			return mikser.runtime.link(document).then(() => {
				return mikser.database.documents.save(document).then(() => {
					return mikser.scheduler.scheduleDocument(document._id, constants.RENDER_STRATEGY_FULL);
				});
			});
		} else {
			return mikser.runtime._link(document).then(() => {
				return mikser.database.documents.save(document);
			});
		}
	};

	runtime.addLinks = function(document, documentLinks, layoutLinks) {
		documentLinks = documentLinks || [];
		layoutLinks = layoutLinks || [];
		if (!documentLinks && !layoutLinks) return Promise.resolve();

		let linkHistory = {};
		return Promise.map(documentLinks, (link) => {
			let linkEntry = {
				_id: document._id + '->' + link,
				from: document._id, 
				to: link
			};
			if (!linkHistory[linkEntry._id]) {
				debug('Document link:', document._id + ' -> ' + link);
				linkHistory[linkEntry._id] = linkEntry;
				if (document.pageNumber) {
					let mainPageId = document._id.replace('.' + document.pageNumber, '');
					return mikser.database.collection('documentLinks').save({
						_id: mainPageId + '->' + link,
						from: mainPageId, 
						to: link
					});
				} else {
					return mikser.database.documentLinks.save(linkEntry);
				}
			}
		}).then(() => {
			return Promise.map(layoutLinks, (link) => {
				let linkEntry = {
					_id: document._id + '->' + link,
					from: document._id, 
					to: link
				};
				if (!linkHistory[linkEntry._id]) {
					debug('Layout link:', document._id + ' -> ' + link);
					linkHistory[linkEntry._id] = linkEntry;
					return mikser.database.collection('layoutLinks').save(linkEntry);
				}
			});
		});
	};

	runtime.restoreLinks = function(links) {
		let documentId;
		if (links.documentLinks && links.documentLinks[0]) documentId = links.documentLinks[0].from;
		else if (links.layoutLinks && links.layoutLinks[0]) documentId = links.layoutLinks[0].from;
		if (!documentId) return Promise.resolve();
		return runtime.cleanLinks({
			_id: documentId
		}).then(() => {
			return Promise.join(() => {
				if (links.documentLinks) {
					return Promise.all(links.documentLinks.map((link) => {
						return mikser.database.documentLinks.save(link);
					}));
				}
			}, () => {
				if (links.layoutLinks) {
					return Promise.all(links.layoutLinks.map((link) => {
						return mikser.database.layoutLinks.save(link);
					}));
				}
			});
		});
	}

	runtime.cleanLinks = function(document) {
		let links = {};
		return mikser.database.documentLinks.find({
			from: document._id
		}).toArray().then((documentLinks) => {
			links.documentLinks = documentLinks;
			return mikser.database.layoutLinks.find({
				from: document._id
			}).toArray().then((layoutLinks) => {
				links.layoutLinks = layoutLinks;
			});
		}).then(() => {
			return mikser.database.documentLinks.remove({
				from: document._id
			}).then(() => {
				return mikser.database.layoutLinks.remove({
					from: document._id
				});
			});
		}).then(() => links);
	}

	runtime.followLinks = function(document, forcePaging) {
		return mikser.database.collection('documentLinks').find({
			to: document._id
		}).toArray().then((links) => {
			return Promise.map(links, (link) => {
				let fromDocument = mikser.state.entities['documents'][link.from];
				if (!fromDocument) return Promise.resolve();
				return mikser.database.documents.find({
					source: fromDocument.source
				}).toArray().then((otherPages) => {
					return Promise.map(otherPages, (otherPage) => {
						if (otherPage.pageNumber == 0) {
							return mikser.scheduler.scheduleDocument(otherPage._id, constants.RENDER_STRATEGY_STANDALONE);
						}
					});
				});
			});
		});
	}

	runtime.findHref = function(entity, href, lang) {
		if (!href) return href;
		if (href == '/' && entity.relativeBase) return entity.relativeBase;

		let refEntity;
		let url = href;
		href = href || entity.meta.href;
		lang = lang || entity.meta.lang;

		// Href parameter might take multiple types, it can be an absolute url string,
		// it can be a href formated string linking to a document or a document object 
		if (href._id) {
			refEntity = href;
		}
		else {
			if (S(href).startsWith('http')) return href;
			if (lang) {
				let hrefLangs = mikser.state.sitemap[href];
				if (hrefLangs) {
					refEntity = hrefLangs[lang];
				}
			}
			else {
				refEntity = mikser.state.sitemap[href];
			}
			if (refEntity) {
				refEntity = mikser.state.entities[refEntity.collection][refEntity.entityId];
			}
		}
		if (refEntity) {
			url = refEntity.url;
			if (!url) return refEntity;
		} else {
			url = url.toString();
		}
		// If we are lookig for a relative path to a resource that has been shared
		// remove replication path from the url
		let entityUrl = entity.url;
		for (let share of mikser.config.shared) {
			share = S(share).ensureLeft('/').replaceAll('\\','/').ensureRight('/').s;
			if (S(entityUrl).startsWith(share)) {
				entityUrl = entityUrl.replace(share, '/');
			}
			if (S(url).startsWith(share)) {
				url = url.replace(share, '/');
			}
		}

		url = '.' + S(path.relative(path.dirname(entityUrl), path.dirname(url))).replaceAll('\\','/').ensureLeft('/').ensureRight('/').s
			+ S(path.basename(url)).replaceAll('\\','/').chompLeft('/').s;
		let relativeUrl = {
			link: url
		}
		if (refEntity) {
			relativeUrl = refEntity;
			relativeUrl.link = url;
			if (refEntity._id == entity._id) {
				relativeUrl.link = entity.url.split('/').pop();
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
					mikser.diagnostics.log('error', error);
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

	runtime.findHrefLang = function (href) {
		let refLang = mikser.state.sitemap[href];
		if (refLang) {
			let refHrefLang = {};
			for (let lang of _.keys(refLang)) {
				let refEntity = refLang[lang];
				refHrefLang[lang] = mikser.state.entities[refEntity.collection][refEntity.entityId];
			}
			return refHrefLang;
		}
	}

	runtime.findUrl = function (url) {
		let refEntity = mikser.state.urlmap[url];
		if (refEntity) {
			refEntity = mikser.state.entities[refEntity.collection][refEntity.entityId];
		}
		return refEntity;
	}

	runtime.findEntity = function (collection, entityId) {
		collection = mikser.state.entities[collection];
		if (collection) {
			return collection[entityId];
		}
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

				let publicPlugin = path.join(mikser.options.workingFolder, 'node_modules', 'mikser-' + plugin);
				if (fs.existsSync(publicPlugin)) {
					return publicPlugin;
				} else {
					if (S(plugin).endsWith('/index.js')) throw 'Plugin ' + plugin + ' not found.';
					return runtime.findPlugin(S(plugin).ensureRight('/index.js').s);
				}
			}
		}
		else {
			plugin = privatePlugin;
		}
		return plugin;
	}

	runtime.findBrowserPlugin = function(plugin) {
		let serverPlugin = runtime.findPlugin(plugin);
		if (S(serverPlugin).endsWith('.js')) {
			var browserPlugin = path.join(path.dirname(serverPlugin), 'browser','index.js');
		} else {
			var browserPlugin = path.join(serverPlugin, 'browser','index.js');			
		}
		if (!fs.existsSync(browserPlugin)) {
			browserPlugin = path.join(path.dirname(serverPlugin), 'browser.js');
		}
		return browserPlugin;
	}

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
		currentVersion = currentVersion.split('.');
		let recentPackage = path.join(mikser.config.runtimeFolder, 'recent.json');
		if (fs.existsSync(recentPackage)) {
			let recentVersion = require(recentPackage).version.split('.');
			if (recentVersion[0] != currentVersion[0]) {
				console.log('Cleaning runtime state');
				fs.emptyDirSync(mikser.config.runtimeFolder);
				fs.emptyDirSync(mikser.config.outputFolder);
				fs.copySync(currentPackge, recentPackage);
			}
		}
		else {
			fs.copySync(currentPackge, recentPackage);
		}
	}
	mikser.runtime = runtime;
	return Promise.resolve(mikser);
}