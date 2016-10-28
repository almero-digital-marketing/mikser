'use strict'

var cluster = require('cluster');
var Promise = require('bluebird');
var application = require('./lib/application');
var config = require('./lib/config');
var runtime = require('./lib/runtime');
var database = require('./lib/database');
var utils = require('./lib/utils');
var diagnostics = require('./lib/diagnostics');
var tools = require('./lib/tools');
var debug = require('./lib/debug');
var broker = require('./lib/broker');
var parser = require('./lib/parser');

module.exports = function(options) {
	let mikser = application(options);
	mikser.options.base = true;
	mikser.run = function() {
	 	return Promise.resolve(mikser)
			.then(debug)
			.then(broker)
			.then(config)
			.then(runtime)
			.then(database)
			.then(parser)
			.then(utils)
			.then(tools)
			.then(diagnostics)
			.then(() => mikser.emit('mikser.init', cluster.isMaster).return(mikser))
			.then((mikser) => { 
				if (cluster.isMaster) {
					console.log('Mikser: Loaded');
					mikser.loadPlugins().then(() => {
						mikser.cli.init(true);					
					});
				} else {
					mikser.loadPlugins().then(mikser.joinMaster);
				}
			}).return(mikser);
	}
	return mikser;
}