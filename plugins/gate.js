'use strict';
let _ = require('lodash');
let Promise = require('bluebird');
let fs = require('fs-extra-promise');
let path = require('path');
let cluster = require('cluster');
let shortid = require('shortid');
let MuxDemux = require('mux-demux/msgpack')
let reconnect = require('reconnect-net');
let S = require('string');
let net = require('net');
let base32 = require('base32')

module.exports = function(mikser) {
	if (cluster.isWorker || mikser.config.gate === false) return;
	let debug = mikser.debug('gate');
	mikser.options.gate = {};

	function showServerInfo() {
		for(let portName of _.keys(mikser.options.gate)) {
			if (portName != 'server') mikser.diagnostics.log('info', 'Gate[' + portName + ']: http://' + 'm' + base32.encode(mikser.options.gate[portName]) + '.mikser.io/');
		}
		if (mikser.config.shared.length) {
			for (let share of mikser.config.shared) {
				mikser.diagnostics.log('info', 'Gate[server]: http://' + 'm' + base32.encode(mikser.options.gate['server']) + '.mikser.io' + S(share).ensureLeft('/').ensureRight('/').s);
			}
		}
		else {
			mikser.diagnostics.log('info', 'Gate[server]: http://' + 'm' + base32.encode(mikser.options.gate['server']) + '.mikser.io/');
		}
	};

	function openGate(port, portName) {
		let recent = path.join(mikser.config.runtimeFolder, 'recent', 'gate.json');
		return fs.existsAsync(recent).then((exists) => {
			if (exists) {
				return fs.readJsonAsync(recent, 'utf-8');
			} else {
				return {};
			}
		}).then((gateInfo) => {
			if (gateInfo[portName]) {
				mikser.options.gate[portName] = gateInfo[portName];
				return Promise.resolve();
			}
			mikser.options.gate[portName] = shortid.generate();
			return fs.outputJsonAsync(recent, mikser.options.gate);
		}).then(() => {
			reconnect({
				strategy: 'fibonacci',
				failAfter: Infinity
			}, (connection) => {
				let mx = MuxDemux((stream) => {
					if (stream.meta.tunnel) {
						stream.pipe(net.connect({port: port})).pipe(stream).on('error', debug);					
					}
				});
				connection.pipe(mx).pipe(connection).on('error', debug);
				mx.createStream({
					gate: mikser.options.gate[portName]
				}).end();
			}).connect({
				port: 9090,
				host: 'mikser.io'
			}).on('error', debug);
		});			
	}

	mikser.on('mikser.server.ready', () => {
		return openGate(mikser.config.serverPort, 'server').then(() => showServerInfo());
	});

	mikser.on('mikser.scheduler.renderFinished', () => {
		if (!_.keys(mikser.server.clients).length) showServerInfo();
	});

	mikser.on('mikser.utils.resolvePort', openGate);

	return {
		open: openGate
	}
}