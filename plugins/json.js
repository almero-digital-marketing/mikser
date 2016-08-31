'use strict'

var JSON5 = require('json5');

module.exports = function (mikser, context) {
	if (context) {
		context.json = function (content) {
			return JSON5.parse(content);
		}
	} else {
		mikser.parser.engines.push({
			extensions: ['json','json5'],
			pattern: '**/*.+(json|json5)', 
			parse: function(content) {
				return JSON5.parse(content);
			}
		});
	}
};