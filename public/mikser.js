'use strict'

var Promise = require('bluebird');
var S = require('string');
var config = require('./config');

let mikser = {
	isBrowser: true,
	loadPlugins: function() {
		mikser.plugins = {};
		return Promise.map(mikser.config.browser, (pluginName) => {
			let plugin = require(pluginName);
			return Promise.resolve(plugin(mikser)).then((result) => {
				if (result) {
					mikser.plugins[S(pluginName).camelize().s] = result;
				}
				console.log('Plugin loaded:', pluginName);
			});
		});
		return Promise.resolve();
	}
}
Promise.resolve(mikser)
	.then(config)
	.then((mikser) => {
		return mikser.loadPlugins();
	});