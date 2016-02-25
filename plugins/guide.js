'use strict';
let _ = require('lodash');
let uuid = require('uuid');
let Promise = require('bluebird');
let fs = require('fs-extra-promise');
let path = require('path');

module.exports = function (mikser, context) {

	let contentMap = { content: undefined, lastId: undefined };
	let debug = mikser.debug('guide');

	function navigate(document, dataUrl) {
		let keyArgs = dataUrl.split('/');
		let value = _.get(document, keyArgs, undefined);

		if (value === undefined) {
			if (context) {
				mikser.diagnostics.log(context, 'warning', `Value for key: ${dataUrl} is undefined`);
			} else {
				mikser.diagnostics.log('warning', `Value for key: ${dataUrl} is undefined`);
			}
			return;
		}

		if (value !==null && (typeof value == 'object' || typeof value == 'function')) {
			if (context) {
				mikser.diagnostics.log(context, 'warning', `Unsupported type for value: ${typeof value}`);
			} else {
				mikser.diagnostics.log('warning', `Unsupported type for value: ${typeof value}`);
			}
			return;
		}

		// update contentMap and assign file content to data;
		let data;
		if (contentMap.lastId !== document._id) {
			contentMap.lastId = document._id;
			data = contentMap.lastContent = fs.readFileSync(document.source, 'utf-8');
		} else {
			data = contentMap.lastContent;
		}

		let uuidContent = data.replace(new RegExp(value, "g"), () => uuid.v1()),
				uuidContentObject = mikser.parser.parse(document.source, uuidContent),
				uuidValue = _.get(uuidContentObject, keyArgs, undefined),
				uuidContentParts = uuidContent.split('\n');

		for (let row = 0, len = uuidContentParts.length; row < len; row++) {
			let col = uuidContentParts[row].indexOf(uuidValue);
			if (col > -1 ) return document._id + ':' + (row+1) + ',' + col;
		}
	}

	let plugin = {
		navigate: (contentUrl) => {
			let ulrParts = contentUrl.split('#'),
					id = urlParts[0],
					dataUrl = urlParts[1];

			if (!mikser.state.contentMap) {
				mikser.diagnostics.log('warning', 'Guide: ' + 'state not found');
				return;
			}

			if (!mikser.state.contentMap.hasOwnProperty(id)) {
				mikser.diagnostics.log('warning', 'Guide: ' + 'Document not found-> ' + id);
				return;
			}

			return navigate(mikser.state.contentMap[id], dataUrl);
		}
	}

	if (context) {
		context.guide = function() {
			let args = Array.from(arguments),
					dataUrl = args.pop(),
					document = context.href.apply(null, args);
			return navigate(document, dataUrl);
		}
	} else {
			mikser.state.contentMap = mikser.state.contentMap || {};

			mikser.on('mikser.runtime.link', (document) => {
				mikser.state.contentMap[document._id] = document;
			});

			mikser.on('mikser.runtime.unlink', (document) => {
				delete mikser.state.contentMap[document._id];
			});

			return plugin;
		}
	}