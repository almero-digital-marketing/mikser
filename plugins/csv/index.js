'use strict'

var parse = require('csv-parse/lib/sync');
var _ = require('lodash');

module.exports = function (mikser, context) {
	if (context) {
		context.csv = function (content, options) {
			return parse(content, options);
		}
	} else {
		mikser.manager.extensions['.csv'] = '.html';
		mikser.generator.engines.push({
			extensions: ['csv'],
			pattern: '**/*.csv',
			render: function(context) {
				return ''
			}
		});		
		mikser.on('mikser.manager.importDocument', (document) => {
			if (document.sourceExt == '.csv') {
				document.records = parse(document.content, mikser.config.csv);
			}
		});
	}
};