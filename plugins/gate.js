'use strict';
let _ = require('lodash');
let uuid = require('uuid');
let Promise = require('bluebird');
let fs = require('fs-extra-promise');
let path = require('path');
let cluster = require('cluster');
let request = require('request-promise');

module.exports = function(mikser) {
	if (cluster.isWorker) return;
	mikser.on('mikser.server.ready', () => {
		return 

	});

	mikser.on('mikser.utils.resolvePort', (portName, resolvedPort) => {
		let gatePorts = path.join(mikser.config.runtimeFolder, 'recent', 'gate.json');
		return fs.existsAsync(gatePorts).then((exists) => {
			if (exists) {
				return fs.readJsonAsync(gatePorts, 'utf-8');
			} else {
				return {};
			}
		}).then((ports) => {
			let cachedPort = ports[portName];
			let port = resolvedPort;
			if (cachedPort) port = cachedPort;
			return request({
				url: 'http://api.mikser.io/gate/port/' + port,
				method: 'GET',
				json: true
			}).then((portInfo) => {
				if (portInfo.err) return mikser.diagnostics.log('error', 'Error finding free port on gate');
				let action = Promise.resolve();
				if (portInfo.port != ports[portName]) {
					ports[portName] = portInfo.port;
					action = fs.outputJsonAsync(gatePorts, ports);
				}
				return action;
			});
		});
	});

}