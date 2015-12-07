'use strict'

var yaml = require('js-yaml');

module.exports = function (mikser, context) {
	context.yaml = function (content) {
		return yaml.safeLoad(content);
	}
};