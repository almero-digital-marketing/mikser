'use strict'

var archieml = require('archieml');
let _ = require('lodash');

module.exports = function (mikser, context) {
	function customizer(value) {
		if (_.isString(value)) {
			let trimmedValue = value.trim();

			let number = Number(trimmedValue);
			if (!_.isNaN(number)) return number;

			if (trimmedValue.toLowerCase() == 'false') return false;
			if (trimmedValue.toLowerCase() == 'true') return true;

			if (_.isDate(trimmedValue)) {
				let date = Date.parse(trimmedValue);
				if (!_.isNaN(date)) return new Date(date);				
			}
		}
	}

	if (context) {
		context.archieml = function (content) {
			let raw = archieml.load(content);
			return _.cloneDeepWith(raw, customizer);
		}
	} else {
		mikser.parser.engines.push({
			extensions: ['aml'],
			pattern: '**/*.+(aml)', 
			parse: function(content) {
				let raw = archieml.load(content);
				let guess = _.cloneDeepWith(raw, customizer);
				return guess;
			}
		});
	}
};