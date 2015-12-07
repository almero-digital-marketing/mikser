'use strict'

var textile = require('textile');

module.exports = function (mikser, context) {
	if (context) {
		context.textile = function (content) {
			return textile(content);
		}
	} else {
		mikser.renderengine.engines.push({
			pattern: '**/*.textile',
			render: function(context) {
				return textile(context.content);
			}
		});
	}
};