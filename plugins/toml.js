'use strict'

var toml = require('toml');

module.exports = function (mikser, context) {
	if (context) {
		context.toml = function (content) {
			return toml.parse(content);
		}
	} else {
		mikser.parser.engines.push({
			extensions: ['toml'],
			pattern: '**/*.+(toml)', 
			parse: function(content) {
				return toml.parse(content);
			}
		});
	}
};