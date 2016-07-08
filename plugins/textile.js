'use strict'

var textile = require('textile-js');

module.exports = function (mikser, context) {
	if (context) {
		context.textile = function (content) {
			return textile(content);
		}
	} else {
		mikser.manager.extensions['.textile'] = '.html';
		mikser.generator.engines.push({
			pattern: '**/*.textile',
			render: function(context) {
				return textile(context.content);
			}
		});
	}
};