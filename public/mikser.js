'use strict'

var Promise = require('bluebird');
var S = require('string');
var config = require('./config');

let mikser = {
	resources: [],
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
	},
	loadResource: function(resource, resourceType){
		if (mikser.resources.indexOf(resource) == -1) {
			resourceType = resourceType || resource.split('.').pop();
			if (resourceType=="js") { 
				var fileref=document.createElement('script')
					fileref.setAttribute("type","text/javascript")
					fileref.setAttribute("src", resource);
			}
			else if (resourceType=="css") { 
				var fileref=document.createElement("link")
					fileref.setAttribute("rel", "stylesheet")
					fileref.setAttribute("type", "text/css")
					fileref.setAttribute("href", resource);
			}
			if (typeof fileref!="undefined") {
				document.getElementsByTagName("head")[0].appendChild(fileref);
				mikser.resources.push(resource);
			}		
		}
	}
}
Promise.resolve(mikser)
	.then(config)
	.then((mikser) => {
		return mikser.loadPlugins();
	});