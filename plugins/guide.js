'use strict';
let _ = require('lodash');
let uuid = require('uuid');
let Promise = require('bluebird');
let fs = require('fs-extra-promise');
let path = require('path');
let traverse = require('traverse');
let letters = require('unicode-8.0.0/categories/L/regex').source;
let XRegExp = require('xregexp');
var cluster = require('cluster');

module.exports = function(mikser, context) {

	function parseGuide(document, documentContent, keyArgs, value, documentKeys) {
		let documentGuide = 'guide:/' + document.source.replace(mikser.options.workingFolder, '');
		
		try {

			if (value == null || value == undefined || value == '') return documentGuide;

			let valueWrapRegex = new RegExp('([^' + letters + '0-9])' + XRegExp.escape(value) + '(?!['+ letters +'0-9])', 'g');
			let uuidKeys = [];
			let uuidContent = documentContent.replace(valueWrapRegex, (match, p1) => {
				return p1 + uuidKeys[uuidKeys.push('_' + uuid.v1().replace(/-/g, '')) - 1];
			});

			// when content is passed, document source is not used
			let uuidContentObject = mikser.parser.parse(document.source, uuidContent);

			if (documentKeys && documentKeys.indexOf(value) > -1) {
				traverse(uuidContentObject.meta).forEach(function(node) {
					if (uuidKeys.indexOf(this.key) > -1) {
						this.delete();
						this.key = value;
						this.update(node);
					}
				});
			}

			let uuidValue = _.get(uuidContentObject, keyArgs, undefined),
					uuidContentParts = uuidContent.split('\n');

			if (uuidKeys.indexOf(uuidValue) > -1 ){
				for (let row = 0, len = uuidContentParts.length; row < len; row++) {
					let col = uuidContentParts[row].indexOf(uuidValue);
					if (col > -1) {
						return documentGuide + '#' + (row+1) + '-' + col;
					}
				}
			}
		} catch(err) {
			if (!err.message.endsWith('RegExp too big')) {
				throw err;
			}
		}
		return documentGuide;
	}

	if (context) {
		context.guide = function(data) {
			let documents = Array.isArray(data) ? data : [data];

			for (let document of documents) {
				if (document.$content) return;
				if (document.guide) {
					traverse(document.guide).forEach(function(node){
						if (this.isLeaf) {
							if (this.parent.isRoot) {
								Object.defineProperty(document, '$' + this.key, {
									get: function(){
										return node;
									}
								});
							} else {
								let leafParent = _.get(document, this.parent.path);
								Object.defineProperty(leafParent, '$' + this.key, {
									get: function(){
										return node;
									}
								});
							}
						}
					});
				}
			}
		}

		let _href = context.href;
		function href() {
			let document = _href.apply(null, arguments);
			if (document.guide) {
				context.guide(document);
			}
			return document;
		}

		context.href = href;
		context.guide(context. document);

		for (let collection in context.data) {
			if (context.data.hasOwnProperty(collection) && context.data[collection].length) {
				if (context.data[collection][0].guide) {
					context.data[collection].forEach(context.guide);
				}
			}
		}
	} else {
		if (cluster.isMaster) {
			let cursor = 0;
			mikser.on('mikser.manager.importDocument', (document) => {
				let guidePath = path.join(mikser.config.runtimeFolder, 'guide', document._id + '.json');
				let buildGuide = () => {
					return mikser.startWorkers().then(() => {
						return mikser.broker.call('mikser.plugins.guide.buildGuide', mikser.workers[++cursor % mikser.config.workers], document).then((guide) => {
							document.guide = guide;
							return fs.outputJsonAsync(guidePath, document.guide);
						});
					});
				}
				return fs.existsAsync(guidePath).then((exist) => {
					if (exist) {
						return fs.statAsync(guidePath).then((stats) => {
							if (document.mtime > stats.mtime) {
								return buildGuide();
							} else {
								return fs.readJsonAsync(guidePath).then((data) => {
									document.guide = data;
								});
							}
						})
					} else {
						return buildGuide();
					}
				});
			});
		}
		let plugin = {
			buildGuide: (document) => {
				// extract keys from node paths
				let keys = _.union.apply(this, traverse(document.meta).paths());
				// remove indexes from keys
				keys = keys.filter((key) => isNaN(key));
				let data = fs.readFileSync(document.source, 'utf-8');

				let contentGuide = !!document.content ? parseGuide(document, data, ['content'], document.content) : 'guide:/' + document._id;
				contentGuide = contentGuide.replace('guide:', 'guide@content:');
				let guide = {
					meta: traverse(_.cloneDeep(document.meta)).forEach(function(node){
						if (this.isLeaf) {
							let metaGuide = parseGuide(document, data, ['meta'].concat(this.path), node, keys);
							metaGuide = metaGuide.replace('guide:', 'guide@meta:');
							this.update(metaGuide);
						}
					}),
					content: contentGuide
				};
				mikser.diagnostics.log('info', 'Guide:', document._id);
				return Promise.resolve(guide);
			}
		}
		return plugin;

	}
}