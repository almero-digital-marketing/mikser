'use strict'

var yaml = require('js-yaml');

module.exports = function (mikser, context) {
	if (context) {
		context.yaml = function (content) {
			return yaml.safeLoad(content);
		}
	} else {
		mikser.parser.engines.push({
			pattern: '**/*.+(yml|yaml)', 
			parse: function(content) {
				return yaml.safeLoad(content);
			}
		});
	}
};