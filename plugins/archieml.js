'use strict'

var archieml = require('archieml');

module.exports = function (mikser, context) {
	if (context) {
		context.archieml = function (content) {
			return archieml.load(content);
		}
	} else {
		mikser.parser.engines.push({
			pattern: '**/*.+(aml)', 
			parse: function(content) {
				return archieml.load(content);
			}
		});
	}
};