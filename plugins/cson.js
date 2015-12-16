'use strict'

var cson = require('cson');

module.exports = function (mikser, context) {
	if (context) {
		context.json = function (content) {
			return cson.parse(content);
		}
	} else {
		mikser.parser.engines.push({
			pattern: '**/*.+(cson)', 
			parse: function(content) {
				return cson.parse(content);
			}
		});
	}
};