'use strict'

var csv = require('csv-parse/lib/sync');

module.exports = function (mikser, context) {
	if (context) {
		context.csv = function (content, options) {
			return csv.parse(content, options);
		}
	} else {
		mikser.on('mikser.manager.importDocument', (document) => {
			if (document.sourceExt == '.csv') {
				document.records = csv.parse(document.content, mikser.config.csv);
			}
		});
	}
};