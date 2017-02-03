'use strict'
let Promise = require('bluebird');
var _ = require('lodash');
var serialize = require('serialize-javascript');

module.exports = function (mikser, context) {
	context.serialize = function(data, variable, options) {
		if (data.stamp) {
			data = {
				meta: data.meta
			}
		} else {
			if (_.isArray(data)) {
				data = data.map((item) => {
					if (item.stamp) {
						return {
							meta: item.meta
						}
					}
					return item;
				})
			}
		}
		let output = '<script>' + variable + '=' + serialize(data, options) + '</script>';
		return output;
	}
}